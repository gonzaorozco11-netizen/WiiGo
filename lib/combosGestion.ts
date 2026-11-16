// Administrar combos (Gonzalo, 2026-11-16): lo comparten el portal de la marca
// (Mis combos), tu pantalla Combos del sistema y Aprobaciones.
//
// Reglas:
// - La marca VE sus combos, PIDE cambiar el precio o armar uno nuevo (entra
//   como solicitud a Aprobaciones: COMBO_PRECIO / COMBO_NUEVO) y PAUSA o
//   reactiva al instante (no cambia el precio de nadie).
// - WiiGo (la pantalla Combos) hace todo directo.
// - El precio de un combo tiene que ser menor que los productos sueltos (con
//   tarjeta y en efectivo): si no, no es un combo.
// - Estados: ACTIVO (se aplica), PAUSADO (no se aplica, se puede reactivar),
//   BORRADO (solo WiiGo; deja de verse). Nunca se borra la fila: las ventas
//   que ya lo usaron la siguen nombrando (detalle_ventas.id_combo).
// La cuenta de cómo se aplica en una compra está en lib/combos.ts.

import type { SupabaseClient } from "@supabase/supabase-js";

export type EstadoCombo = "ACTIVO" | "PAUSADO" | "BORRADO";

export type ProductoCombo = { idProducto: string; nombre: string; precio: number; precioEfectivo: number; imagen: string | null };

export type ComboGestion = {
  id: string;
  nombre: string;
  marca: string | null;
  idMarca: string | null;
  precio: number;
  precioEfectivo: number | null;
  imagen: string | null;
  estado: EstadoCombo;
  orden: number;
  grupos: { cantidad: number; productos: ProductoCombo[] }[];
  /** Lo que salen los productos sueltos (el más barato de cada grupo). */
  suelto: number;
  sueltoEfectivo: number;
  /** Combos vendidos en el mes (unidades del combo, no de productos). */
  vendidosMes: number;
  /** Un cambio de precio que la marca pidió y espera aprobación. */
  pedido: { precio: number; precioEfectivo: number | null } | null;
};

export type GrupoEntrada = { cantidad: number; productos: string[] };

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0);

/** Los combos (de una marca o de todas), con sus productos, sueltos, vendidos del mes y el pedido pendiente. */
export async function listarCombos(supabase: SupabaseClient, opciones: { idMarca?: string; conBorrados?: boolean } = {}): Promise<ComboGestion[]> {
  let q = supabase.from("combos").select("*").order("orden", { ascending: true });
  if (opciones.idMarca) q = q.eq("id_marca", opciones.idMarca);
  if (!opciones.conBorrados) q = q.neq("estado", "BORRADO");
  const { data: combos, error } = await q;
  if (error || !combos || combos.length === 0) return [];

  const idsProducto = [...new Set(combos.flatMap((c) => ((c.grupos as GrupoEntrada[]) ?? []).flatMap((g) => g.productos ?? [])))];
  const { data: productos } = idsProducto.length
    ? await supabase.from("productos").select("id_producto, nombre, precio_venta, precio_efectivo, imagen").in("id_producto", idsProducto)
    : { data: [] };
  const prod = new Map(
    (productos ?? []).map((p) => [
      p.id_producto as string,
      { idProducto: p.id_producto as string, nombre: p.nombre as string, precio: n(p.precio_venta), precioEfectivo: n(p.precio_efectivo) || n(p.precio_venta), imagen: (p.imagen as string | null) ?? null },
    ])
  );

  // Vendidos del mes: unidades de renglones con ese combo ÷ unidades que lleva el combo.
  const inicioMes = new Date();
  inicioMes.setUTCDate(1);
  inicioMes.setUTCHours(3, 0, 0, 0);
  const unidades = new Map<string, number>();
  try {
    const { data: renglones } = await supabase
      .from("detalle_ventas")
      .select("id_combo, cantidad, ventas!inner(fecha, estado)")
      .in("id_combo", combos.map((c) => c.id_combo as string))
      .eq("ventas.estado", "PAGADA")
      .gte("ventas.fecha", inicioMes.toISOString());
    for (const r of renglones ?? []) unidades.set(r.id_combo as string, (unidades.get(r.id_combo as string) ?? 0) + n(r.cantidad));
  } catch {
    /* sin el conteo */
  }

  // Cambios de precio pedidos por la marca y todavía sin resolver.
  const pedidos = new Map<string, { precio: number; precioEfectivo: number | null }>();
  try {
    const { data: sol } = await supabase.from("solicitudes_marca").select("datos").eq("tipo", "COMBO_PRECIO").eq("estado", "PENDIENTE");
    for (const s of sol ?? []) {
      const d = (s.datos as Record<string, unknown>) ?? {};
      if (typeof d.id_combo === "string") pedidos.set(d.id_combo, { precio: n(d.precio), precioEfectivo: d.precio_efectivo == null ? null : n(d.precio_efectivo) });
    }
  } catch {
    /* sin pedidos */
  }

  return combos.map((c) => {
    const grupos = ((c.grupos as GrupoEntrada[]) ?? []).map((g) => ({
      cantidad: Math.max(1, Math.floor(n(g.cantidad)) || 1),
      productos: (g.productos ?? []).map((id) => prod.get(id)).filter((p): p is ProductoCombo => Boolean(p)),
    }));
    const minimo = (g: (typeof grupos)[number], campo: "precio" | "precioEfectivo") =>
      g.productos.length ? Math.min(...g.productos.map((p) => p[campo])) * g.cantidad : 0;
    const porCombo = grupos.reduce((t, g) => t + g.cantidad, 0) || 1;
    return {
      id: c.id_combo as string,
      nombre: c.nombre as string,
      marca: (c.marca as string | null) ?? null,
      idMarca: (c.id_marca as string | null) ?? null,
      precio: n(c.precio),
      precioEfectivo: c.precio_efectivo == null ? null : n(c.precio_efectivo),
      imagen: (c.imagen as string | null) ?? null,
      estado: ((c.estado as string) ?? "ACTIVO") as EstadoCombo,
      orden: n(c.orden),
      grupos,
      suelto: grupos.reduce((t, g) => t + minimo(g, "precio"), 0),
      sueltoEfectivo: grupos.reduce((t, g) => t + minimo(g, "precioEfectivo"), 0),
      vendidosMes: Math.floor((unidades.get(c.id_combo as string) ?? 0) / porCombo),
      pedido: pedidos.get(c.id_combo as string) ?? null,
    };
  });
}

/** Cuánto salen sueltos los productos de unos grupos (el más barato de cada uno). */
export async function precioSuelto(supabase: SupabaseClient, grupos: GrupoEntrada[]): Promise<{ lista: number; efectivo: number; faltan: boolean }> {
  const ids = [...new Set(grupos.flatMap((g) => g.productos))];
  const { data } = ids.length ? await supabase.from("productos").select("id_producto, precio_venta, precio_efectivo, estado").in("id_producto", ids) : { data: [] };
  const p = new Map((data ?? []).map((x) => [x.id_producto as string, x]));
  let lista = 0, efectivo = 0, faltan = false;
  for (const g of grupos) {
    const suyos = g.productos.map((id) => p.get(id)).filter((x) => x && x.estado === "ACTIVO" && n(x.precio_venta) > 0);
    if (suyos.length === 0) { faltan = true; continue; }
    lista += Math.min(...suyos.map((x) => n(x!.precio_venta))) * g.cantidad;
    efectivo += Math.min(...suyos.map((x) => n(x!.precio_efectivo) || n(x!.precio_venta))) * g.cantidad;
  }
  return { lista, efectivo, faltan };
}

/** Que el precio sea de combo de verdad: mayor a cero y menor que los sueltos. Devuelve el error o null. */
export function validarPrecioCombo(precio: number, precioEfectivo: number | null, suelto: { lista: number; efectivo: number }): string | null {
  if (!Number.isFinite(precio) || precio <= 0) return "Poné el precio del combo con tarjeta o QR.";
  if (precioEfectivo != null && (!Number.isFinite(precioEfectivo) || precioEfectivo <= 0)) return "El precio en efectivo tiene que ser mayor a cero.";
  if (precioEfectivo != null && precioEfectivo > precio) return "El precio en efectivo no puede ser más caro que con tarjeta.";
  if (suelto.lista > 0 && precio >= suelto.lista) return `Así el combo sale igual o más caro que los productos sueltos ($${Math.round(suelto.lista).toLocaleString("es-AR")}). Bajale el precio.`;
  if (precioEfectivo != null && suelto.efectivo > 0 && precioEfectivo >= suelto.efectivo)
    return `En efectivo sale igual o más caro que los sueltos en efectivo ($${Math.round(suelto.efectivo).toLocaleString("es-AR")}).`;
  return null;
}

/** Que los grupos estén bien armados: al menos 2 unidades en total y productos de esa marca. */
export async function validarGrupos(supabase: SupabaseClient, grupos: GrupoEntrada[], idMarca: string | null): Promise<string | null> {
  const limpios = grupos.filter((g) => g.productos.length > 0 && g.cantidad >= 1);
  if (limpios.length === 0) return "Elegí los productos del combo.";
  if (limpios.reduce((t, g) => t + g.cantidad, 0) < 2) return "Un combo lleva al menos 2 unidades.";
  if (idMarca) {
    const ids = [...new Set(limpios.flatMap((g) => g.productos))];
    const { data } = await supabase.from("productos").select("id_producto").in("id_producto", ids).eq("id_marca", idMarca);
    if ((data ?? []).length !== ids.length) return "Algún producto no es de esa marca.";
  }
  return null;
}

/** Limpia lo que llega del navegador: cantidades enteras de 1 a 20, ids sin repetir. */
export function limpiarGrupos(entrada: unknown): GrupoEntrada[] {
  if (!Array.isArray(entrada)) return [];
  return entrada
    .map((g) => ({
      cantidad: Math.min(20, Math.max(1, Math.floor(Number((g as GrupoEntrada)?.cantidad)) || 1)),
      productos: [...new Set(((g as GrupoEntrada)?.productos ?? []).filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))],
    }))
    .filter((g) => g.productos.length > 0)
    .slice(0, 6);
}

/**
 * Aplica una solicitud de combo ya aprobada (COMBO_PRECIO o COMBO_NUEVO).
 * La llama Aprobaciones al aprobar; los combos no tienen cartel de góndola,
 * así que entra en el momento.
 */
export async function aplicarSolicitudCombo(
  supabase: SupabaseClient,
  s: { tipo: string; id_marca: string; datos: Record<string, unknown> }
): Promise<void> {
  const d = s.datos ?? {};
  if (s.tipo === "COMBO_PRECIO") {
    const precio = n(d.precio);
    if (!(precio > 0) || typeof d.id_combo !== "string") throw new Error("precio de combo inválido");
    const { error } = await supabase
      .from("combos")
      .update({ precio, precio_efectivo: d.precio_efectivo == null ? null : n(d.precio_efectivo) })
      .eq("id_combo", d.id_combo)
      .eq("id_marca", s.id_marca);
    if (error) throw new Error(error.message);
    return;
  }
  if (s.tipo === "COMBO_NUEVO") {
    const grupos = limpiarGrupos(d.grupos);
    const precio = n(d.precio);
    const nombre = String(d.nombre ?? "").trim();
    if (!nombre || !(precio > 0) || grupos.length === 0) throw new Error("combo nuevo incompleto");
    const { data: ultimo } = await supabase.from("combos").select("orden").order("orden", { ascending: false }).limit(1);
    const { data: marca } = await supabase.from("marcas").select("nombre").eq("id_marca", s.id_marca).maybeSingle();
    const { error } = await supabase.from("combos").insert({
      nombre,
      marca: String(d.marca ?? "").trim() || (marca?.nombre as string) || null,
      id_marca: s.id_marca,
      precio,
      precio_efectivo: d.precio_efectivo == null ? null : n(d.precio_efectivo),
      imagen: typeof d.imagen === "string" && d.imagen ? d.imagen : null,
      grupos,
      orden: n(ultimo?.[0]?.orden) + 1,
      estado: "ACTIVO",
    });
    if (error) throw new Error(error.message);
  }
}
