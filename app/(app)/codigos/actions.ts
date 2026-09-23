"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { limpiarCodigoBarras, esCodigoInterno } from "@/lib/codigos";

/**
 * Guarda el código que trae el envase de un producto.
 *
 * Se usa desde la pantalla de Códigos de barras, escaneando de a uno. Lo único
 * delicado es que dos productos no terminen con el mismo código: si pasa, el
 * cliente escanea uno en el tótem y se le carga el otro.
 */
export async function guardarCodigoBarras(idVariante: string, codigo: string) {
  const supabase = getSupabaseServerClient();
  const limpio = limpiarCodigoBarras(codigo);

  if (!limpio) return { error: "El código vino vacío." };
  if (limpio.length < 6) return { error: "Ese código es muy corto para ser el de un envase." };
  if (esCodigoInterno(limpio)) {
    return {
      error:
        "Ese es un código de los que genera WiiGo, no uno de fábrica. Si el envase no trae el suyo, dejálo como está y se le imprime etiqueta.",
    };
  }

  const { data: choques } = await supabase
    .from("variantes_producto")
    .select("id_variante, nombre, productos(nombre)")
    .eq("codigo_barras", limpio)
    .limit(2);

  const otro = (choques ?? []).find(
    (v: { id_variante: string }) => v.id_variante !== idVariante
  ) as { nombre: string; productos?: { nombre?: string } | { nombre?: string }[] } | undefined;

  if (otro) {
    const prod = Array.isArray(otro.productos) ? otro.productos[0] : otro.productos;
    const quien = [prod?.nombre, otro.nombre !== "Único" ? otro.nombre : null].filter(Boolean).join(" — ");
    return { error: `Ese código ya lo tiene ${quien || "otro producto"}. Fijate si no escaneaste el envase equivocado.` };
  }

  const { error } = await supabase
    .from("variantes_producto")
    .update({ codigo_barras: limpio })
    .eq("id_variante", idVariante);
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/codigos");
  revalidatePath("/productos");
  return { ok: true as const };
}

/**
 * Vuelve a poner el código interno de WiiGo.
 *
 * Para cuando alguien escaneó el envase equivocado, o cuando se decide
 * etiquetar igual un producto que traía código propio (envases importados con
 * códigos que el lector de la tienda no toma, por ejemplo).
 */
export async function volverAEtiquetaWiigo(idVariante: string) {
  const supabase = getSupabaseServerClient();

  // El número sigue al mayor que haya, como en productos/actions.ts: así dos
  // productos nunca comparten etiqueta aunque se borren variantes en el medio.
  const { data: existentes } = await supabase.from("variantes_producto").select("codigo_barras");
  let mayor = 20000000000;
  (existentes ?? []).forEach((row: { codigo_barras: string | null }) => {
    const n = Number(row.codigo_barras);
    if (Number.isFinite(n) && n > mayor) mayor = n;
  });

  const { error } = await supabase
    .from("variantes_producto")
    .update({ codigo_barras: String(mayor + 1) })
    .eq("id_variante", idVariante);
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/codigos");
  revalidatePath("/productos");
  return { ok: true as const, codigo: String(mayor + 1) };
}
