// El papel que llega con la mercadería: remito, factura o lo que traiga el
// camión, sacado con la tablet por quien recibe.
//
// Vive acá y no adentro de cada recepción porque son dos caminos (proveedores
// y marcas) que tienen que guardar igual: mismo bucket, mismo nombre de
// archivo, mismo criterio de qué pasa si falla.
import type { SupabaseClient } from "@supabase/supabase-js";

/** Privado. El mismo que usan los pagos y los costeos — un solo lugar que asegurar. */
export const BUCKET_COMPROBANTES = "comprobantes-proveedor";

/** Tabla donde vive la recepción: las de proveedor y las de marca son distintas. */
export type TablaRecepcion = "recepciones_proveedor" | "recepciones";

/**
 * Sube el remito y lo engancha a la recepción.
 *
 * Nunca tira: devuelve un aviso si no pudo. Es a propósito — del otro lado hay
 * alguien con un camión esperando, y perder el conteo de la mercadería porque
 * una foto no subió sería mucho peor que quedarse sin la foto. El archivo se
 * puede volver a adjuntar después desde la misma pantalla.
 *
 * El nombre lleva el id de la recepción y no el del pedido: un pedido que llega
 * en dos veces trae dos remitos distintos, y con el id del pedido el segundo
 * pisaba al primero.
 */
export async function guardarRemito(
  supabase: SupabaseClient,
  tabla: TablaRecepcion,
  idRecepcion: string,
  archivo: File | null | undefined
): Promise<string | undefined> {
  if (!archivo || archivo.size === 0) return undefined;

  const extension = archivo.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `remito-${idRecepcion}.${extension}`;

  const { error: errorUpload } = await supabase.storage
    .from(BUCKET_COMPROBANTES)
    .upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
  if (errorUpload) {
    return `La mercadería quedó cargada, pero el comprobante no se pudo subir (${errorUpload.message}). Adjuntalo de nuevo desde el historial de entregas.`;
  }

  const { error } = await supabase
    .from(tabla)
    .update({ comprobante_recepcion_path: path })
    .eq("id_recepcion", idRecepcion);
  if (error) {
    // Columna sin crear (sql/remito-recepcion.sql): el archivo quedó subido,
    // solo falta la columna donde anotarlo.
    return `La mercadería quedó cargada, pero el comprobante no se pudo enganchar: falta correr sql/remito-recepcion.sql en Supabase.`;
  }
  return undefined;
}
