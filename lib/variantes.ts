import type { SupabaseClient } from "@supabase/supabase-js";
import type { VarianteProducto } from "@/lib/supabase";

export async function fetchVariantesPorProducto(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("variantes_producto")
    .select("*")
    .order("orden", { ascending: true });

  const porProducto: Record<string, VarianteProducto[]> = {};
  (data ?? []).forEach((v: VarianteProducto) => {
    (porProducto[v.id_producto] ??= []).push(v);
  });
  return porProducto;
}
