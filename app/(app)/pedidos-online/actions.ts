"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { esRolInterno } from "@/lib/rolesInternos";
import { friendlyDbError } from "@/lib/errors";
import { cargarGondola, nombreCortoZona, ubicacionDe } from "@/lib/gondola";
import { insertarRenglonesVenta } from "@/lib/costoAlVender";
import { confirmarCobro, cancelarPedido } from "@/app/(app)/cobros-efectivo/actions";
import { fechaHoraArgentina } from "@/lib/horarios";
import {
  COLUMNAS_PEDIDO,
  ESTADOS_ABIERTOS,
  FALTA_SQL_ONLINE,
  avisarCliente,
  cuantosHay,
  itemsDe,
  totalesDe,
  vencerPedidosOnline,
  type EstadoOnline,
  type FilaPedidoOnline,
  type ItemOnline,
  type PagoOnline,
} from "@/lib/pedidosOnline";

// «Pedidos online» (Gonzalo, 2026-11-16, maqueta aprobada): tres columnas,
// 1 Nuevos → 2 Armando → 3 Listos. Tarjetas chicas que abren una ventana con
// los productos y su lugar en la góndola, y UN botón para el paso siguiente.
// Si falta algo, «Falta» en el producto: el total se recalcula, y si ya
// transfirió queda «Devolver $X». Ver lib/pedidosOnline.ts.

async function sesionQueVe() {
  const s = await obtenerSesionConPantallas();
  return s && esRolInterno(s.rol) && (puedeVerPantalla(s, "pedidos-online") || puedeVerPantalla(s, "pedidos")) ? s : null;
}
const SIN_PERMISO = "No tenés habilitados los pedidos online.";

export type ItemEquipo = ItemOnline & { ubicacion: string | null };
export type PedidoOnlineEquipo = {
  idPedido: string;
  numero: number;
  codigo: string;
  estado: EstadoOnline;
  pago: PagoOnline;
  pagoOk: boolean;
  nombre: string;
  dni: string;
  creado: string;
  items: ItemEquipo[];
  totalLista: number;
  totalEfectivo: number;
  original: number;
  devolver: number;
  devuelto: boolean;
  motivo: string | null;
  entregadoAt: string | null;
};

function armar(f: FilaPedidoOnline, ubicacion: (idProducto: string) => string | null): PedidoOnlineEquipo {
  const items = itemsDe(f).map((i) => ({ ...i, ubicacion: ubicacion(i.idProducto) }));
  const t = totalesDe(items);
  return {
    idPedido: f.id_pedido,
    numero: Number(f.numero),
    codigo: f.codigo,
    estado: f.estado,
    pago: f.pago,
    pagoOk: Boolean(f.pago_ok_at),
    nombre: f.nombre,
    dni: f.dni,
    creado: f.creado,
    items,
    totalLista: t.lista,
    totalEfectivo: t.efectivo,
    original: t.original,
    devolver: Number(f.devolver) || 0,
    devuelto: Boolean(f.devuelto_at),
    motivo: f.motivo_cancelacion,
    entregadoAt: f.entregado_at,
  };
}

export async function listarPedidosOnline(): Promise<{ disponible: boolean; activos: PedidoOnlineEquipo[]; cerradosHoy: PedidoOnlineEquipo[] }> {
  if (!(await sesionQueVe())) return { disponible: true, activos: [], cerradosHoy: [] };
  const supabase = getSupabaseServerClient();
  await vencerPedidosOnline(supabase);
  const inicioHoy = new Date(`${fechaHoraArgentina().fecha}T00:00:00-03:00`).toISOString();
  const [activosRes, cerradosRes] = await Promise.all([
    supabase.from("pedidos_online").select(COLUMNAS_PEDIDO).in("estado", ESTADOS_ABIERTOS).order("creado"),
    supabase.from("pedidos_online").select(COLUMNAS_PEDIDO).in("estado", ["ENTREGADO", "CANCELADO"]).gte("creado", new Date(Date.now() - 3 * 24 * 3600_000).toISOString()).order("creado", { ascending: false }).limit(40),
  ]);
  if (activosRes.error) return { disponible: false, activos: [], cerradosHoy: [] };

  // El lugar de cada producto en la góndola, para ir directo a buscarlo.
  const activos = (activosRes.data ?? []) as FilaPedidoOnline[];
  const idLocal = activos.find((a) => a.id_local)?.id_local ?? null;
  const gondola = idLocal ? ((await cargarGondola(supabase, idLocal).catch(() => null)) ?? []) : [];
  const ubicacion = (idProducto: string) => {
    const u = ubicacionDe(gondola, idProducto);
    return u ? `${nombreCortoZona(gondola, u.modulo)} · fila ${u.fila} · lugar ${u.columna}` : null;
  };
  const cerrados = ((cerradosRes.data ?? []) as FilaPedidoOnline[]).filter((c) => (c.entregado_at ?? c.cancelado_at ?? "") >= inicioHoy);
  return { disponible: true, activos: activos.map((a) => armar(a, ubicacion)), cerradosHoy: cerrados.map((c) => armar(c, () => null)) };
}

async function traer(supabase: SupabaseClient, idPedido: string) {
  const { data, error } = await supabase.from("pedidos_online").select(COLUMNAS_PEDIDO).eq("id_pedido", idPedido).maybeSingle();
  return { fila: (data as FilaPedidoOnline | null) ?? null, error };
}

function refrescar() {
  revalidatePath("/pedidos-online");
}

/** «Llegó la transferencia»: el equipo la vio en la cuenta de Mercado Pago. */
export async function confirmarTransferencia(idPedido: string): Promise<{ error: string | null }> {
  const s = await sesionQueVe();
  if (!s) return { error: SIN_PERMISO };
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("pedidos_online")
    .update({ pago_ok_at: new Date().toISOString(), pago_ok_por: s.nombre })
    .eq("id_pedido", idPedido)
    .eq("pago", "TRANSFERENCIA")
    .is("pago_ok_at", null)
    .in("estado", ESTADOS_ABIERTOS)
    .select("id_pedido")
    .maybeSingle();
  if (error) return { error: FALTA_SQL_ONLINE };
  if (!data) return { error: "Ese pedido ya tenía la transferencia confirmada." };
  await avisarCliente(supabase, idPedido, "PAGO_OK");
  refrescar();
  return { error: null };
}

/** Paso 1 → 2. Con transferencia, solo después de ver la plata. */
export async function aceptarPedidoOnline(idPedido: string): Promise<{ error: string | null }> {
  if (!(await sesionQueVe())) return { error: SIN_PERMISO };
  const supabase = getSupabaseServerClient();
  const { fila } = await traer(supabase, idPedido);
  if (!fila || fila.estado !== "NUEVO") return { error: "Ese pedido ya no está en Nuevos." };
  if (fila.pago === "TRANSFERENCIA" && !fila.pago_ok_at) return { error: "Primero tiene que llegar la transferencia." };
  const { data } = await supabase
    .from("pedidos_online")
    .update({ estado: "ARMANDO", aceptado_at: new Date().toISOString() })
    .eq("id_pedido", idPedido)
    .eq("estado", "NUEVO")
    .select("id_pedido")
    .maybeSingle();
  if (!data) return { error: "Ese pedido ya no está en Nuevos." };
  await avisarCliente(supabase, idPedido, "ACEPTADO");
  refrescar();
  return { error: null };
}

/** Tildar un producto mientras se arma. */
export async function marcarItemOnline(idItem: string, armado: boolean): Promise<{ error: string | null }> {
  if (!(await sesionQueVe())) return { error: SIN_PERMISO };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("pedidos_online_items").update({ armado, ...(armado ? { hay: null } : {}) }).eq("id_item", idItem);
  return { error: error ? FALTA_SQL_ONLINE : null };
}

/**
 * «Falta»: cuántos se encontraron (0 = no había). null lo deshace.
 * Se puede cambiar mientras se arma; recién al tocar «Listo» queda como
 * diferencia de stock (así un toque equivocado no ensucia nada).
 */
export async function marcarFaltaOnline(idItem: string, hay: number | null): Promise<{ error: string | null }> {
  if (!(await sesionQueVe())) return { error: SIN_PERMISO };
  const supabase = getSupabaseServerClient();
  const { data: item } = await supabase.from("pedidos_online_items").select("cantidad, id_pedido, pedidos_online!inner(estado)").eq("id_item", idItem).maybeSingle();
  if (!item) return { error: "No se encontró ese producto." };
  const estado = (item.pedidos_online as unknown as { estado: string } | null)?.estado;
  if (estado !== "ARMANDO") return { error: "Solo se marca lo que falta mientras se arma el pedido." };
  const n = hay == null ? null : Math.floor(Number(hay));
  if (n != null && (!(n >= 0) || n >= Number(item.cantidad))) return { error: "Elegí cuántos encontraste." };
  const { error } = await supabase.from("pedidos_online_items").update({ hay: n, armado: false }).eq("id_item", idItem);
  return { error: error ? FALTA_SQL_ONLINE : null };
}

/**
 * Lo que faltó, como en el conteo del turno: el stock queda en lo que se
 * encontró y la diferencia le llega a Gonzalo en Conteos y diferencias.
 */
async function anotarFaltas(supabase: SupabaseClient, fila: FilaPedidoOnline, items: ItemOnline[], quien: string) {
  if (!fila.id_local) return;
  const ahora = new Date().toISOString();
  for (const i of items) {
    if (i.hay == null || i.hay >= i.cantidad) continue;
    const { data: st } = await supabase.from("stock").select("cantidad").eq("id_variante", i.idVariante).eq("id_local", fila.id_local).maybeSingle();
    const esperado = Number(st?.cantidad ?? 0);
    // Si el sistema ya decía menos de lo encontrado, no hay nada que corregir.
    if (esperado <= i.hay) continue;
    await supabase
      .from("stock")
      .upsert({ id_variante: i.idVariante, id_local: fila.id_local, cantidad: i.hay, fecha_actualizacion: ahora }, { onConflict: "id_variante,id_local" });
    await supabase.from("movimientos_stock").insert({
      id_variante: i.idVariante,
      id_local: fila.id_local,
      tipo: "AJUSTE",
      cantidad: i.hay - esperado,
      motivo: `Pedido online #${fila.numero}: se encontraron ${i.hay} de ${i.cantidad}, el sistema decía ${esperado}`,
      id_referencia: fila.id_pedido,
      usuario: quien,
    });
    await supabase.from("diferencias_stock").insert({
      id_local: fila.id_local,
      id_variante: i.idVariante,
      esperado,
      contado: i.hay,
      diferencia: i.hay - esperado,
      contado_por: quien,
      contado_en: ahora,
      nota: `Armando el pedido online #${fila.numero} (${i.nombre}${i.variante ? ` — ${i.variante}` : ""})`,
    });
  }
}

/** Paso 2 → 3. Con lo que faltó, el total nuevo y lo que hay que devolver. */
export async function marcarListoOnline(idPedido: string): Promise<{ error: string | null }> {
  const s = await sesionQueVe();
  if (!s) return { error: SIN_PERMISO };
  const supabase = getSupabaseServerClient();
  const { fila } = await traer(supabase, idPedido);
  if (!fila || fila.estado !== "ARMANDO") return { error: "Ese pedido ya no está armándose." };
  const items = itemsDe(fila);
  if (items.some((i) => !i.armado && i.hay == null)) return { error: "Tildá cada producto o marcá lo que falta." };
  if (items.every((i) => i.hay === 0)) return { error: "No hay nada de este pedido: cancelalo." };
  const t = totalesDe(items);
  const devolver = fila.pago === "TRANSFERENCIA" && fila.pago_ok_at ? Math.max(0, t.falto) : 0;
  const { data } = await supabase
    .from("pedidos_online")
    .update({ estado: "LISTO", listo_at: new Date().toISOString(), devolver })
    .eq("id_pedido", idPedido)
    .eq("estado", "ARMANDO")
    .select("id_pedido")
    .maybeSingle();
  if (!data) return { error: "Ese pedido ya no está armándose." };
  await anotarFaltas(supabase, fila, items, s.nombre);
  await avisarCliente(supabase, idPedido, "LISTO");
  refrescar();
  revalidatePath("/stock/conteos");
  return { error: null };
}

export async function cancelarPedidoOnline(idPedido: string, motivo: string): Promise<{ error: string | null }> {
  const s = await sesionQueVe();
  if (!s) return { error: SIN_PERMISO };
  const supabase = getSupabaseServerClient();
  const { fila } = await traer(supabase, idPedido);
  if (!fila || !ESTADOS_ABIERTOS.includes(fila.estado)) return { error: "Ese pedido ya estaba cerrado." };
  const items = itemsDe(fila);
  // Ya transfirió: se le devuelve todo.
  const devolver = fila.pago === "TRANSFERENCIA" && fila.pago_ok_at ? totalesDe(items).original : 0;
  const { data } = await supabase
    .from("pedidos_online")
    .update({ estado: "CANCELADO", cancelado_at: new Date().toISOString(), motivo_cancelacion: (motivo || "Cancelado por el equipo").slice(0, 200), devolver })
    .eq("id_pedido", idPedido)
    .in("estado", ESTADOS_ABIERTOS)
    .select("id_pedido")
    .maybeSingle();
  if (!data) return { error: "Ese pedido ya estaba cerrado." };
  // «No hay nada»: lo que no se encontró queda como diferencia de stock.
  if (items.some((i) => i.hay != null)) await anotarFaltas(supabase, fila, items, s.nombre);
  await avisarCliente(supabase, idPedido, "CANCELADO");
  refrescar();
  return { error: null };
}

/** Las líneas de la venta: lo que se lleva de verdad (si faltó algo, ya descontado). */
function renglones(items: ItemOnline[], precio: "lista" | "efectivo") {
  return items
    .filter((i) => cuantosHay(i) > 0)
    .map((i) => {
      const unitario = precio === "lista" ? i.precioLista : i.precioEfectivo;
      return { idVariante: i.idVariante, idMarca: i.idMarca, cantidad: cuantosHay(i), unitario, subtotal: unitario * cuantosHay(i) };
    });
}

/**
 * Paso 3, pagado por transferencia: se entrega y queda la venta (canal ONLINE,
 * Mercado Pago · Transferencia, precio de góndola) con confirmarCobro — el
 * mismo cobro de la caja: stock, puntos, profesional y factura.
 * Si había que devolver plata, primero se confirma que se devolvió.
 */
export async function entregarPedidoOnline(idPedido: string, yaDevolvi: boolean): Promise<{ error: string | null; idVenta?: string }> {
  const s = await sesionQueVe();
  if (!s) return { error: SIN_PERMISO };
  const supabase = getSupabaseServerClient();
  const { fila } = await traer(supabase, idPedido);
  if (!fila || fila.estado !== "LISTO") return { error: "Ese pedido no está listo para entregar." };
  if (fila.pago !== "TRANSFERENCIA" || !fila.pago_ok_at) return { error: "Este pedido se cobra en la caja." };
  if (!fila.id_local) return { error: "El pedido no tiene local." };
  const devolver = Number(fila.devolver) || 0;
  if (devolver > 0 && !fila.devuelto_at && !yaDevolvi) return { error: `Antes de entregarlo, devolvele ${"$" + Math.round(devolver).toLocaleString("es-AR")}.` };

  const lineas = renglones(itemsDe(fila), "lista");
  const total = lineas.reduce((t, l) => t + l.subtotal, 0);

  // La venta se arma pendiente y la confirma confirmarCobro, como en la caja.
  const { data: venta, error: errorVenta } = await supabase
    .from("ventas")
    .insert({
      canal: "ONLINE",
      id_cliente: fila.id_cliente,
      id_local: fila.id_local,
      subtotal: total,
      descuento: 0,
      descuento_puntos: 0,
      puntos_canjeados: 0,
      total,
      estado: "PENDIENTE_PAGO",
      medio_pago: "MERCADO_PAGO",
      usuario: s.nombre,
      terminal: "ONLINE",
      factura_doc_tipo: 96,
      factura_doc_nro: fila.dni,
    })
    .select("id_venta, numero")
    .single();
  if (errorVenta) return { error: friendlyDbError(errorVenta) };
  const { error: errorDetalle } = await insertarRenglonesVenta(
    supabase,
    lineas.map((l) => ({ id_venta: venta.id_venta as string, id_variante: l.idVariante, id_marca: l.idMarca, cantidad: l.cantidad, precio_unitario: l.unitario, subtotal: l.subtotal }))
  );
  if (errorDetalle) {
    await cancelarPedido(venta.id_venta as string, "No se pudo armar la venta del pedido online").catch(() => null);
    return { error: friendlyDbError(errorDetalle) };
  }
  const cobro = await confirmarCobro(venta.id_venta as string, total, "TRANSFERENCIA", s.nombre);
  if (cobro.error) {
    await cancelarPedido(venta.id_venta as string, "No se pudo confirmar el cobro del pedido online").catch(() => null);
    return { error: cobro.error };
  }

  const ahora = new Date().toISOString();
  await supabase
    .from("pedidos_online")
    .update({
      estado: "ENTREGADO",
      entregado_at: ahora,
      id_venta: venta.id_venta,
      ...(devolver > 0 && !fila.devuelto_at ? { devuelto_at: ahora, devuelto_por: s.nombre } : {}),
    })
    .eq("id_pedido", idPedido);
  await avisarCliente(supabase, idPedido, "ENTREGADO");
  refrescar();
  revalidatePath("/ventas");
  return { error: null, idVenta: venta.id_venta as string };
}

/**
 * Lo llama la caja (POS) cuando cobró un pedido que se pagaba al retirar: la
 * venta pasa a canal ONLINE (así se sabe cuáles son de la tienda) y el pedido
 * queda entregado.
 */
export async function entregarOnlineDesdeCaja(idPedido: string, idVenta: string): Promise<{ error: string | null }> {
  const s = await obtenerSesionConPantallas();
  if (!s || !esRolInterno(s.rol) || !(puedeVerPantalla(s, "pos") || puedeVerPantalla(s, "pedidos-online") || puedeVerPantalla(s, "pedidos"))) return { error: SIN_PERMISO };
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("pedidos_online")
    .update({ estado: "ENTREGADO", entregado_at: new Date().toISOString(), id_venta: idVenta })
    .eq("id_pedido", idPedido)
    .in("estado", ESTADOS_ABIERTOS)
    .select("id_pedido")
    .maybeSingle();
  if (!data) return { error: null };
  await supabase.from("ventas").update({ canal: "ONLINE" }).eq("id_venta", idVenta);
  await avisarCliente(supabase, idPedido, "ENTREGADO");
  revalidatePath("/pedidos-online");
  revalidatePath("/ventas");
  return { error: null };
}
