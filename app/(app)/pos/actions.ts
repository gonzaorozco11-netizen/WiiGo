"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { turnoAbiertoDeLocal } from "@/app/(app)/turnos/actions";
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

type ItemCarrito = { idVariante: string; idMarca: string | null; cantidad: number; precioUnitario: number };

// Coincide con las tasas de Configuración → Comisión de Mercado Pago y con
// `pagos.forma_pago_cliente` (ver cobros-efectivo/actions.ts) — no hay una
// sola comisión de MP, varía según cómo pagó el cliente.
const FORMAS_PAGO_MP: Record<string, string> = {
  DINERO_CUENTA: "MP_COMISION_DINERO_CUENTA",
  DEBITO: "MP_COMISION_DEBITO",
  CUOTAS_SIN_INTERES: "MP_COMISION_CUOTAS_SIN_INTERES",
  PREPAGA: "MP_COMISION_PREPAGA",
  CREDITO: "MP_COMISION_CREDITO",
};

async function tasaComisionMp(supabase: SupabaseClient, formaPago: string) {
  const clave = FORMAS_PAGO_MP[formaPago];
  if (!clave) return { base: 0, ivaGeneral: 21 };
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", [clave, "IVA_GENERAL_PORCENTAJE"]);
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.parametro, Number(r.valor ?? 0)]));
  return { base: cfg[clave] ?? 0, ivaGeneral: cfg.IVA_GENERAL_PORCENTAJE ?? 21 };
}

// Autocompletar nombre al escribir el DNI, para que el empleado vea a
// quién le está cargando la venta antes de cobrar.
export async function buscarClientePorDni(dni: string) {
  const dniLimpio = dni.trim();
  if (!dniLimpio) return null;

  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("clientes")
    .select("nombre, apellido, puntos")
    .eq("dni", dniLimpio)
    .maybeSingle();

  return data ?? null;
}

// Venta mostrador: a diferencia del Self Checkout, acá el mismo empleado
// arma el pedido y cobra en el momento — no queda pendiente esperando a
// nadie. Sirve tanto como venta asistida normal como respaldo si se cae
// la conexión de algún totem.
export async function venderPos(
  idLocal: string,
  items: ItemCarrito[],
  dni: string,
  codigoProfesional: string,
  montoRecibido: number,
  medioPago: "EFECTIVO" | "MERCADO_PAGO" = "EFECTIVO",
  formaPagoMp?: string
) {
  if (items.length === 0) throw new Error("El carrito está vacío");

  const supabase = getSupabaseServerClient();
  const usuario = await usuarioActual();

  let idCliente: string | null = null;
  const dniLimpio = dni.trim();
  if (dniLimpio) {
    const { data: existente } = await supabase
      .from("clientes")
      .select("id_cliente")
      .eq("dni", dniLimpio)
      .maybeSingle();

    if (existente) {
      idCliente = existente.id_cliente;
    } else {
      const { data: nuevo, error } = await supabase
        .from("clientes")
        .insert({ nombre: "Cliente WiiGo", dni: dniLimpio, estado: "ACTIVO" })
        .select("id_cliente")
        .single();
      if (error) throw new Error(friendlyDbError(error));
      idCliente = nuevo?.id_cliente ?? null;
    }
  }

  const subtotal = items.reduce((acc, i) => acc + i.precioUnitario * i.cantidad, 0);

  let idCodigo: string | null = null;
  let idProfesional: string | null = null;
  let descuentoBeneficio = 0;
  const codigoLimpio = codigoProfesional.trim().toUpperCase();
  if (codigoLimpio) {
    const { data: codigo } = await supabase
      .from("codigos_profesionales")
      .select("id_codigo, id_profesional, tipo_beneficio_cliente, valor_beneficio_cliente")
      .eq("codigo", codigoLimpio)
      .eq("estado", "ACTIVO")
      .maybeSingle();

    if (codigo) {
      idCodigo = codigo.id_codigo;
      idProfesional = codigo.id_profesional;
      if (codigo.tipo_beneficio_cliente === "PORCENTAJE" && codigo.valor_beneficio_cliente) {
        descuentoBeneficio = Math.round(subtotal * (codigo.valor_beneficio_cliente / 100));
      } else if (codigo.tipo_beneficio_cliente === "MONTO" && codigo.valor_beneficio_cliente) {
        descuentoBeneficio = Math.min(codigo.valor_beneficio_cliente, subtotal);
      }
    }
  }

  const total = Math.max(subtotal - descuentoBeneficio, 0);
  const esMercadoPago = medioPago === "MERCADO_PAGO";
  if (esMercadoPago && (!formaPagoMp || !FORMAS_PAGO_MP[formaPagoMp])) {
    throw new Error("Elegí cómo pagó el cliente por Mercado Pago");
  }
  const montoFinal = esMercadoPago ? total : montoRecibido;
  if (montoFinal < total) throw new Error("El monto recibido es menor al total de la venta");
  const vuelto = montoFinal - total;

  const idTurno = await turnoAbiertoDeLocal(supabase, idLocal);
  if (!idTurno) throw new Error("No hay un turno de caja abierto en este local — abrilo en Turnos antes de vender.");

  // La venta se crea primero: pagos.id_venta no admite null, así que no
  // se puede insertar el pago hasta tener el id de la venta.
  const { data: venta, error: errorVenta } = await supabase
    .from("ventas")
    .insert({
      canal: "POS",
      id_cliente: idCliente,
      id_local: idLocal,
      subtotal,
      descuento: descuentoBeneficio,
      total,
      estado: "PAGADA",
      medio_pago: medioPago,
      total_cobrado: montoFinal,
      usuario,
      terminal: "POS",
      id_turno: idTurno,
    })
    .select("id_venta, numero")
    .single();
  if (errorVenta) throw new Error(friendlyDbError(errorVenta));

  let pagoInsert: Record<string, unknown>;
  if (esMercadoPago) {
    const { base: tasa, ivaGeneral } = await tasaComisionMp(supabase, formaPagoMp as string);
    // Mercado Pago cobra la comisión + IVA sobre esa comisión — la tasa
    // cargada en Configuración es la base, sin IVA.
    const comisionImporte = Math.round(total * (tasa / 100));
    const ivaComisionImporte = Math.round(comisionImporte * (ivaGeneral / 100));
    pagoInsert = {
      id_venta: venta.id_venta,
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
      observaciones: `Venta mostrador · ${usuario ?? "personal"} · Mercado Pago (${formaPagoMp}) · comisión ${tasa}% + IVA`,
    };
  } else {
    pagoInsert = {
      id_venta: venta.id_venta,
      medio: "EFECTIVO",
      forma_pago_cliente: "EFECTIVO",
      importe_bruto: total,
      neto_acreditado: total,
      fecha_pago: new Date().toISOString(),
      fecha_acreditacion: new Date().toISOString(),
      estado: "ACREDITADO",
      estado_conciliacion: "CONCILIADO",
      observaciones: `Venta mostrador · ${usuario ?? "personal"} · Pagó con $${montoFinal} · Vuelto $${vuelto}`,
    };
  }

  const { data: pago, error: errorPago } = await supabase.from("pagos").insert(pagoInsert).select("id_pago").single();
  if (errorPago) throw new Error(friendlyDbError(errorPago));

  await supabase.from("ventas").update({ id_pago: pago.id_pago }).eq("id_venta", venta.id_venta);

  const filasDetalle = items.map((i) => ({
    id_venta: venta.id_venta,
    id_variante: i.idVariante,
    id_marca: i.idMarca,
    cantidad: i.cantidad,
    precio_unitario: i.precioUnitario,
    subtotal: i.precioUnitario * i.cantidad,
  }));
  const { error: errorDetalle } = await supabase.from("detalle_ventas").insert(filasDetalle);
  if (errorDetalle) throw new Error(friendlyDbError(errorDetalle));

  if (idCodigo && idProfesional) {
    await supabase.from("referidos_profesionales").insert({
      id_venta: venta.id_venta,
      id_cliente: idCliente,
      id_profesional: idProfesional,
      id_codigo: idCodigo,
      total_venta: total,
      beneficio_cliente: descuentoBeneficio,
      estado: "PENDIENTE",
    });
  }

  for (const item of items) {
    const { data: stockActual } = await supabase
      .from("stock")
      .select("cantidad")
      .eq("id_variante", item.idVariante)
      .eq("id_local", idLocal)
      .maybeSingle();
    const nuevaCantidad = Math.max((stockActual?.cantidad ?? 0) - item.cantidad, 0);

    const { error: errorStock } = await supabase
      .from("stock")
      .upsert(
        { id_variante: item.idVariante, id_local: idLocal, cantidad: nuevaCantidad, fecha_actualizacion: new Date().toISOString() },
        { onConflict: "id_variante,id_local" }
      );
    if (errorStock) throw new Error(friendlyDbError(errorStock));

    await supabase.from("movimientos_stock").insert({
      id_variante: item.idVariante,
      id_local: idLocal,
      tipo: "VENTA",
      cantidad: -item.cantidad,
      motivo: "Venta mostrador (POS)",
      id_referencia: venta.id_venta,
      usuario,
    });
  }

  // Sin cliente identificado no hay a quién sumarle los puntos, así que
  // la venta queda con 0 aunque la regla general esté activa.
  const puntosGenerados = idCliente ? await calcularPuntos(supabase, total) : 0;
  await supabase.from("ventas").update({ puntos_generados: puntosGenerados }).eq("id_venta", venta.id_venta);

  if (idCliente && puntosGenerados > 0) {
    const { data: cliente } = await supabase.from("clientes").select("puntos").eq("id_cliente", idCliente).maybeSingle();
    await supabase
      .from("clientes")
      .update({ puntos: (cliente?.puntos ?? 0) + puntosGenerados })
      .eq("id_cliente", idCliente);
  }

  revalidatePath("/pos");
  revalidatePath("/stock");

  return { numero: venta.numero as number, total, vuelto, puntosGenerados };
}
