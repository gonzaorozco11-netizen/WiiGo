"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";

// Comentarios de los clientes sobre los productos (Gonzalo, 18/11): los
// operativos los publican u ocultan; borrar, solo el dueño.

export async function revisarComentario(idOpinion: string, publicar: boolean): Promise<{ error?: string }> {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "comentarios")) return { error: "No tenés habilitado Comentarios." };
  const { error } = await getSupabaseServerClient()
    .from("opiniones_producto")
    .update({ comentario_estado: publicar ? "PUBLICADO" : "OCULTO", revisado_por: sesion.nombre ?? null, revisado_el: new Date().toISOString() })
    .eq("id_opinion", idOpinion);
  if (error) return { error: "No se pudo guardar. Probá de nuevo." };
  revalidatePath("/comentarios");
  return {};
}

/** Borrar la opinión entera (estrellas incluidas). Solo el dueño. */
export async function borrarOpinion(idOpinion: string): Promise<{ error?: string }> {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || sesion.rol !== "admin") return { error: "Solo Gonzalo puede borrar una opinión." };
  const { error } = await getSupabaseServerClient().from("opiniones_producto").delete().eq("id_opinion", idOpinion);
  if (error) return { error: "No se pudo borrar. Probá de nuevo." };
  revalidatePath("/comentarios");
  return {};
}
