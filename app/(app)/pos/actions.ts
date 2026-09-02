"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { turnoAbiertoDeLocal } from "@/app/(app)/turnos/actions";
import { facturarAlAcreditarse } from "@/lib/arca/config";
import {
  calcularBeneficioReferido,
  resolverCodigoProfesional,
  registrarReferido,
  puntosExtraPorMonto,
  enlazarDetalleVenta,
} from "@/lib/referidosProfesionales";
import { buscarProfesionalPorDni, verificarPinProfesional, calcularDescuentoCanje, registrarCanje, esProfesionalActivo } from "@/lib/canjesProfesionales";
import { calcularCanjePuntos, aplicarCanjePuntos } from "@/lib/puntosWiigo";
import { crearOrdenQrMp } from "@/lib/mercadopago";
import { confirmarCobro } from "@/app/(app)/cobros-efectivo/actions";
import QRCode from "qrcode";
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
// `dni` es el del comprador: una profesional no puede aplicarse a sí misma
// el código de descuento (ni el suyo ni el de otra) — ver venderPos.
export async function previsualizarDescuentoReferidoAction(
  codigo: string,
  items: { idMarca: string | null; cantidad: number; precioUnitario: number }[],
  dni?: string
): Promise<number> {
  if (!codigo.trim() || items.length === 0) return 0;
  const supabase = getSupabaseServerClient();
  const compradorEsProfesional = await esProfesionalActivo(supabase, dni?.trim() || null);
  if (compradorEsProfesional) return 0;
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

// Venta mostrador: en Efectivo el mismo empleado arma el pedido y cobra en
// el momento, no queda pendiente esperando a nadie. En Mercado Pago genera
// un QR (igual que el totem) y la venta queda PENDIENTE_PAGO hasta que el
// cliente paga desde su celular — la confirma sola el webhook, reusando
// confirmarCobro. Sirve tanto como venta asistida normal como respaldo si
// se cae la conexión de algún totem.
type ResultadoVenta = { numero: number; total: number; vuelto: number; puntosGenerados: number };
type ResultadoPedidoMp = { idVenta: string; numero: number; total: number; qrImagen?: string };

// Para que el POS sepa cuándo el cliente ya pagó el QR y pasar solo a la
// pantalla de éxito, sin que el empleado tenga que estar preguntando.
export async function estadoVentaPos(idVenta: string): Promise<{ estado: string; numero: number; total: number }> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("ventas").select("estado, numero, total").eq("id_venta", idVenta).maybeSingle();
  if (error) throw new Error(friendlyDbError(error));
  if (!data) throw new Error("No se encontró la venta");
  return { estado: data.estado as string, numero: data.numero as number, total: data.total as number };
}

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
  canje?: { idProfesional: string; pin: string; marcas: string[] },
  usarPuntosWiigo?: boolean
): Promise<{ error: string | null; venta?: ResultadoVenta; pedido?: ResultadoPedidoMp }> {
  if (items.length === 0) return { error: "El carrito está vacío" };

  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    // Igual que en el totem: un DNI que no está registrado no se da de alta
    // solo acá — el personal lo tiene que cargar a mano en Clientes con sus
    // datos reales. Esta venta simplemente no suma puntos hasta que eso pase.
    let idCliente: string | null = null;
    const dniLimpio = dni.trim();
    if (dniLimpio) {
      const { data: existente } = await supabase
        .from("clientes")
        .select("id_cliente")
        .eq("dni", dniLimpio)
        .maybeSingle();
      idCliente = existente?.id_cliente ?? null;
    }

  const subtotal = items.reduce((acc, i) => acc + i.precioUnitario * i.cantidad, 0);

  // Una profesional no puede usar el código de descuento de otra (ni el
  // suyo propio) para su propia compra — el beneficio de referido es para
  // sus pacientes/clientes, no tiene sentido que se lo aplique ella misma.
  // Se comprueba con el mismo DNI que identificó al comprador arriba.
  const compradorEsProfesional = await esProfesionalActivo(supabase, dniLimpio || null);

  const codigoResuelto = compradorEsProfesional
    ? { error: null, idCodigo: null, idProfesional: null, usosActuales: 0 }
    : await resolverCodigoProfesional(supabase, codigoProfesional);
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

  if (medioPago === "MERCADO_PAGO") {
    // Con Mercado Pago la plata se mueve apenas el cliente escanea el QR —
    // si no hay turno abierto en ese momento, la confirmación automática
    // del webhook se rechaza (confirmarCobro la exige) y la venta queda
    // PENDIENTE_PAGO para siempre con la plata ya cobrada, sin que nadie se
    // entere solo. Mejor no generar el QR si no hay turno.
    if (total > 0) {
      const idTurno = await turnoAbiertoDeLocal(supabase, idLocal);
      if (!idTurno) {
        return { error: "No hay un turno de caja abierto en este local — abrilo en Turnos antes de generar el QR." };
      }
    }

    // La venta queda pendiente y se genera el QR — igual que el totem, la
    // confirmación real (stock, puntos, referidos, comisión de MP) llega
    // sola por el webhook cuando el cliente paga desde su celular (ver
    // app/api/mercadopago-webhook/route.ts), reusando confirmarCobro.
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
        estado: "PENDIENTE_PAGO",
        medio_pago: "MERCADO_PAGO",
        usuario,
        terminal: "POS",
        id_codigo_profesional: codigoResuelto.idCodigo,
        id_profesional_canje: canje && canje.marcas.length > 0 ? canje.idProfesional : null,
        marcas_canje: canje && canje.marcas.length > 0 ? canje.marcas : null,
      })
      .select("id_venta, numero")
      .single();
    if (errorVenta) return { error: friendlyDbError(errorVenta) };

    const filasDetalle = items.map((i) => ({
      id_venta: venta.id_venta,
      id_variante: i.idVariante,
      id_marca: i.idMarca,
      cantidad: i.cantidad,
      precio_unitario: i.precioUnitario,
      subtotal: i.precioUnitario * i.cantidad,
    }));
    const { error: errorDetalle } = await supabase.from("detalle_ventas").insert(filasDetalle);
    if (errorDetalle) return { error: friendlyDbError(errorDetalle) };

    // Cubierto entero con puntos/canje: no tiene sentido generar un QR de
    // $0 — se confirma directo, igual que si el empleado la cobrara ahí.
    if (total <= 0) {
      const resultadoCobro = await confirmarCobro(venta.id_venta, 0, undefined, usuario ?? undefined);
      if (resultadoCobro.error) return { error: resultadoCobro.error };
      return { error: null, venta: { numero: venta.numero as number, total: 0, vuelto: 0, puntosGenerados: 0 } };
    }

    try {
      const { data: cfg } = await supabase
        .from("configuracion")
        .select("valor")
        .eq("parametro", "MP_EXTERNAL_POS_ID")
        .maybeSingle();
      const externalPosId = cfg?.valor;
      if (!externalPosId) {
        return { error: "Mercado Pago todavía no está conectado — pedile a un administrador que lo conecte en Configuración." };
      }
      const orden = await crearOrdenQrMp({
        idVenta: venta.id_venta,
        total,
        externalPosId,
        descripcion: `Venta WiiGo #${venta.numero}`,
      });
      const qrImagen = await QRCode.toDataURL(orden.qrData, { margin: 1, width: 400 });
      await supabase.from("ventas").update({ id_orden_mp: orden.idOrden }).eq("id_venta", venta.id_venta);
      return {
        error: null,
        pedido: { idVenta: venta.id_venta, numero: venta.numero as number, total, qrImagen },
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "No se pudo generar el QR de Mercado Pago" };
    }
  }

  const montoFinal = montoRecibido;
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
      medio_pago: "EFECTIVO",
      total_cobrado: montoFinal,
      usuario,
      terminal: "POS",
      id_turno: idTurno,
    })
    .select("id_venta, numero")
    .single();
  if (errorVenta) return { error: friendlyDbError(errorVenta) };

  // El efectivo no tiene comisión ni conciliación externa: neto = bruto, y
  // queda acreditado en el momento.
  const pagoInsert: Record<string, unknown> = {
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
  const puntosGenerados = (idCliente && !compradorEsProfesional ? await calcularPuntos(supabase, total) : 0) + puntosExtra;
  await supabase.from("ventas").update({ puntos_generados: puntosGenerados }).eq("id_venta", venta.id_venta);

  if (idCliente && puntosGenerados > 0) {
    const { data: cliente } = await supabase.from("clientes").select("puntos").eq("id_cliente", idCliente).maybeSingle();
    await supabase
      .from("clientes")
      .update({ puntos: (cliente?.puntos ?? 0) + puntosGenerados })
      .eq("id_cliente", idCliente);
  }

  // La venta del POS se cobra en el acto, así que se factura acá mismo. Si
  // ARCA falla no pasa nada: la venta queda cobrada y aparece en Ventas como
  // pendiente de facturar (ver lib/arca/config.ts).
  {
    const { data: clienteFactura } = idCliente
      ? await supabase.from("clientes").select("dni").eq("id_cliente", idCliente).maybeSingle()
      : { data: null };
    await facturarAlAcreditarse(venta.id_venta as string, "EFECTIVO", clienteFactura?.dni ?? null);
  }

  revalidatePath("/pos");
  revalidatePath("/stock");
  revalidatePath("/ventas");

    return { error: null, venta: { numero: venta.numero as number, total, vuelto, puntosGenerados } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar la venta" };
  }
}
