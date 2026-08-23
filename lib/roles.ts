// Acceso por Área: Dueño (admin) ve todo siempre. Un operativo ve pantallas
// según las Áreas de la Persona a la que está vinculado en Organización, o
// según Áreas puestas a mano en su Usuario como excepción puntual. No hay
// una entidad "Rol" separada — el Área ES lo que se asigna.
//
// Prioridad: 1) admin ve todo. 2) si el usuario tiene Áreas puestas a mano
// (usuarios.areas_acceso), esas mandan — es la excepción. 3) si no, y está
// vinculado a una Persona (usuarios.id_persona), su acceso es la SUMA de
// las pantallas de todas las Áreas de esa persona. 4) si no tiene ni Áreas
// a mano ni Persona, sin restricción (compatibilidad con lo de siempre —
// nadie que ya estaba cargado se queda sin acceso por esto).
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

async function pantallasDeAreas(supabase: ReturnType<typeof getSupabaseServerClient>, idsArea: string[]) {
  if (idsArea.length === 0) return [];
  const { data } = await supabase.from("areas").select("pantallas").in("id_area", idsArea);
  const pantallas = new Set<string>();
  for (const a of data ?? []) for (const p of a.pantallas ?? []) pantallas.add(p);
  return [...pantallas];
}

export async function obtenerSesionConPantallas(): Promise<SesionConPantallas | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("usuarios")
    .select("nombre, rol, estado, id_persona, areas_acceso")
    .eq("id_usuario", sesion.sub)
    .maybeSingle();
  if (!data || data.estado !== "ACTIVO") return null;

  const rol = data.rol ?? "operativo";
  if (rol === "admin") {
    return { idUsuario: sesion.sub, nombre: data.nombre, rol, pantallas: null };
  }

  // Áreas puestas a mano en el usuario: excepción, pisa lo de su persona.
  if ((data.areas_acceso ?? []).length > 0) {
    const pantallas = await pantallasDeAreas(supabase, data.areas_acceso);
    return { idUsuario: sesion.sub, nombre: data.nombre, rol, pantallas };
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
