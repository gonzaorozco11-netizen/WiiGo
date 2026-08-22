// Sistema de permisos granular: un admin puede todo, siempre. Un operativo
// hace lo básico del día a día por defecto, y solo puede además hacer lo que
// un admin le haya tildado explícitamente acá. Se chequea SIEMPRE contra la
// base de datos en el momento (nunca contra la cookie de sesión, que puede
// tener hasta 30 días) — así si un admin le saca un permiso a alguien, o lo
// desactiva, el cambio pega al toque, no espera a que esa persona reloguee.
//
// Este archivo usa next/headers y el service role de Supabase — es
// server-only. Los componentes de cliente que solo necesitan la lista de
// permisos y sus etiquetas deben importar de "./permisos-constantes".

import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

export { PERMISOS, PERMISOS_DISPONIBLES } from "./permisos-constantes";
export type { Permiso } from "./permisos-constantes";
import { PERMISOS, type Permiso } from "./permisos-constantes";

export type SesionConPermisos = {
  idUsuario: string;
  nombre: string;
  rol: string;
  permisos: string[];
};

// Lectura fresca desde la base — no confiar en lo que diga la cookie para
// nada que dé acceso a algo sensible.
export async function obtenerSesionConPermisos(): Promise<SesionConPermisos | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("usuarios")
    .select("nombre, rol, estado, permisos")
    .eq("id_usuario", sesion.sub)
    .maybeSingle();
  if (!data || data.estado !== "ACTIVO") return null;

  return {
    idUsuario: sesion.sub,
    nombre: data.nombre,
    rol: data.rol ?? "operativo",
    permisos: data.permisos ?? [],
  };
}

export function tienePermiso(sesion: SesionConPermisos | null, permiso: Permiso) {
  if (!sesion) return false;
  return sesion.rol === "admin" || sesion.permisos.includes(permiso);
}
