// El papel que llega con la mercadería: remito, factura o lo que traiga el
// camión, sacado con la tablet por quien recibe.
//
// Vive acá y no adentro de cada recepción porque son dos caminos (proveedores
// y marcas) que tienen que guardar igual: mismo bucket, mismo nombre de
// archivo, mismo criterio de qué pasa si falla.
import type { SupabaseClient } from "@supabase/supabase-js";

/** Privado. El mismo que usan los pagos y los costeos — un solo lugar que asegurar. */
export const BUCKET_COMPROBANTES = "comprobantes-proveedor";

/**
 * Dónde se engancha el remito.
 *
 * Las recepciones de proveedor y las de marca son tablas distintas. Y está
 * `ordenes_reposicion`, que es el caso raro: cuando llega un bulto que nadie
 * pidió, todavía NO hay recepción —esa se crea recién cuando administración
 * lo acepta— así que el remito se guarda contra la orden. Si se esperara a la
 * recepción, el único papel del envío se perdería en el medio.
 */
const DESTINOS = {
  recepciones: {
    id: "id_recepcion",
    path: "comprobante_recepcion_path",
    sql: "sql/remito-recepcion.sql",
  },
  recepciones_proveedor: {
    id: "id_recepcion",
    path: "comprobante_recepcion_path",
    sql: "sql/remito-recepcion.sql",
  },
  ordenes_reposicion: {
    id: "id_orden",
    path: "remito_path",
    sql: "sql/reposicion-remito-cobertura.sql",
  },
} as const;

export type TablaRecepcion = keyof typeof DESTINOS;

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

  const destino = DESTINOS[tabla];
  const { error } = await supabase
    .from(tabla)
    .update({ [destino.path]: path })
    .eq(destino.id, idRecepcion);
  if (error) {
    // Columna sin crear: el archivo quedó subido, solo falta dónde anotarlo.
    return `La mercadería quedó cargada, pero el comprobante no se pudo enganchar: falta correr ${destino.sql} en Supabase.`;
  }
  return undefined;
}

/**
 * La foto de lo que no cerró: la caja rota, el vencimiento, el producto que
 * no era.
 *
 * Mismo bucket privado que el remito — un solo lugar que asegurar.
 *
 * Se sube ANTES de recepcionar y devuelve el path, en vez de subirse junto
 * con el conteo. Es la única forma de tener una foto por renglón sin mandar
 * N archivos dentro de la acción que cuenta la mercadería: la pantalla sube
 * cada foto cuando se saca y guarda el path, y la recepción solo anota a qué
 * renglón corresponde.
 *
 * El nombre es al azar y no derivado del renglón porque al sacarla todavía no
 * existe la recepción: la fila de `detalle_recepciones` se crea después.
 */
export async function subirFotoDiferencia(
  supabase: SupabaseClient,
  archivo: File
): Promise<{ path: string | null; error: string | null }> {
  if (!archivo || archivo.size === 0) return { path: null, error: "Elegí una foto primero." };

  const extension = archivo.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `diferencia-${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from(BUCKET_COMPROBANTES)
    .upload(path, archivo, { upsert: false, contentType: archivo.type || undefined });
  if (error) return { path: null, error: error.message };
  return { path, error: null };
}
