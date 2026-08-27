"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { turnoAbiertoDeLocal } from "@/app/(app)/turnos/actions";
import {
  calcularBeneficioReferido,
  resolverCodigoProfesional,
  registrarReferido,
  puntosExtraPorMonto,
  enlazarDetalleVenta,
} from "@/lib/referidosProfesionales";
import { buscarProfesionalPorDni, verificarPinProfesional, calcularDescuentoCanje, registrarCanje, esProfesionalActivo } from "@/lib/canjesProfesionales";
import { calcularCanjePuntos, aplicarCanjePuntos } from "@/lib/puntosWiigo";
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

// Para que un profesional pueda pagar su propia compra con el saldo que
// acumuló vendiendo cada marca — se dispara con el mismo DNI de arriba.
export async function buscarProfesionalPorDniAction(dni: string) {
  const supabase = getSupabaseServerClient();
  return buscarProfesionalPorDni(supabase, dni);
}

// Confirmación en vivo mientras se escribe el código, igual que el DNI de
// arriba — sin esto el campo quedaba mudo y no se notaba si el código era
// válido hasta apretar Cobrar.
export async function buscarCodigoProfesionalAction(codigo: string): Promise<{ nombre: string | null; error: string | null }> {
  if (!codigo.trim()) return { nombre: null, error: null };
  const supabase = getSupabaseServerClient();
  const resuelto = await resolverCodigoProfesional(supabase, codigo);
  if (resuelto.error) return { nombre: null, error: resuelto.error };
  if (!resuelto.idProfesional) return { nombre: null, error: null };
  const { data } = await supabase
    .from("profesionales")
    .select("nombre, apellido")
    .eq("id_profesional", resuelto.idProfesional)
    .maybeSingle();
  return { nombre: data ? `${data.nombre}${data.apellido ? ` ${data.apellido}` : ""}` : null, error: null };
}

// Vista previa en vivo de cuánto descuento le da al CLIENTE el código de
// profesional (si la marca de esos productos eligió "Descuento en el
// momento" en vez de "Puntos extra") — separado de buscarCodigoProfesionalAction,
// que solo confirma el nombre. Sin esto el empleado no veía cambiar el total
// hasta después de cobrar, aunque venderPos ya calculaba el descuento bien.
export async function previsualizarDescuentoReferidoAction(
  codigo: string,
  items: { idMarca: string | null; cantidad: number; precioUnitario: number }[]
): Promise<number> {
  if (!codigo.trim() || items.length === 0) return 0;
  const supabase = getSupabaseServerClient();
  const resuelto = await resolverCodigoProfesional(supabase, codigo);
  if (resuelto.error || !resuelto.idCodigo) return 0;
  const resultado = await calcularBeneficioReferido(
    supabase,
    items.map((i) => ({
      idProducto: null,
      idMarca: i.idMarca,
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario,
      importe: i.precioUnitario * i.cantidad,
    }))
  );
  return resultado.descuentoTotal;
}

// Para mostrarle al empleado, en vivo, cuánto puede cubrir el cliente con
// sus puntos WiiGo antes de cobrar (mismo criterio que el resto de las
// validaciones en vivo de esta pantalla).
export async function infoCanjePuntosAction(dni: string, montoAPagar: number) {
  const supabase = getSupabaseServerClient();
  const dniLimpio = dni.trim();
  if (!dniLimpio) return null;
  const { data: cliente } = await supabase.from("clientes").select("id_cliente").eq("dni", dniLimpio).maybeSingle();
  if (!cliente) return null;
  return calcularCanjePuntos(supabase, cliente.id_cliente, montoAPagar);
}

// Venta mostrador: a diferencia del Self Checkout, acá el mismo empleado
// arma el pedido y cobra en el momento — no queda pendiente esperando a
// nadie. Sirve tanto como venta asistida normal como respaldo si se cae
// la conexión de algún totem.
type ResultadoVenta = { numero: number; total: number; vuelto: number; puntosGenerados: number };

// Next.js redacta en producción el mensaje de un Error tirado desde una
// Server Action (queda solo un digest genérico en el navegador) — por eso
// esta función no throwea para errores esperables: devuelve { error }.
export async function venderPos(
  idLocal: string,
  items: ItemCarrito[],
  dni: string,
  codigoProfesional: string,
  montoRecibido: number,
  medioPago: "EFECTIVO" | "MERCADO_PAGO" = "EFECTIVO",
  formaPagoMp?: string,
  canje?: { idProfesional: string; pin: string; marcas: string[] },
  usarPuntosWiigo?: boolean
): Promise<{ error: string | null; venta?: ResultadoVenta }> {
  if (items.length === 0) return { error: "El carrito está vacío" };

  try {
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
        if (error) return { error: friendlyDbError(error) };
        idCliente = nuevo?.id_cliente ?? null;
      }
    }

  const subtotal = items.reduce((acc, i) => acc + i.precioUnitario * i.cantidad, 0);

  const codigoResuelto = await resolverCodigoProfesional(supabase, codigoProfesional);
  if (codigoResuelto.error) return { error: codigoResuelto.error };

  let resultadoReferido = null as Awaited<ReturnType<typeof calcularBeneficioReferido>> | null;
  if (codigoResuelto.idCodigo) {
    const idsVariante = items.map((i) => i.idVariante);
    const { data: variantes } = await supabase
      .from("variantes_producto")
      .select("id_variante, id_producto")
      .in("id_variante", idsVariante);
    const productoPorVariante = new Map((variantes ?? []).map((v) => [v.id_variante, v.id_producto]));

    resultadoReferido = await calcularBeneficioReferido(
      supabase,
      items.map((i) => ({
        idVariante: i.idVariante,
        idProducto: productoPorVariante.get(i.idVariante) ?? null,
        idMarca: i.idMarca,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
        importe: i.precioUnitario * i.cantidad,
      }))
    );
  }
  const descuentoBeneficio = resultadoReferido?.descuentoTotal ?? 0;

  // El profesional paga su propia compra con el saldo que acumuló vendiendo
  // cada marca — el DNI solo no alcanza, hace falta su PIN.
  let descuentoCanje = 0;
  let canjePorMarca: { idMarca: string; monto: number }[] = [];
  if (canje && canje.marcas.length > 0) {
    const pinOk = await verificarPinProfesional(supabase, canje.idProfesional, canje.pin);
    if (!pinOk) return { error: "PIN incorrecto." };
    const resultadoCanje = await calcularDescuentoCanje(
      supabase,
      canje.idProfesional,
      canje.marcas,
      items.map((i) => ({ idMarca: i.idMarca, importe: i.precioUnitario * i.cantidad }))
    );
    if (resultadoCanje.error) return { error: resultadoCanje.error };
    descuentoCanje = resultadoCanje.descuentoTotal;
    canjePorMarca = resultadoCanje.porMarca;
  }

  // El cliente puede cubrir parte de lo que le queda por pagar (después del
  // descuento de referido y del canje de la profesional) con sus propios
  // puntos WiiGo — nunca más del % tope configurado ni más de los que tiene.
  let descuentoPuntos = 0;
  let puntosACanjear = 0;
  if (usarPuntosWiigo && idCliente) {
    const montoAntesDePuntos = Math.max(subtotal - descuentoBeneficio - descuentoCanje, 0);
    const infoPuntos = await calcularCanjePuntos(supabase, idCliente, montoAntesDePuntos);
    descuentoPuntos = infoPuntos.maxDescuento;
    puntosACanjear = infoPuntos.puntosNecesarios;
  }

  const total = Math.max(subtotal - descuentoBeneficio - descuentoCanje - descuentoPuntos, 0);
  const esMercadoPago = medioPago === "MERCADO_PAGO";
  if (esMercadoPago && (!formaPagoMp || !FORMAS_PAGO_MP[formaPagoMp])) {
    return { error: "Elegí cómo pagó el cliente por Mercado Pago" };
  }
  const montoFinal = esMercadoPago ? total : montoRecibido;
  if (montoFinal < total) return { error: "El monto recibido es menor al total de la venta" };
  const vuelto = montoFinal - total;

  const idTurno = await turnoAbiertoDeLocal(supabase, idLocal);
  if (!idTurno) return { error: "No hay un turno de caja abierto en este local — abrilo en Turnos antes de vender." };

  // La venta se crea primero: pagos.id_venta no admite null, así que no
  // se puede insertar el pago hasta tener el id de la venta.
  const { data: venta, error: errorVenta } = await supabase
    .from("ventas")
    .insert({
      canal: "POS",
      id_cliente: idCliente,
      id_local: idLocal,
      subtotal,
      descuento: descuentoBeneficio + descuentoCanje + descuentoPuntos,
      descuento_puntos: descuentoPuntos,
      puntos_canjeados: puntosACanjear,
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
  if (errorVenta) return { error: friendlyDbError(errorVenta) };

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
  if (errorPago) return { error: friendlyDbError(errorPago) };

  await supabase.from("ventas").update({ id_pago: pago.id_pago }).eq("id_venta", venta.id_venta);

  const filasDetalle = items.map((i) => ({
    id_venta: venta.id_venta,
    id_variante: i.idVariante,
    id_marca: i.idMarca,
    cantidad: i.cantidad,
    precio_unitario: i.precioUnitario,
    subtotal: i.precioUnitario * i.cantidad,
  }));
  const { data: detalleInsertado, error: errorDetalle } = await supabase
    .from("detalle_ventas")
    .insert(filasDetalle)
    .select("id_detalle, id_variante");
  if (errorDetalle) return { error: friendlyDbError(errorDetalle) };

  let puntosExtra = 0;
  if (resultadoReferido && codigoResuelto.idCodigo && codigoResuelto.idProfesional) {
    const mapaVarianteADetalle = new Map((detalleInsertado ?? []).map((d) => [d.id_variante, d.id_detalle]));
    const resultadoConDetalle = enlazarDetalleVenta(resultadoReferido, mapaVarianteADetalle);
    await registrarReferido(supabase, {
      idVenta: venta.id_venta,
      idCliente,
      idCodigo: codigoResuelto.idCodigo,
      idProfesional: codigoResuelto.idProfesional,
      idLocal,
      usosActuales: codigoResuelto.usosActuales,
      totalVenta: total,
      resultado: resultadoConDetalle,
    });
    if (idCliente) puntosExtra = await puntosExtraPorMonto(supabase, resultadoReferido.puntosExtraMonto);
  }

  if (canje && canjePorMarca.length > 0) {
    await registrarCanje(supabase, { idProfesional: canje.idProfesional, idVenta: venta.id_venta, porMarca: canjePorMarca, usuario });
  }

  if (idCliente && puntosACanjear > 0) {
    await aplicarCanjePuntos(supabase, idCliente, puntosACanjear);
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
    if (errorStock) return { error: friendlyDbError(errorStock) };

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
  // la venta queda con 0 aunque la regla general esté activa. Un profesional
  // no suma puntos de club en sus propias compras (ver esProfesionalActivo).
  // Los puntos extra por código de profesional (financiados por la marca,
  // para el cliente que referenció) se suman aparte, arriba de los normales.
  const esProfesional = await esProfesionalActivo(supabase, dniLimpio || null);
  const puntosGenerados = (idCliente && !esProfesional ? await calcularPuntos(supabase, total) : 0) + puntosExtra;
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

    return { error: null, venta: { numero: venta.numero as number, total, vuelto, puntosGenerados } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar la venta" };
  }
}
