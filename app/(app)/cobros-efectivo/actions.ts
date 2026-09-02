"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { turnoAbiertoDeLocal } from "@/app/(app)/turnos/actions";
import { calcularBeneficioReferido, registrarReferido, puntosExtraPorMonto } from "@/lib/referidosProfesionales";
import { registrarCanje, esProfesionalActivo } from "@/lib/canjesProfesionales";
import { calcularCanjePuntos, aplicarCanjePuntos } from "@/lib/puntosWiigo";
import { facturarAlAcreditarse } from "@/lib/arca/config";
import type { SupabaseClient } from "@supabase/supabase-js";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

// Los puntos WiiGo Club no son por producto: son una regla general
// configurable en /configuracion ("N puntos cada $X gastados"), ver
// ConfiguracionApp.tsx — misma fórmula acá.
async function calcularPuntos(supabase: SupabaseClient, total: number) {
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", ["PUNTOS_ACTIVO", "PUNTOS_CADA_MONTO", "PUNTOS_OTORGADOS"]);
  const config = Object.fromEntries((data ?? []).map((r) => [r.parametro, r.valor]));
  if (config.PUNTOS_ACTIVO !== "true") return 0;

  const cadaMonto = Number(config.PUNTOS_CADA_MONTO ?? 0);
  const otorgados = Number(config.PUNTOS_OTORGADOS ?? 0);
  if (!cadaMonto || cadaMonto <= 0) return 0;

  return Math.floor((total / cadaMonto) * otorgados);
}

// Coincide con las tasas que se cargan en Configuración → Comisión de
// Mercado Pago (ver guardarConfigMercadoPago) — cada forma de pago del
// cliente tiene su propia comisión, no hay una tasa única de MP.
const FORMAS_PAGO_MP: Record<string, string> = {
  DINERO_CUENTA: "MP_COMISION_DINERO_CUENTA",
  DEBITO: "MP_COMISION_DEBITO",
  CUOTAS_SIN_INTERES: "MP_COMISION_CUOTAS_SIN_INTERES",
  PREPAGA: "MP_COMISION_PREPAGA",
  CREDITO: "MP_COMISION_CREDITO",
};

async function tasaComisionMp(supabase: SupabaseClient, formaPago: string) {
  const clave = FORMAS_PAGO_MP[formaPago];
  if (!clave) return 0;
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", [clave, "IVA_GENERAL_PORCENTAJE"]);
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.parametro, Number(r.valor ?? 0)]));
  return { base: cfg[clave] ?? 0, ivaGeneral: cfg.IVA_GENERAL_PORCENTAJE ?? 21 };
}

// Next.js redacta en producción el mensaje de un Error tirado desde una
// Server Action (queda solo un digest genérico en el navegador) — por eso
// esta función no throwea para errores esperables: devuelve { error }.
export async function confirmarCobro(
  idVenta: string,
  montoRecibido: number,
  formaPagoMp?: string,
  usuarioOverride?: string
): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();

    const { data: venta, error: errorVenta } = await supabase
      .from("ventas")
      .select("id_venta, id_cliente, id_local, total, estado, medio_pago, id_codigo_profesional, id_profesional_canje, marcas_canje, puntos_canjeados")
      .eq("id_venta", idVenta)
      .maybeSingle();
    if (errorVenta) return { error: friendlyDbError(errorVenta) };
    if (!venta) return { error: "No se encontró el pedido" };
    if (venta.estado !== "PENDIENTE_PAGO") return { error: "Este pedido ya no está pendiente de pago" };

    const total = venta.total ?? 0;
    if (montoRecibido < total) return { error: "El monto recibido es menor al total del pedido" };
    if (!venta.id_local) return { error: "Este pedido no tiene local asignado" };

    const idTurno = await turnoAbiertoDeLocal(supabase, venta.id_local);
    if (!idTurno) {
      return { error: "No hay un turno de caja abierto en este local — abrilo en Turnos antes de confirmar cobros." };
    }

    const { data: detalle, error: errorDetalle } = await supabase
      .from("detalle_ventas")
      .select("id_detalle, id_variante, id_marca, cantidad, precio_unitario, subtotal")
      .eq("id_venta", idVenta);
    if (errorDetalle) return { error: friendlyDbError(errorDetalle) };
    const lineas = detalle ?? [];

    // Validar que todavía haya stock ANTES de cobrar nada — sin esto, dos
    // pedidos armados con el mismo producto (dos totems, o self-checkout +
    // una venta manual) podían cobrarse los dos igual, y el descuento final
    // se tapaba solo poniendo el stock en 0 en vez de avisar que ya no
    // alcanzaba.
    const idsVarianteDetalle = [...new Set(lineas.map((l) => l.id_variante as string))];
    const { data: stockLineas, error: errorStockCheck } = await supabase
      .from("stock")
      .select("id_variante, cantidad")
      .eq("id_local", venta.id_local)
      .in("id_variante", idsVarianteDetalle);
    if (errorStockCheck) return { error: friendlyDbError(errorStockCheck) };
    const stockMap = new Map((stockLineas ?? []).map((s) => [s.id_variante as string, s.cantidad as number]));
    for (const linea of lineas) {
      if ((stockMap.get(linea.id_variante as string) ?? 0) < (linea.cantidad as number)) {
        return {
          error: "Ya no queda stock suficiente para completar este pedido — revisá el stock antes de confirmar el cobro.",
        };
      }
    }

    const usuario = usuarioOverride ?? (await usuarioActual());
    const esMercadoPago = venta.medio_pago === "MERCADO_PAGO";

  let pagoInsert: Record<string, unknown>;
  if (esMercadoPago) {
    if (!formaPagoMp || !FORMAS_PAGO_MP[formaPagoMp]) return { error: "Elegí cómo pagó el cliente por Mercado Pago" };
    const { base: tasa, ivaGeneral } = await tasaComisionMp(supabase, formaPagoMp);
    // Mercado Pago cobra la comisión + IVA sobre esa comisión (ej. débito
    // 1,39% + 21% de IVA) — la tasa cargada en Configuración es la base.
    const comisionImporte = Math.round(total * (tasa / 100));
    const ivaComisionImporte = Math.round(comisionImporte * (ivaGeneral / 100));
    pagoInsert = {
      id_venta: idVenta,
      medio: "MERCADO_PAGO",
      forma_pago_cliente: formaPagoMp,
      importe_bruto: total,
      comision_porcentaje: tasa,
      comision_importe: comisionImporte,
      iva_comision: ivaComisionImporte,
      neto_acreditado: total - comisionImporte - ivaComisionImporte,
      fecha_pago: new Date().toISOString(),
      fecha_acreditacion: new Date().toISOString(),
      estado: "ACREDITADO",
      estado_conciliacion: "CONCILIADO",
      observaciones: `Confirmado por ${usuario ?? "personal"} · Mercado Pago (${formaPagoMp}) · comisión ${tasa}% + IVA`,
    };
  } else {
    const vuelto = montoRecibido - total;
    // El efectivo no tiene comisión ni conciliación externa: neto = bruto,
    // y queda acreditado en el momento (a diferencia de una liquidación de
    // Mercado Pago, que se concilia después).
    pagoInsert = {
      id_venta: idVenta,
      medio: "EFECTIVO",
      forma_pago_cliente: "EFECTIVO",
      importe_bruto: total,
      neto_acreditado: total,
      fecha_pago: new Date().toISOString(),
      fecha_acreditacion: new Date().toISOString(),
      estado: "ACREDITADO",
      estado_conciliacion: "CONCILIADO",
      observaciones: `Confirmado por ${usuario ?? "personal"} · Pagó con $${montoRecibido} · Vuelto $${vuelto}`,
    };
  }

  const { data: pago, error: errorPago } = await supabase.from("pagos").insert(pagoInsert).select("id_pago").single();
  if (errorPago) return { error: friendlyDbError(errorPago) };

  // El .eq("estado", "PENDIENTE_PAGO") es a propósito: si el cliente
  // cancela el pedido desde el totem justo en el instante en que el
  // personal confirma el cobro, esto evita que la venta quede marcada
  // "PAGADA" después de haber sido cancelada (o viceversa).
  const { data: ventaActualizada, error: errorVentaUpdate } = await supabase
    .from("ventas")
    .update({ estado: "PAGADA", id_pago: pago.id_pago, total_cobrado: montoRecibido, id_turno: idTurno })
    .eq("id_venta", idVenta)
    .eq("estado", "PENDIENTE_PAGO")
    .select("id_venta")
    .maybeSingle();
  if (errorVentaUpdate) return { error: friendlyDbError(errorVentaUpdate) };
  if (!ventaActualizada) {
    // El pago ya se había insertado antes de descubrir la cancelación —
    // se deshace para no dejar un cobro huérfano sin venta pagada detrás.
    await supabase.from("pagos").delete().eq("id_pago", pago.id_pago);
    return { error: "Este pedido se canceló justo antes de confirmarse — no se cobró nada." };
  }

  for (const linea of lineas) {
    const cantidadActual = stockMap.get(linea.id_variante as string) ?? 0;
    const nuevaCantidad = cantidadActual - (linea.cantidad as number);
    if (nuevaCantidad < 0) {
      // No debería pasar (ya se validó arriba), salvo que otro cobro haya
      // descontado este mismo stock en el instante entre la validación y
      // acá — mejor cortar acá con un error claro que dejar el stock en
      // negativo sin avisar.
      return { error: "Ya no queda stock suficiente para completar este pedido — revisá el stock antes de confirmar el cobro." };
    }

    const { error: errorStock } = await supabase
      .from("stock")
      .upsert(
        {
          id_variante: linea.id_variante,
          id_local: venta.id_local,
          cantidad: nuevaCantidad,
          fecha_actualizacion: new Date().toISOString(),
        },
        { onConflict: "id_variante,id_local" }
      );
    if (errorStock) return { error: friendlyDbError(errorStock) };

    await supabase.from("movimientos_stock").insert({
      id_variante: linea.id_variante,
      id_local: venta.id_local,
      tipo: "VENTA",
      cantidad: -linea.cantidad,
      motivo: "Venta Self Checkout",
      id_referencia: idVenta,
      usuario,
    });
  }

  // El referido de profesional recién se registra acá (no al armar el
  // pedido) — así un carrito abandonado antes de pagar nunca genera un
  // referido ni comisión. El % de cada marca se vuelve a calcular con la
  // config vigente de ahora mismo (normalmente pasan pocos minutos entre el
  // pedido y el cobro, así que en la práctica es el mismo % que vio el
  // cliente al armar el carrito).
  let puntosExtra = 0;
  let descuentoBeneficioReal = 0;
  if (venta.id_codigo_profesional) {
    const { data: codigo } = await supabase
      .from("codigos_profesionales")
      .select("id_profesional, usos")
      .eq("id_codigo", venta.id_codigo_profesional)
      .maybeSingle();
    if (codigo) {
      const resultado = await calcularBeneficioReferido(
        supabase,
        (detalle ?? []).map((d) => ({
          idVariante: d.id_variante,
          idDetalleVenta: d.id_detalle,
          idProducto: null,
          idMarca: d.id_marca,
          cantidad: d.cantidad,
          precioUnitario: d.precio_unitario,
          importe: d.subtotal ?? d.precio_unitario * d.cantidad,
        }))
      );
      descuentoBeneficioReal = resultado.descuentoTotal;
      await registrarReferido(supabase, {
        idVenta,
        idCliente: venta.id_cliente,
        idCodigo: venta.id_codigo_profesional,
        idProfesional: codigo.id_profesional,
        idLocal: venta.id_local,
        usosActuales: codigo.usos,
        totalVenta: total,
        resultado,
      });
      if (venta.id_cliente) puntosExtra = await puntosExtraPorMonto(supabase, resultado.puntosExtraMonto);
    }
  }

  // Mismo criterio que arriba: el canje con puntos propios de un profesional
  // recién se descuenta de su saldo cuando se confirma el cobro, no al armar
  // el pedido. El monto por marca se recalcula sumando los productos reales
  // de esa marca en esta venta — nunca se confía en un monto guardado.
  let descuentoCanjeProfesionalReal = 0;
  if (venta.id_profesional_canje && venta.marcas_canje && venta.marcas_canje.length > 0) {
    const subtotalPorMarca = new Map<string, number>();
    for (const d of detalle ?? []) {
      if (!d.id_marca || !venta.marcas_canje.includes(d.id_marca)) continue;
      subtotalPorMarca.set(d.id_marca, (subtotalPorMarca.get(d.id_marca) ?? 0) + (d.subtotal ?? d.precio_unitario * d.cantidad));
    }
    descuentoCanjeProfesionalReal = [...subtotalPorMarca.values()].reduce((acc, m) => acc + m, 0);
    await registrarCanje(supabase, {
      idProfesional: venta.id_profesional_canje,
      idVenta,
      porMarca: [...subtotalPorMarca.entries()].map(([idMarca, monto]) => ({ idMarca, monto })),
      usuario,
    });
  }

  // El descuento por puntos WiiGo del cliente se aplica recién acá (mismo
  // criterio que el referido y el canje de profesional de arriba) —
  // recalculado desde el subtotal real de la venta, nunca desde el número
  // que se guardó al armar el pedido.
  if (venta.id_cliente && (venta.puntos_canjeados ?? 0) > 0) {
    const subtotalReal = (detalle ?? []).reduce((acc, d) => acc + (d.subtotal ?? d.precio_unitario * d.cantidad), 0);
    const montoAntesDePuntos = Math.max(subtotalReal - descuentoBeneficioReal - descuentoCanjeProfesionalReal, 0);
    const infoPuntos = await calcularCanjePuntos(supabase, venta.id_cliente, montoAntesDePuntos);
    await aplicarCanjePuntos(supabase, venta.id_cliente, infoPuntos.puntosNecesarios);
  }

  // Sin cliente identificado no hay a quién sumarle los puntos, así que
  // la venta queda con 0 aunque la regla general esté activa. Un profesional
  // no suma puntos de club en sus propias compras (ver esProfesionalActivo).
  // Los puntos extra por código de profesional (para el cliente referenciado)
  // se suman aparte, arriba de los normales.
  let esProfesional = false;
  if (venta.id_cliente) {
    const { data: clienteDni } = await supabase.from("clientes").select("dni").eq("id_cliente", venta.id_cliente).maybeSingle();
    esProfesional = await esProfesionalActivo(supabase, clienteDni?.dni ?? null);
  }
  const puntosGenerados = (venta.id_cliente && !esProfesional ? await calcularPuntos(supabase, total) : 0) + puntosExtra;
  await supabase.from("ventas").update({ puntos_generados: puntosGenerados }).eq("id_venta", idVenta);

  if (venta.id_cliente && puntosGenerados > 0) {
    const { data: cliente } = await supabase
      .from("clientes")
      .select("puntos")
      .eq("id_cliente", venta.id_cliente)
      .maybeSingle();
    await supabase
      .from("clientes")
      .update({ puntos: (cliente?.puntos ?? 0) + puntosGenerados })
      .eq("id_cliente", venta.id_cliente);
  }

  // Recién acá se factura: el cobro ya está acreditado. Nunca tira error —
  // si ARCA falla, la venta queda cobrada igual y aparece en Ventas como
  // pendiente de facturar (ver lib/arca/config.ts).
  {
    const { data: clienteFactura } = venta.id_cliente
      ? await supabase.from("clientes").select("dni").eq("id_cliente", venta.id_cliente).maybeSingle()
      : { data: null };
    await facturarAlAcreditarse(idVenta, venta.medio_pago as string, clienteFactura?.dni ?? null);
  }

    revalidatePath("/cobros-efectivo");
    revalidatePath("/clientes");
    revalidatePath("/ventas");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo confirmar el cobro" };
  }
}

export async function cancelarPedido(idVenta: string, motivo: string): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("ventas")
      .update({
        estado: "CANCELADA",
        motivo_cancelacion: motivo || "Cancelado por el personal",
        fecha_cancelacion: new Date().toISOString(),
      })
      .eq("id_venta", idVenta)
      .eq("estado", "PENDIENTE_PAGO");
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/cobros-efectivo");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cancelar el pedido" };
  }
}
