import type { SupabaseClient } from "@supabase/supabase-js";

// El costo de cada renglón vendido queda guardado en la venta
// (detalle_ventas.costo_unitario, sql/ventas-costo-al-vender.sql): si después
// el costo sube o baja, las ventas ya hechas no cambian (Gonzalo, 2026-11-06).
// Lo leen Rentabilidad, el Resumen de ventas y la liquidación del proveedor;
// lo vendido antes de esto, sin costo guardado, usa el costo de hoy.

/** El costo de hoy de cada variante (el costo_informado de su producto). */
export async function costosAlVender(supabase: SupabaseClient, idsVariante: string[]): Promise<Map<string, number | null>> {
  const mapa = new Map<string, number | null>();
  const ids = [...new Set(idsVariante.filter(Boolean))];
  if (ids.length === 0) return mapa;
  const { data } = await supabase.from("variantes_producto").select("id_variante, productos(costo_informado)").in("id_variante", ids);
  for (const v of data ?? []) {
    const p = v.productos as unknown as { costo_informado: number | null } | null;
    const costo = p?.costo_informado;
    mapa.set(v.id_variante as string, costo == null ? null : Number(costo));
  }
  return mapa;
}

/** Les pone el costo del momento a los renglones de una venta antes de guardarlos. */
export async function conCostoAlVender<T extends { id_variante: string }>(supabase: SupabaseClient, filas: T[]): Promise<(T & { costo_unitario: number | null })[]> {
  const costos = await costosAlVender(supabase, filas.map((f) => f.id_variante));
  return filas.map((f) => ({ ...f, costo_unitario: costos.get(f.id_variante) ?? null }));
}

/**
 * Si la base todavía no tiene la columna (falta correr el SQL), el renglón se
 * guarda sin el costo: una venta nunca se puede trabar por esto.
 */
export function sinColumnaCosto(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42703" || error.code === "PGRST204") && (error.message ?? "").includes("costo_unitario"));
}

type Renglon = { id_venta: string; id_variante: string; id_marca: string | null; cantidad: number; precio_unitario: number; subtotal: number };

/**
 * Guarda los renglones de una venta con el costo del momento. Lo usan la caja
 * (dos caminos) y el tótem. Devuelve el id de cada renglón con su variante.
 */
export async function insertarRenglonesVenta(supabase: SupabaseClient, filas: Renglon[]) {
  const conCosto = await conCostoAlVender(supabase, filas);
  const r = await supabase.from("detalle_ventas").insert(conCosto).select("id_detalle, id_variante");
  if (!sinColumnaCosto(r.error)) return r;
  return supabase.from("detalle_ventas").insert(filas).select("id_detalle, id_variante");
}

/** El costo de un renglón ya vendido: el guardado en la venta o, si es viejo, el de hoy. */
export function costoDelRenglon(guardado: unknown, deHoy: unknown): number {
  const g = guardado == null ? null : Number(guardado);
  if (g != null && Number.isFinite(g)) return g;
  const h = deHoy == null ? 0 : Number(deHoy);
  return Number.isFinite(h) ? h : 0;
}
