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
  return leerLista(supabase, CLAVE_SIN_CODIGO);
}

/** configuracion → productos sueltos que vienen cerrados pero sin código (las granolas de 1 kg). */
export const CLAVE_PRODUCTOS_SIN_CODIGO = "PRODUCTOS_SIN_CODIGO_FABRICA";

/**
 * Productos que vienen cerrados (no los embolsamos) pero el envase no trae
 * código: se les imprime el de WiiGo como a lo fraccionado. Lo mismo que la
 * marca entera de arriba, pero de a uno: en WiiGo Dietética conviven aceites
 * con su código y granolas sin (Gonzalo, 2026-11-11).
 */
export async function cargarProductosSinCodigo(supabase: SupabaseClient): Promise<Set<string>> {
  return leerLista(supabase, CLAVE_PRODUCTOS_SIN_CODIGO);
}

async function leerLista(supabase: SupabaseClient, parametro: string): Promise<Set<string>> {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", parametro).maybeSingle();
  try {
    return new Set((JSON.parse((data?.valor as string | undefined) ?? "[]") as string[]).map(String));
  } catch {
    return new Set();
  }
}
