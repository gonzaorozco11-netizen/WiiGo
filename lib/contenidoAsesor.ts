import type { SupabaseClient } from "@supabase/supabase-js";
import type { FichaProducto, Objetivo, FiltroProducto } from "@/lib/supabase";

// Trae los objetivos/filtros activos (listas globales) y arma un mapa de
// ficha/objetivos/filtros ya asignados por producto, para pasarle todo
// junto al modal de producto sin que tenga que pedir nada por su cuenta.
export async function fetchContenidoAsesor(supabase: SupabaseClient) {
  const [objetivosRes, filtrosRes, fichasRes, prodObjRes, prodFiltRes] = await Promise.all([
    supabase.from("objetivos").select("*").eq("estado", "ACTIVO").order("orden", { ascending: true }),
    supabase
      .from("filtros_producto")
      .select("*")
      .eq("estado", "ACTIVO")
      .order("orden", { ascending: true }),
    supabase.from("ficha_producto").select("*"),
    supabase.from("producto_objetivos").select("id_producto, id_objetivo"),
    supabase.from("producto_filtros").select("id_producto, id_filtro"),
  ]);

  const fichaPorProducto: Record<string, FichaProducto> = {};
  (fichasRes.data ?? []).forEach((f: FichaProducto) => {
    fichaPorProducto[f.id_producto] = f;
  });

  const objetivosPorProducto: Record<string, string[]> = {};
  (prodObjRes.data ?? []).forEach((row: { id_producto: string; id_objetivo: string }) => {
    (objetivosPorProducto[row.id_producto] ??= []).push(row.id_objetivo);
  });

  const filtrosPorProducto: Record<string, string[]> = {};
  (prodFiltRes.data ?? []).forEach((row: { id_producto: string; id_filtro: string }) => {
    (filtrosPorProducto[row.id_producto] ??= []).push(row.id_filtro);
  });

  return {
    objetivosGlobales: (objetivosRes.data ?? []) as Objetivo[],
    filtrosGlobales: (filtrosRes.data ?? []) as FiltroProducto[],
    fichaPorProducto,
    objetivosPorProducto,
    filtrosPorProducto,
  };
}
