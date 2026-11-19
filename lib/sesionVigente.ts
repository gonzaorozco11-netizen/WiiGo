// ¿La sesión de la cookie sigue valiendo? (seguridad, 19/11). Lo pregunta proxy.ts
// en cada pantalla y cada acción. Corta al toque (como mucho en un minuto):
//  · un usuario desactivado, aunque tenga la cookie guardada;
//  · las sesiones abiertas antes de «Cerrar sesión en todos los aparatos»
//    (usuarios.sesiones_desde, sql/seguridad-login.sql).
// Se guarda un minuto en memoria por usuario para no consultar la base en cada clic.
// Si la base no contesta, deja pasar: la firma de la cookie sigue protegiendo.

import { getSupabaseServerClient } from "@/lib/supabase";
import type { SessionPayload } from "@/lib/session";

type Estado = { activo: boolean; desde: number | null; leido: number };
const CACHE_MS = 60_000;
const cache = new Map<string, Estado>();

async function leer(idUsuario: string): Promise<Estado | null> {
  const ya = cache.get(idUsuario);
  if (ya && Date.now() - ya.leido < CACHE_MS) return ya;
  try {
    const supabase = getSupabaseServerClient();
    let r = await supabase.from("usuarios").select("estado, sesiones_desde").eq("id_usuario", idUsuario).maybeSingle();
    // Sin el SQL todavía: solo el estado.
    if (r.error) r = (await supabase.from("usuarios").select("estado").eq("id_usuario", idUsuario).maybeSingle()) as typeof r;
    if (r.error) return null;
    const d = r.data as { estado?: string; sesiones_desde?: string | null } | null;
    const e: Estado = {
      activo: d?.estado === "ACTIVO",
      desde: d?.sesiones_desde ? Date.parse(d.sesiones_desde) / 1000 : null,
      leido: Date.now(),
    };
    cache.set(idUsuario, e);
    if (cache.size > 500) cache.delete(cache.keys().next().value as string);
    return e;
  } catch {
    return null;
  }
}

export async function sesionVigente(s: SessionPayload): Promise<boolean> {
  const e = await leer(s.sub);
  if (!e) return true;
  if (!e.activo) return false;
  if (e.desde != null && (s.iat ?? 0) < e.desde) return false;
  return true;
}

/** Después de «Cerrar sesión en todos los aparatos» o de desactivar: que pegue ya en este servidor. */
export function olvidarSesion(idUsuario: string) {
  cache.delete(idUsuario);
}
