"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import type { SupabaseClient } from "@supabase/supabase-js";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
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
export async function abrirTurno(idLocal: string, montoInicial: number): Promise<{ error: string | null }> {
  if (montoInicial < 0) return { error: "El fondo inicial no puede ser negativo" };

  try {
    const supabase = getSupabaseServerClient();
    const existente = await turnoAbiertoDeLocal(supabase, idLocal);
    if (existente) return { error: "Ya hay un turno abierto en este local — cerralo antes de abrir uno nuevo." };

    const usuario = await usuarioActual();
    const { error } = await supabase.from("turnos").insert({
      id_local: idLocal,
      usuario_apertura: usuario,
      monto_inicial_efectivo: montoInicial,
      estado: "ABIERTO",
    });
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/turnos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo abrir el turno" };
  }
}

// Solo cuenta ventas ya PAGADAS — una pendiente de Self Checkout que
// todavía no confirmó nadie no estampa turno ni entra en el arqueo.
// El vuelto se registra como salida aparte: total_cobrado es lo que el
// cliente entregó en mano (bruto), total es lo que realmente queda en la
// venta (neto) — la diferencia es el vuelto que salió de la caja.
async function resumenTurno(supabase: SupabaseClient, idTurno: string) {
  const { data: ventas, error } = await supabase
    .from("ventas")
    .select("total, total_cobrado, medio_pago")
    .eq("id_turno", idTurno)
    .eq("estado", "PAGADA");
  if (error) throw new Error(friendlyDbError(error));

  let totalEfectivo = 0;
  let totalRecibidoEfectivo = 0;
  let totalMercadoPago = 0;
  for (const v of ventas ?? []) {
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
    .eq("medio_pago", "EFECTIVO_TURNO");
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

  return {
    totalEfectivo,
    totalMercadoPago,
    totalVueltoEntregado: totalRecibidoEfectivo - totalEfectivo,
    totalGastosEfectivo,
    totalPagosProveedorEfectivo,
    cantidadVentas: (ventas ?? []).length,
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
      turno.monto_inicial_efectivo + resumen.totalEfectivo - resumen.totalGastosEfectivo - resumen.totalPagosProveedorEfectivo,
  };
}

export async function cerrarTurno(
  idTurno: string,
  efectivoContado: number,
  observaciones: string
): Promise<{ error: string | null }> {
  if (efectivoContado < 0) return { error: "El efectivo contado no puede ser negativo" };

  try {
    const supabase = getSupabaseServerClient();
    const { data: turno, error: errorTurno } = await supabase
      .from("turnos")
      .select("estado, monto_inicial_efectivo, id_local")
      .eq("id_turno", idTurno)
      .maybeSingle();
    if (errorTurno) return { error: friendlyDbError(errorTurno) };
    if (!turno) return { error: "No se encontró el turno" };
    if (turno.estado !== "ABIERTO") return { error: "Este turno ya está cerrado" };

    const resumen = await resumenTurno(supabase, idTurno);
    const efectivoEsperado =
      turno.monto_inicial_efectivo + resumen.totalEfectivo - resumen.totalGastosEfectivo - resumen.totalPagosProveedorEfectivo;
    const usuario = await usuarioActual();

    const { error } = await supabase
      .from("turnos")
      .update({
        estado: "CERRADO",
        usuario_cierre: usuario,
        fecha_cierre: new Date().toISOString(),
        efectivo_esperado: efectivoEsperado,
        efectivo_contado: efectivoContado,
        diferencia_efectivo: efectivoContado - efectivoEsperado,
        total_mercado_pago: resumen.totalMercadoPago,
        total_vuelto_entregado: resumen.totalVueltoEntregado,
        total_gastos_efectivo: resumen.totalGastosEfectivo,
        total_pagos_proveedor_efectivo: resumen.totalPagosProveedorEfectivo,
        cantidad_ventas: resumen.cantidadVentas,
        observaciones: observaciones || null,
      })
      .eq("id_turno", idTurno);
    if (error) return { error: friendlyDbError(error) };

    // El efectivo contado entra solo a la Caja Administración — es el
    // único lugar donde se junta la plata de todos los cierres de todos
    // los turnos, para que administración sepa cuánto tiene sin sumar a mano.
    const { data: local } = await supabase.from("locales").select("nombre").eq("id_local", turno.id_local).maybeSingle();
    await supabase.from("movimientos_caja_admin").insert({
      tipo: "INGRESO_TURNO",
      monto: efectivoContado,
      id_turno: idTurno,
      descripcion: `Cierre de turno — ${local?.nombre ?? "Local"} — ${usuario ?? "—"}`,
      usuario,
    });

    revalidatePath("/turnos");
    revalidatePath("/gastos");
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
