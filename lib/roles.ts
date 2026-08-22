// Roles configurables (Dueño/admin siempre puede todo; por debajo, cada
// rol define qué pantallas puede ver un usuario "operativo"). Se agrega
// SIN tocar el esquema admin/operativo existente — un usuario sin rol
// asignado (id_rol null) sigue viendo todo, exactamente como hoy, para no
// romper a nadie que ya estaba cargado antes de esto.
//
// Se chequea siempre fresco contra la base (mismo criterio que
// lib/permisos.ts) — nunca contra la cookie, que puede tener hasta 30 días.
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

export type SesionConPantallas = {
  idUsuario: string;
  nombre: string;
  rol: string;
  // null = sin restricción (admin, o usuario operativo sin rol asignado
  // todavía). Array = solo puede ver esas pantallas.
  pantallas: string[] | null;
};

export async function obtenerSesionConPantallas(): Promise<SesionConPantallas | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("usuarios")
    .select("nombre, rol, estado, id_rol, roles(pantallas)")
    .eq("id_usuario", sesion.sub)
    .maybeSingle();
  if (!data || data.estado !== "ACTIVO") return null;

  const rol = data.rol ?? "operativo";
  if (rol === "admin" || !data.id_rol) {
    return { idUsuario: sesion.sub, nombre: data.nombre, rol, pantallas: null };
  }

  const rolAsignado = data.roles as unknown as { pantallas: string[] } | null;
  return { idUsuario: sesion.sub, nombre: data.nombre, rol, pantallas: rolAsignado?.pantallas ?? [] };
}

export function puedeVerPantalla(sesion: SesionConPantallas | null, clave: string) {
  if (!sesion) return false;
  if (sesion.pantallas === null) return true;
  return sesion.pantallas.includes(clave);
}
