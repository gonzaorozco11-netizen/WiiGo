"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";

async function permiso() {
  const sesion = await obtenerSesionConPantallas();
  return puedeVerPantalla(sesion, "objetivos");
}

/**
 * Deja un objetivo con exactamente estos productos.
 *
 * Se manda la lista entera y no los cambios uno por uno: si se mandaran los
 * cambios, dos personas trabajando a la vez terminarían pisándose y nadie
 * sabría cuál quedó. Con la lista completa gana la última que guardó, que es
 * lo que espera quien está mirando la pantalla.
 *
 * Solo toca las filas de ESTE objetivo. Los demás objetivos de cada producto
 * quedan como estaban — un producto puede estar en varios y eso está bien.
 */
export async function guardarProductosDeObjetivo(idObjetivo: string, idsProducto: string[]) {
  if (!(await permiso())) return { error: "No tenés permiso para esta pantalla." };
  const supabase = getSupabaseServerClient();

  const { error: errorBorrado } = await supabase
    .from("producto_objetivos")
    .delete()
    .eq("id_objetivo", idObjetivo);
  if (errorBorrado) return { error: friendlyDbError(errorBorrado) };

  if (idsProducto.length > 0) {
    const filas = idsProducto.map((id) => ({ id_producto: id, id_objetivo: idObjetivo }));
    const { error } = await supabase.from("producto_objetivos").insert(filas);
    if (error) return { error: friendlyDbError(error) };
  }

  revalidatePath("/objetivos");
  revalidatePath("/catalogo-asesor");
  return { ok: true as const, cuantos: idsProducto.length };
}

/**
 * Pasa los productos de un objetivo a otro y da de baja el que sobraba.
 *
 * Para los duplicados de verdad —"Energía" y "Mas energía"—, que en el asesor
 * le muestran al cliente dos caminos que llevan al mismo lado.
 *
 * El que sobra se deja INACTIVO en vez de borrarlo: si alguien fusionó mal,
 * volver atrás es cambiarle el estado, no rehacer las asignaciones a mano.
 */
export async function fusionarObjetivos(idQueSobra: string, idQueQueda: string) {
  if (!(await permiso())) return { error: "No tenés permiso para esta pantalla." };
  if (idQueSobra === idQueQueda) return { error: "Elegí dos objetivos distintos." };
  const supabase = getSupabaseServerClient();

  const [{ data: delQueSobra }, { data: delQueQueda }] = await Promise.all([
    supabase.from("producto_objetivos").select("id_producto").eq("id_objetivo", idQueSobra),
    supabase.from("producto_objetivos").select("id_producto").eq("id_objetivo", idQueQueda),
  ]);

  // Los que ya estaban en los dos no se duplican.
  const yaEstan = new Set((delQueQueda ?? []).map((r: { id_producto: string }) => r.id_producto));
  const aMover = (delQueSobra ?? [])
    .map((r: { id_producto: string }) => r.id_producto)
    .filter((id) => !yaEstan.has(id));

  if (aMover.length > 0) {
    const { error } = await supabase
      .from("producto_objetivos")
      .insert(aMover.map((id) => ({ id_producto: id, id_objetivo: idQueQueda })));
    if (error) return { error: friendlyDbError(error) };
  }

  const { error: errorBorrado } = await supabase
    .from("producto_objetivos")
    .delete()
    .eq("id_objetivo", idQueSobra);
  if (errorBorrado) return { error: friendlyDbError(errorBorrado) };

  const { error: errorEstado } = await supabase
    .from("objetivos")
    .update({ estado: "INACTIVO" })
    .eq("id_objetivo", idQueSobra);
  if (errorEstado) return { error: friendlyDbError(errorEstado) };

  revalidatePath("/objetivos");
  revalidatePath("/catalogo-asesor");
  return { ok: true as const, movidos: aMover.length };
}

/** Saca un objetivo del asesor sin borrarlo, por si hay que volver atrás. */
export async function cambiarEstadoObjetivo(idObjetivo: string, activo: boolean) {
  if (!(await permiso())) return { error: "No tenés permiso para esta pantalla." };
  const supabase = getSupabaseServerClient();

  const { error } = await supabase
    .from("objetivos")
    .update({ estado: activo ? "ACTIVO" : "INACTIVO" })
    .eq("id_objetivo", idObjetivo);
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/objetivos");
  revalidatePath("/catalogo-asesor");
  return { ok: true as const };
}

/** El orden en que el cliente los ve en la puerta 1 del asesor. */
export async function reordenarObjetivos(ids: string[]) {
  if (!(await permiso())) return { error: "No tenés permiso para esta pantalla." };
  const supabase = getSupabaseServerClient();

  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from("objetivos")
      .update({ orden: i + 1 })
      .eq("id_objetivo", ids[i]);
    if (error) return { error: friendlyDbError(error) };
  }

  revalidatePath("/objetivos");
  revalidatePath("/catalogo-asesor");
  return { ok: true as const };
}
