"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionProfesional, registrarActividad } from "@/lib/profesionalSesion";

// Acciones del espacio de cada profesional.
//
// Regla de este archivo: ninguna función recibe el id de la profesional. Sale
// siempre de la sesión (obtenerSesionProfesional), así una no puede tocar lo
// de otra aunque conozca su id. Y no se importan acá acciones del sistema
// interno: todo lo que este archivo exporta queda al alcance de su usuario.

/** La primera vez que entra acepta que WiiGo muestre su foto, textos y matrícula. */
export async function aceptarAutorizacion(): Promise<{ error: string | null }> {
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return { error: "Tu sesión se cerró. Volvé a entrar." };
  if (sesion.autorizoImagenAt) return { error: null };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("profesionales")
    .update({ autorizo_imagen_at: new Date().toISOString() })
    .eq("id_profesional", sesion.idProfesional);
  if (error) return { error: "No se pudo guardar. Probá de nuevo en un rato." };

  await registrarActividad(supabase, sesion.idProfesional, "Entró por primera vez y aceptó la autorización de imagen");
  revalidatePath("/mi-espacio", "layout");
  return { error: null };
}
