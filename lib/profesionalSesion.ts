import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

// Sesión del espacio de cada profesional (/mi-espacio).
//
// Misma regla que el portal de marcas (lib/marcaSesion.ts): **la profesional
// sale de la sesión, nunca de la URL ni de un parámetro**. Si el id viajara en
// la dirección, cambiando un número una vería los datos de otra.
//
// Se lee fresco de la base en cada pedido: si Gonzalo le da de baja el usuario
// o la desactiva, pega en el acto.

export type SesionProfesional = {
  idUsuario: string;
  idProfesional: string;
  nombre: string;
  apellido: string | null;
  foto: string | null;
  publicado: boolean;
  autorizoImagenAt: string | null;
};

export async function obtenerSesionProfesional(): Promise<SesionProfesional | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (!sesion || sesion.rol !== "profesional") return null;

  const supabase = getSupabaseServerClient();
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("id_usuario, rol, estado, id_profesional")
    .eq("id_usuario", sesion.sub)
    .maybeSingle();
  if (!usuario || usuario.estado !== "ACTIVO" || usuario.rol !== "profesional" || !usuario.id_profesional) return null;

  const { data: p } = await supabase
    .from("profesionales")
    .select("id_profesional, nombre, apellido, foto, estado, publicado, autorizo_imagen_at")
    .eq("id_profesional", usuario.id_profesional)
    .maybeSingle();
  // Profesional desactivada: el usuario deja de entrar aunque siga activo.
  if (!p || p.estado !== "ACTIVO") return null;

  return {
    idUsuario: usuario.id_usuario as string,
    idProfesional: p.id_profesional as string,
    nombre: p.nombre as string,
    apellido: (p.apellido as string | null) ?? null,
    foto: (p.foto as string | null) ?? null,
    publicado: Boolean(p.publicado),
    autorizoImagenAt: (p.autorizo_imagen_at as string | null) ?? null,
  };
}

/**
 * Anota en su historial lo que hizo desde su espacio. Gonzalo lo ve en la
 * ficha de la profesional ("Todo lo que hizo"). Si falla (por ejemplo, falta
 * el SQL), no frena lo que ella estaba haciendo.
 */
export async function registrarActividad(
  supabase: SupabaseClient,
  idProfesional: string,
  accion: string,
  esperaAprobacion = false
) {
  await supabase
    .from("actividad_profesional")
    .insert({ id_profesional: idProfesional, accion, espera_aprobacion: esperaAprobacion });
}
