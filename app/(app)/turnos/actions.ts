"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import type { SupabaseClient } from "@supabase/supabase-js";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

async function sesionActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session ? { idUsuario: session.sub as string, nombre: (session.nombre as string) ?? null } : null;
}

/** Administración: puede cerrar la caja de cualquiera, recontar sobres y cambiar el fondo de cambio. */
async function puedeAdministrarCaja() {
  return tienePermiso(await obtenerSesionConPermisos(), PERMISOS.VER_CAJA_ADMIN);
}

/** Si el error es porque todavía no se corrió sql/llamados-y-caja.sql. */
const faltaColumna = (mensaje: string) => /column|schema cache|does not exist/i.test(mensaje);

const BUCKET_ARQUEOS = "arqueos-caja";

/** Sube la foto del arqueo (data:image/jpeg;base64,...). Crea el depósito la primera vez. */
async function subirFotoArqueo(supabase: SupabaseClient, idTurno: string, foto: string) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(foto);
  if (!m) return { path: null, error: "La foto no se pudo leer. Sacala de nuevo." };
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > 6_000_000) return { path: null, error: "La foto es demasiado grande." };
  const path = `${idTurno}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  const subir = () => supabase.storage.from(BUCKET_ARQUEOS).upload(path, buffer, { upsert: true, contentType: `image/${m[1]}` });
  let { error } = await subir();
  if (error && /not found|bucket/i.test(error.message)) {
    await supabase.storage.createBucket(BUCKET_ARQUEOS, { public: false });
    ({ error } = await subir());
  }
  return error ? { path: null, error: `No se pudo guardar la foto: ${error.message}` } : { path, error: null };
}

// Usado por POS y Cobros en Efectivo para saber a qué turno estampar una
// venta que se está cobrando ahora mismo. Si no hay ninguno abierto,
// devuelve null y esos módulos rechazan la venta — no se puede cobrar
// sin un turno de caja abierto en ese local.
export async function turnoAbiertoDeLocal(supabase: SupabaseClient, idLocal: string) {
  const { data } = await supabase
    .from("turnos")
    .select("id_turno")
    .eq("id_local", idLocal)
    .eq("estado", "ABIERTO")
    .maybeSingle();
  return data?.id_turno ?? null;
}

// Next.js redacta en producción el mensaje de un Error tirado desde una
// Server Action (queda solo un digest genérico en el navegador) — por eso
// esta función no throwea para errores esperables: devuelve { error }.
//
// cambioEsperado: lo que tenía que tener el sobre de cambio. Si se abre con
// otro monto queda registrado, y administración lo ve.
export async function abrirTurno(idLocal: string, montoInicial: number, cambioEsperado?: number): Promise<{ error: string | null }> {
  if (montoInicial < 0) return { error: "El fondo inicial no puede ser negativo" };

  try {
    const supabase = getSupabaseServerClient();
    const existente = await turnoAbiertoDeLocal(supabase, idLocal);
    if (existente) return { error: "Ya hay un turno abierto en este local — cerralo antes de abrir uno nuevo." };

    const sesion = await sesionActual();
    const base = {
      id_local: idLocal,
      usuario_apertura: sesion?.nombre ?? null,
      monto_inicial_efectivo: montoInicial,
      estado: "ABIERTO",
    };
    let { error } = await supabase.from("turnos").insert({
      ...base,
      id_usuario_apertura: sesion?.idUsuario ?? null,
      cambio_esperado: cambioEsperado ?? null,
    });
    if (error && faltaColumna(error.message)) ({ error } = await supabase.from("turnos").insert(base));
    if (error) {
      // El índice único de un solo turno abierto por local.
      if (/duplicate|unique/i.test(error.message)) return { error: "Ya hay un turno abierto en este local — cerralo antes de abrir uno nuevo." };
      return { error: friendlyDbError(error) };
    }

    revalidatePath("/turnos");
    revalidatePath("/ficha-asistencia");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo abrir el turno" };
  }
}

// El arqueo cuenta PLATA QUE PASÓ POR EL CAJÓN, no ventas válidas. Son dos
// preguntas distintas y confundirlas descuadra la caja:
//
//   PAGADA   entró la plata y ahí sigue.
//   ANULADA  entró la plata igual —se cobró en este turno— y después salió
//            por el reintegro, que se resta más abajo. Si no se cuenta la
//            entrada pero sí la salida, el cajón cierra con un faltante del
//            tamaño de la venta anulada.
//
// Una pendiente de Self Checkout que nadie confirmó no estampa turno, así que
// no entra por ningún lado: ahí no hubo plata.
//
// El vuelto se registra como salida aparte: total_cobrado es lo que el
// cliente entregó en mano (bruto), total es lo que realmente queda en la
// venta (neto) — la diferencia es el vuelto que salió de la caja.
async function resumenTurno(supabase: SupabaseClient, idTurno: string) {
  const { data: ventas, error } = await supabase
    .from("ventas")
    .select("total, total_cobrado, medio_pago, estado")
    .eq("id_turno", idTurno)
    .in("estado", ["PAGADA", "ANULADA"]);
  if (error) throw new Error(friendlyDbError(error));

  let totalEfectivo = 0;
  let totalRecibidoEfectivo = 0;
  let totalMercadoPago = 0;
  let cantidadVentas = 0;
  for (const v of ventas ?? []) {
    // El contador sí es de ventas: una anulada no se vendió.
    if (v.estado === "PAGADA") cantidadVentas++;
    if (v.medio_pago === "EFECTIVO") {
      totalEfectivo += v.total ?? 0;
      totalRecibidoEfectivo += v.total_cobrado ?? v.total ?? 0;
    } else {
      totalMercadoPago += v.total ?? 0;
    }
  }

  // Solo los gastos pagados con el efectivo de este turno tocan el
  // arqueo — los pagados por transferencia, tarjeta o desde Caja
  // Administración no salen de esta caja física.
  const { data: gastos } = await supabase
    .from("gastos")
    .select("monto")
    .eq("id_turno", idTurno)
    .eq("medio_pago", "EFECTIVO_TURNO")
    .eq("anulado", false);
  const totalGastosEfectivo = (gastos ?? []).reduce((acc, g) => acc + (g.monto ?? 0), 0);

  // Mismo criterio para los pagos a proveedores hechos en efectivo de este
  // turno — el importe ahí se guarda negativo (resta saldo), por eso se
  // invierte el signo para sumarlo como salida de caja.
  const { data: pagosProveedor } = await supabase
    .from("movimientos_cuenta_proveedor")
    .select("importe")
    .eq("id_turno", idTurno)
    .eq("medio_pago", "EFECTIVO_TURNO");
  const totalPagosProveedorEfectivo = (pagosProveedor ?? []).reduce((acc, m) => acc - (m.importe ?? 0), 0);

  // Toda la plata devuelta desde este cajón, se haya anulado la venta entera
  // o devuelto un solo producto.
  //
  // Antes esto se leía de `ventas` filtrando por estado ANULADA, y por eso las
  // devoluciones PARCIALES no aparecían nunca: la venta sigue PAGADA, así que
  // el billete salía del cajón sin que el arqueo lo supiera. Con varias
  // devoluciones parciales en el día, al cerrar faltaba plata y la diferencia
  // quedaba a nombre de quien contó.
  //
  // La tabla `devoluciones` tiene las dos clases con todo lo que hace falta:
  // cuánto se devolvió, por qué medio y de qué turno salió. Y un reintegro en
  // efectivo exige turno abierto (ver registrarDevolucion), así que ninguno
  // puede quedar sin arqueo.
  //
  // El filtro por medio es el que hace falta: una venta cobrada por Mercado
  // Pago y reintegrada por Mercado Pago no toca este cajón, y una cobrada por
  // QR pero devuelta en efectivo sí lo vacía aunque nunca haya entrado acá.
  const { data: devoluciones } = await supabase
    .from("devoluciones")
    .select("monto_devuelto")
    .eq("id_turno", idTurno)
    .eq("medio", "EFECTIVO_TURNO");
  const totalDevolucionesEfectivo = (devoluciones ?? []).reduce(
    (acc, d) => acc + (d.monto_devuelto ?? 0),
    0
  );

  return {
    totalEfectivo,
    totalMercadoPago,
    totalVueltoEntregado: totalRecibidoEfectivo - totalEfectivo,
    totalGastosEfectivo,
    totalPagosProveedorEfectivo,
    totalDevolucionesEfectivo,
    cantidadVentas,
  };
}

export async function resumenTurnoAbierto(idTurno: string) {
  const supabase = getSupabaseServerClient();
  const { data: turno, error } = await supabase
    .from("turnos")
    .select("monto_inicial_efectivo")
    .eq("id_turno", idTurno)
    .maybeSingle();
  if (error) throw new Error(friendlyDbError(error));
  if (!turno) throw new Error("No se encontró el turno");

  const resumen = await resumenTurno(supabase, idTurno);
  return {
    ...resumen,
    montoInicial: turno.monto_inicial_efectivo,
    efectivoEsperado:
      turno.monto_inicial_efectivo +
      resumen.totalEfectivo -
      resumen.totalGastosEfectivo -
      resumen.totalPagosProveedorEfectivo -
      resumen.totalDevolucionesEfectivo,
  };
}

export type ArqueoCierre = {
  /** Cantidad de billetes por valor ("20000": 5, ...) y "otros": monto suelto en billetes chicos y monedas. */
  billetes: Record<string, number>;
  /** Lo que queda en el sobre de cambio para el turno siguiente. */
  cambioDejado: number;
  /** Foto de la plata contada y los sobres (data:image/jpeg;base64,...). */
  foto?: string | null;
  /** Firma del arqueo (data:image/png;base64,...). */
  firma?: string | null;
};

// Cierre con arqueo. La caja la cierra quien la abrió, o administración.
//
// Con sobre de cambio (arqueo.cambioDejado): a la Caja Administración pasa
// solo la recaudación (lo contado menos el cambio que queda para el
// siguiente). Antes pasaba todo lo contado y el fondo de cambio se sumaba
// una y otra vez en cada turno.
export async function cerrarTurno(
  idTurno: string,
  efectivoContado: number,
  observaciones: string,
  arqueo?: ArqueoCierre
): Promise<{ error: string | null }> {
  if (efectivoContado < 0) return { error: "El efectivo contado no puede ser negativo" };

  try {
    const supabase = getSupabaseServerClient();
    const { data: turno, error: errorTurno } = await supabase.from("turnos").select("*").eq("id_turno", idTurno).maybeSingle();
    if (errorTurno) return { error: friendlyDbError(errorTurno) };
    if (!turno) return { error: "No se encontró el turno" };
    if (turno.estado !== "ABIERTO") return { error: "Este turno ya está cerrado" };

    const sesion = await sesionActual();
    const admin = await puedeAdministrarCaja();
    const esQuienAbrio =
      (Boolean(turno.id_usuario_apertura) && turno.id_usuario_apertura === sesion?.idUsuario) || turno.usuario_apertura === sesion?.nombre;
    if (!admin && !esQuienAbrio) {
      return { error: `Esta caja la abrió ${turno.usuario_apertura ?? "otra persona"}: la cierra esa persona o administración.` };
    }
    if (!admin && (!arqueo?.foto || !arqueo?.firma)) return { error: "Para cerrar la caja falta la foto de la plata contada y tu firma." };

    const resumen = await resumenTurno(supabase, idTurno);
    const efectivoEsperado =
      turno.monto_inicial_efectivo +
      resumen.totalEfectivo -
      resumen.totalGastosEfectivo -
      resumen.totalPagosProveedorEfectivo -
      resumen.totalDevolucionesEfectivo;
    const diferencia = efectivoContado - efectivoEsperado;
    if (diferencia !== 0 && !observaciones.trim()) return { error: "La caja no cuadra: escribí qué pasó antes de cerrar." };

    const usuario = sesion?.nombre ?? (await usuarioActual());
    const cambioDejado = arqueo ? Math.min(Math.max(0, arqueo.cambioDejado), efectivoContado) : null;
    const recaudacion = cambioDejado !== null ? efectivoContado - cambioDejado : efectivoContado;

    let fotoPath: string | null = null;
    if (arqueo?.foto) {
      const subida = await subirFotoArqueo(supabase, idTurno, arqueo.foto);
      if (subida.error) return { error: subida.error };
      fotoPath = subida.path;
    }

    const base = {
      estado: "CERRADO",
      usuario_cierre: usuario,
      fecha_cierre: new Date().toISOString(),
      efectivo_esperado: efectivoEsperado,
      efectivo_contado: efectivoContado,
      diferencia_efectivo: diferencia,
      total_mercado_pago: resumen.totalMercadoPago,
      total_vuelto_entregado: resumen.totalVueltoEntregado,
      total_gastos_efectivo: resumen.totalGastosEfectivo,
      total_pagos_proveedor_efectivo: resumen.totalPagosProveedorEfectivo,
      cantidad_ventas: resumen.cantidadVentas,
      observaciones: observaciones || null,
    };
    const extra = arqueo
      ? {
          id_usuario_cierre: sesion?.idUsuario ?? null,
          conteo_billetes: arqueo.billetes,
          cambio_dejado: cambioDejado,
          recaudacion,
          foto_arqueo: fotoPath,
          firma_cierre: arqueo.firma ?? null,
        }
      : { id_usuario_cierre: sesion?.idUsuario ?? null };
    // Solo si sigue abierto: si dos personas cierran a la vez, cierra una sola.
    let { data: cerrado, error } = await supabase.from("turnos").update({ ...base, ...extra }).eq("id_turno", idTurno).eq("estado", "ABIERTO").select("id_turno");
    if (error && faltaColumna(error.message)) {
      ({ data: cerrado, error } = await supabase.from("turnos").update(base).eq("id_turno", idTurno).eq("estado", "ABIERTO").select("id_turno"));
    }
    if (error) return { error: friendlyDbError(error) };
    if (!cerrado || cerrado.length === 0) return { error: "Este turno ya está cerrado" };

    // La recaudación entra a la Caja Administración — es el único lugar
    // donde se junta la plata de todos los cierres, para que administración
    // sepa cuánto tiene sin sumar a mano. El sobre de cambio queda en el local.
    const { data: local } = await supabase.from("locales").select("nombre").eq("id_local", turno.id_local).maybeSingle();
    const { error: errorMov } = await supabase.from("movimientos_caja_admin").insert({
      tipo: "INGRESO_TURNO",
      monto: recaudacion,
      id_turno: idTurno,
      descripcion: `Cierre de turno — ${local?.nombre ?? "Local"} — ${usuario ?? "—"}${cambioDejado !== null ? " (sobre de recaudación)" : ""}`,
      usuario,
    });
    if (errorMov) console.error("No se pudo registrar el cierre en la Caja Administración:", errorMov.message);

    revalidatePath("/turnos");
    revalidatePath("/gastos-ingresos");
    revalidatePath("/ficha-asistencia");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cerrar el turno" };
  }
}

export async function historialTurnos(idLocal: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("turnos")
    .select("*")
    .eq("id_local", idLocal)
    .eq("estado", "CERRADO")
    .order("fecha_cierre", { ascending: false })
    .limit(50);
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

/**
 * Administración cuenta el sobre de recaudación de un turno. Si da distinto
 * de lo que contó el operativo, queda marcado, y el ingreso a la Caja
 * Administración pasa a ser lo que contó administración (la plata real).
 */
export async function confirmarRecuento(idTurno: string, monto: number): Promise<{ error: string | null }> {
  if (!(await puedeAdministrarCaja())) return { error: "Solo administración puede recontar los sobres." };
  if (!(monto >= 0)) return { error: "Escribí cuánto había en el sobre." };
  const supabase = getSupabaseServerClient();
  const usuario = await usuarioActual();
  const { error } = await supabase
    .from("turnos")
    .update({ recuento: monto, recuento_por: usuario, recuento_en: new Date().toISOString() })
    .eq("id_turno", idTurno);
  if (error) return { error: faltaColumna(error.message) ? "Falta correr sql/llamados-y-caja.sql en Supabase." : friendlyDbError(error) };
  await supabase
    .from("movimientos_caja_admin")
    .update({ monto })
    .eq("id_turno", idTurno)
    .eq("tipo", "INGRESO_TURNO");
  revalidatePath("/turnos");
  revalidatePath("/gastos-ingresos");
  return { error: null };
}

/** Link temporal (10 minutos) para ver la foto de un arqueo. */
export async function urlFotoArqueo(path: string): Promise<string | null> {
  if (!(await puedeAdministrarCaja())) return null;
  const supabase = getSupabaseServerClient();
  const { data } = await supabase.storage.from(BUCKET_ARQUEOS).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

/** El sobre de cambio con el que abre cada turno de un local. */
export async function actualizarFondoCambio(idLocal: string, monto: number): Promise<{ error: string | null }> {
  if (!(await puedeAdministrarCaja())) return { error: "Solo administración puede cambiar el fondo de cambio." };
  if (!(monto >= 0)) return { error: "El monto no es válido." };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("locales").update({ fondo_cambio: monto }).eq("id_local", idLocal);
  if (error) return { error: faltaColumna(error.message) ? "Falta correr sql/llamados-y-caja.sql en Supabase." : friendlyDbError(error) };
  revalidatePath("/turnos");
  return { error: null };
}

// Detalle de un turno para poder auditar rápido dónde está una diferencia
// de arqueo: cada venta con hora, medio de pago y qué productos incluía.
export async function ventasDeTurno(idTurno: string) {
  const supabase = getSupabaseServerClient();
  const { data: ventas, error } = await supabase
    .from("ventas")
    .select("id_venta, numero, fecha, medio_pago, total, total_cobrado, usuario")
    .eq("id_turno", idTurno)
    .eq("estado", "PAGADA")
    .order("fecha", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));

  const idsVenta = (ventas ?? []).map((v) => v.id_venta);
  const { data: detalle } = await supabase
    .from("detalle_ventas")
    .select("id_venta, id_variante, cantidad")
    .in("id_venta", idsVenta.length > 0 ? idsVenta : ["00000000-0000-0000-0000-000000000000"]);

  const idsVariante = [...new Set((detalle ?? []).map((d) => d.id_variante))];
  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_variante", idsVariante.length > 0 ? idsVariante : ["00000000-0000-0000-0000-000000000000"]);
  const variantePorId = new Map((variantes ?? []).map((v) => [v.id_variante, v]));
  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto))];
  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre")
    .in("id_producto", idsProducto.length > 0 ? idsProducto : ["00000000-0000-0000-0000-000000000000"]);
  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto, p]));

  const detallePorVenta = new Map<string, string[]>();
  for (const d of detalle ?? []) {
    const variante = variantePorId.get(d.id_variante);
    const producto = variante ? productoPorId.get(variante.id_producto) : undefined;
    const nombre = `${producto?.nombre ?? "Producto"}${
      variante && variante.nombre !== "Único" ? ` — ${variante.nombre}` : ""
    }`;
    const arr = detallePorVenta.get(d.id_venta) ?? [];
    arr.push(`${nombre} x${d.cantidad}`);
    detallePorVenta.set(d.id_venta, arr);
  }

  return (ventas ?? []).map((v) => ({
    idVenta: v.id_venta,
    numero: v.numero,
    fecha: v.fecha,
    medioPago: v.medio_pago,
    total: v.total ?? 0,
    totalCobrado: v.total_cobrado,
    usuario: v.usuario,
    productos: (detallePorVenta.get(v.id_venta) ?? []).join(", "),
  }));
}
