import type { SupabaseClient } from "@supabase/supabase-js";
import { costoPorKg, type Granel } from "@/lib/calculoPrecio";
import { generarCodigoBarrasVariante, generarSkuVariante } from "@/lib/codigosVariante";

// Granel y fraccionado (sql/granel-fraccionado.sql).
//
// Cada costo de compra de Alifrut que se embolsa en el local (tiene al menos
// una bolsita: producto con envase WiiGo y peso) tiene su granel: un producto
// interno con estado 'GRANEL' y stock en GRAMOS. Se pide y se recibe en kilos
// con la orden de compra de siempre; la recepción le pone a cada lote el costo
// del día (lo que cobra Alifrut, Gonzalo 2026-11-10), y al fraccionar los
// gramos pasan a bolsitas con ese costo.

export const ESTADO_GRANEL = "GRANEL";
export const SUFIJO_GRANEL = " · a granel";
export { textoGramos } from "@/lib/gramos";

type FilaCosto = { id_granel: string; nombre: string; costo_neto: number | null; unidad: string | null; kg_bulto: number | null; id_proveedor: string | null };

/** El costo de Alifrut de hoy, por gramo. null si no se puede saber (una caja, sin kg por bulto). */
export function costoPorGramo(c: FilaCosto): number | null {
  const unidad = c.unidad === "BULTO" || c.unidad === "CAJA" ? c.unidad : "KG";
  if (unidad === "CAJA") return null;
  const g: Granel = { id: c.id_granel, nombre: c.nombre, costo: Number(c.costo_neto ?? 0), unidad, kgBulto: c.kg_bulto == null ? null : Number(c.kg_bulto) };
  const porKg = costoPorKg(g);
  return porKg != null && porKg > 0 ? porKg / 1000 : null;
}

/**
 * Crea el granel de cada costo que ya tiene bolsitas y todavía no lo tiene.
 * Se llama al abrir Compras y Fraccionar: así cualquier producto que se
 * empiece a embolsar tiene su granel sin que nadie tenga que acordarse.
 * Devuelve cuántos creó. Sin el SQL corrido no hace nada.
 */
export async function asegurarGraneles(supabase: SupabaseClient): Promise<number> {
  const [{ data: bolsitas }, { data: existentes, error }] = await Promise.all([
    supabase
      .from("productos")
      .select("id_granel, id_marca, iva_porcentaje")
      .eq("estado", "ACTIVO")
      .not("id_granel", "is", null)
      .not("id_envase", "is", null)
      .gt("peso_neto_g", 0)
      .range(0, 4999),
    supabase.from("productos").select("id_granel").eq("estado", ESTADO_GRANEL).range(0, 4999),
  ]);
  if (error) return 0;
  const yaEstan = new Set((existentes ?? []).map((p) => p.id_granel as string));
  const faltan = new Map<string, { id_marca: string; iva: number | null }>();
  for (const b of bolsitas ?? []) {
    const id = b.id_granel as string;
    if (!yaEstan.has(id) && !faltan.has(id)) faltan.set(id, { id_marca: b.id_marca as string, iva: (b.iva_porcentaje as number | null) ?? null });
  }
  if (faltan.size === 0) return 0;

  const { data: costos } = await supabase
    .from("costos_granel")
    .select("id_granel, nombre, costo_neto, unidad, kg_bulto, id_proveedor")
    .in("id_granel", [...faltan.keys()]);
  let creados = 0;
  for (const c of (costos ?? []) as FilaCosto[]) {
    const datos = faltan.get(c.id_granel);
    if (!datos || c.unidad === "CAJA") continue;
    const { data: prod, error: e } = await supabase
      .from("productos")
      .insert({
        id_marca: datos.id_marca,
        nombre: `${c.nombre}${SUFIJO_GRANEL}`,
        id_granel: c.id_granel,
        id_proveedor_liquidacion: c.id_proveedor,
        estado: ESTADO_GRANEL,
        ...(datos.iva != null ? { iva_porcentaje: datos.iva } : {}),
        // Por gramo: es lo que se paga y lo que se mide.
        costo_informado: costoPorGramo(c),
        costo_actualizado_el: new Date().toISOString(),
      })
      .select("id_producto")
      .single();
    if (e || !prod) continue;
    const sku = await generarSkuVariante(supabase, datos.id_marca);
    const codigo = await generarCodigoBarrasVariante(supabase);
    await supabase.from("variantes_producto").insert({ id_producto: prod.id_producto, nombre: "Único", sku, codigo_barras: codigo, stock_minimo: 0, stock_objetivo: 0 });
    creados++;
  }
  return creados;
}

/** Las variantes de granel (su stock y sus cantidades son gramos). */
export async function variantesDeGranel(supabase: SupabaseClient): Promise<Set<string>> {
  const { data: prods, error } = await supabase.from("productos").select("id_producto").eq("estado", ESTADO_GRANEL).range(0, 4999);
  if (error || !prods?.length) return new Set();
  const { data: vars } = await supabase.from("variantes_producto").select("id_variante").in("id_producto", prods.map((p) => p.id_producto as string));
  return new Set((vars ?? []).map((v) => v.id_variante as string));
}

/** El costo de hoy por gramo del granel de cada variante de granel (para ponérselo al lote al recibir). */
export async function costoDelDiaPorGramo(supabase: SupabaseClient, idsVariante: string[]): Promise<Map<string, number>> {
  const salida = new Map<string, number>();
  if (idsVariante.length === 0) return salida;
  const { data: vars } = await supabase.from("variantes_producto").select("id_variante, productos!inner(id_granel, estado)").in("id_variante", idsVariante);
  const granelDe = new Map<string, string>();
  for (const v of vars ?? []) {
    const p = v.productos as unknown as { id_granel: string | null; estado: string } | null;
    if (p?.estado === ESTADO_GRANEL && p.id_granel) granelDe.set(v.id_variante as string, p.id_granel);
  }
  if (granelDe.size === 0) return salida;
  const { data: costos } = await supabase
    .from("costos_granel")
    .select("id_granel, nombre, costo_neto, unidad, kg_bulto, id_proveedor")
    .in("id_granel", [...new Set(granelDe.values())]);
  const porGranel = new Map(((costos ?? []) as FilaCosto[]).map((c) => [c.id_granel, costoPorGramo(c)]));
  for (const [idVariante, idGranel] of granelDe) {
    const c = porGranel.get(idGranel);
    if (c != null) salida.set(idVariante, c);
  }
  return salida;
}
