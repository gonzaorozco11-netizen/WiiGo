"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas } from "@/lib/roles";
import { tareasDeUsuario } from "@/lib/tareasEquipo";

// Las tareas de Administración WiiGo se marcan como hechas a mano: a
// diferencia de los avisos del sistema, nadie más puede saber si se limpiaron
// los vidrios.

export async function marcarTareaHecha(idTarea: string, hecha: boolean): Promise<{ error: string | null }> {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion) return { error: "Volvé a entrar al sistema." };
  const supabase = getSupabaseServerClient();
  // Solo las que le tocan: la misma lista que ve en Mis Tareas.
  const tarea = (await tareasDeUsuario(supabase, sesion.idUsuario)).find((t) => t.id === idTarea);
  if (!tarea) return { error: "Esa tarea no es para vos o ya no está activa." };

  if (hecha) {
    const { error } = await supabase
      .from("tareas_equipo_hechas")
      .upsert({ id_tarea: idTarea, fecha: tarea.fecha, id_usuario: sesion.idUsuario, nombre: sesion.nombre }, { onConflict: "id_tarea,fecha" });
    if (error) return { error: error.message };
  } else {
    // Deshacer, por si la tocó sin querer. En las de una sola vez se borra
    // cualquier día; en las que se repiten, solo la de esta semana.
    let q = supabase.from("tareas_equipo_hechas").delete().eq("id_tarea", idTarea);
    if (tarea.repiteDia) q = q.eq("fecha", tarea.fecha);
    const { error } = await q;
    if (error) return { error: error.message };
  }
  revalidatePath("/mis-tareas");
  revalidatePath("/junta");
  return { error: null };
}
