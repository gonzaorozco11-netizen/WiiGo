import type { SupabaseClient } from "@supabase/supabase-js";

/** configuracion → las marcas cuyos productos llegan sin código de fábrica. */
export const CLAVE_SIN_CODIGO = "MARCAS_SIN_CODIGO_FABRICA";

/**
 * Las marcas en consignación cuyos envases no traen código de barras
 * (Alta y Fruppi, Gonzalo 2026-11-07): a esas sí se les imprime el nuestro.
 * Todas las demás se escanean. Un valor mal escrito no rompe la pantalla:
 * queda como si no hubiera ninguna.
 */
export async function cargarMarcasSinCodigo(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", CLAVE_SIN_CODIGO).maybeSingle();
  try {
    return new Set((JSON.parse((data?.valor as string | undefined) ?? "[]") as string[]).map(String));
  } catch {
    return new Set();
  }
}
