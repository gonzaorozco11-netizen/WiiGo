"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { limpiarCodigoBarras, esCodigoInterno } from "@/lib/codigos";
import { mayorCodigoInterno } from "@/lib/codigosVariante";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { CLAVE_SIN_CODIGO, cargarMarcasSinCodigo } from "@/lib/marcasSinCodigo";

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

/** Una marca pasa a imprimir el código WiiGo (sus envases no traen) o vuelve a escanearse. */
export async function marcarMarcaSinCodigo(idMarca: string, sinCodigo: boolean) {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "codigos")) return { error: "No tenés permiso para cambiar esto." };

  const supabase = getSupabaseServerClient();
  const marcas = await cargarMarcasSinCodigo(supabase);
  if (sinCodigo) marcas.add(idMarca);
  else marcas.delete(idMarca);

  const { error } = await supabase.from("configuracion").upsert(
    {
      parametro: CLAVE_SIN_CODIGO,
      valor: JSON.stringify([...marcas]),
      descripcion: "Marcas cuyos envases no traen código de barras: se les imprime el de WiiGo (pantalla Códigos de barras).",
      fecha_actualizacion: new Date().toISOString(),
    },
    { onConflict: "parametro" }
  );
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/codigos");
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
  // Solo el rango interno: los códigos de fábrica no cuentan (ver mayorCodigoInterno).
  const { data: existentes } = await supabase.from("variantes_producto").select("codigo_barras");
  const mayor = mayorCodigoInterno(existentes ?? []);

  const { error } = await supabase
    .from("variantes_producto")
    .update({ codigo_barras: String(mayor + 1) })
    .eq("id_variante", idVariante);
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/codigos");
  revalidatePath("/productos");
  return { ok: true as const, codigo: String(mayor + 1) };
}
