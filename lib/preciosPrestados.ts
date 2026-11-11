import type { SupabaseClient } from "@supabase/supabase-js";

// Productos que Alifrut trajo pero no tiene en su lista: toman el costo de
// otro producto parecido de esa lista (Gonzalo, 2026-11-11: la Pasta de Maní
// Sal Marina usa el de la Natural). Es un arreglo provisorio, así que queda a
// la vista —en Mis Tareas y en Precios— hasta que Alifrut lo sume y se vincule
// a su propio renglón. configuracion.PRECIOS_PRESTADOS = { id_producto: { producto, de, desde } }.
export const CLAVE_PRECIOS_PRESTADOS = "PRECIOS_PRESTADOS";

export type PrecioPrestado = { producto: string; de: string; desde?: string };

export async function cargarPreciosPrestados(supabase: SupabaseClient): Promise<Record<string, PrecioPrestado>> {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", CLAVE_PRECIOS_PRESTADOS).maybeSingle();
  try {
    const v = data?.valor ? JSON.parse(data.valor as string) : {};
    return v && typeof v === "object" ? (v as Record<string, PrecioPrestado>) : {};
  } catch {
    return {};
  }
}
