// Roles configurables (Dueño/admin siempre puede todo; por debajo, cada
// operativo ve pantallas según su Área en Organización, o un Rol manual
// puesto a mano como excepción). Se agrega SIN tocar el esquema
// admin/operativo existente — un usuario sin nada asignado (ni Rol ni
// Persona) sigue viendo todo, exactamente como hoy, para no romper a nadie
// que ya estaba cargado antes de esto.
//
// Prioridad: 1) admin ve todo siempre. 2) si tiene un Rol asignado a mano
// (usuarios.id_rol), ese manda — es la excepción puntual. 3) si no, y está
// vinculado a una Persona (usuarios.id_persona), su acceso es la SUMA de
// las pantallas de todas las Áreas de esa persona (así alguien con varios
// puestos ve la unión de lo que le corresponde a cada área). 4) si no tiene
// ni Rol ni Persona, sin restricción (compatibilidad con lo de siempre).
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
  // null = sin restricción. Array = solo puede ver esas pantallas.
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
    .select("nombre, rol, estado, id_rol, id_persona, roles(pantallas)")
    .eq("id_usuario", sesion.sub)
    .maybeSingle();
  if (!data || data.estado !== "ACTIVO") return null;

  const rol = data.rol ?? "operativo";
  if (rol === "admin") {
    return { idUsuario: sesion.sub, nombre: data.nombre, rol, pantallas: null };
  }

  // El Rol manual, si está puesto, es la excepción y manda por encima de
  // lo que diga el área de la persona.
  if (data.id_rol) {
    const rolAsignado = data.roles as unknown as { pantallas: string[] } | null;
    return { idUsuario: sesion.sub, nombre: data.nombre, rol, pantallas: rolAsignado?.pantallas ?? [] };
  }

  if (data.id_persona) {
    const { data: asignaciones } = await supabase
      .from("persona_puestos")
      .select("puestos(areas(pantallas))")
      .eq("id_persona", data.id_persona);
    const pantallas = new Set<string>();
    for (const a of asignaciones ?? []) {
      const puesto = a.puestos as unknown as { areas: { pantallas: string[] } | null } | null;
      for (const p of puesto?.areas?.pantallas ?? []) pantallas.add(p);
    }
    return { idUsuario: sesion.sub, nombre: data.nombre, rol, pantallas: [...pantallas] };
  }

  return { idUsuario: sesion.sub, nombre: data.nombre, rol, pantallas: null };
}

export function puedeVerPantalla(sesion: SesionConPantallas | null, clave: string) {
  if (!sesion) return false;
  if (sesion.pantallas === null) return true;
  return sesion.pantallas.includes(clave);
}
