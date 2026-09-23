"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";

/**
 * Da por cambiados los carteles que se acaban de imprimir.
 *
 * Imprimir no es cambiar: entre que sale la hoja y alguien recorta y mete cada
 * cartel en su porta precios pasa un rato, y en el medio el precio de la caja
 * ya es el nuevo. Por eso se marca después, cuando la operativa confirma que
 * los puso — y no solo, al apretar Imprimir.
 */
export async function marcarCartelesPuestos(idsTarea: string[]) {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "carteles")) return { error: "No tenés permiso para esta pantalla." };
  if (idsTarea.length === 0) return { ok: true as const, cuantas: 0 };

  const supabase = getSupabaseServerClient();
  const { error, count } = await supabase
    .from("tareas_etiqueta")
    .update(
      { estado: "HECHA", hecha_el: new Date().toISOString() },
      { count: "exact" }
    )
    .in("id_tarea", idsTarea)
    .in("estado", ["PENDIENTE", "VENCIDA"]);

  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/carteles");
  revalidatePath("/aprobaciones");
  return { ok: true as const, cuantas: count ?? idsTarea.length };
}
