import type { SupabaseClient } from "@supabase/supabase-js";

// Qué productos ya tienen su sticker de código impreso (id_variante → fecha).
// Antes se guardaba solo en la tablet que imprimía, y en cualquier otro aparato
// «Todo lo que falta» mostraba también lo ya etiquetado (Gonzalo, 2026-11-11).
// Vive en una fila de configuracion, como MARCAS_SIN_CODIGO_FABRICA.
export const PARAMETRO_CODIGOS_IMPRESOS = "CODIGOS_IMPRESOS";

/** Lo mismo para los carteles de góndola (id_producto → fecha de la última impresión). */
export const PARAMETRO_CARTELES_IMPRESOS = "CARTELES_IMPRESOS";

export async function cargarCodigosImpresos(supabase: SupabaseClient): Promise<Record<string, string>> {
  return cargarImpresos(supabase, PARAMETRO_CODIGOS_IMPRESOS);
}

export async function cargarImpresos(supabase: SupabaseClient, parametro: string): Promise<Record<string, string>> {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", parametro).maybeSingle();
  try {
    const v = data?.valor ? JSON.parse(data.valor as string) : {};
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}
