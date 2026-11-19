// Seguridad del ingreso (Gonzalo, 19/11). Ver sql/seguridad-login.sql.
//
// · Con INTENTOS_MAX contraseñas mal seguidas, ESE usuario (no la tablet) queda
//   bloqueado BLOQUEO_MIN minutos. Si es el del Dueño, le llega un mail.
// · «Cerrar sesión en todos los aparatos»: usuarios.sesiones_desde. Toda sesión
//   firmada antes de esa hora deja de servir (lo corta proxy.ts).
//
// Si el SQL todavía no se corrió, nada de esto traba el ingreso: se saltea.

import type { getSupabaseServerClient } from "@/lib/supabase";
import { enviarMail } from "@/lib/mail";

type Supa = ReturnType<typeof getSupabaseServerClient>;

export const INTENTOS_MAX = 5;
export const BLOQUEO_MIN = 15;

/** Si está bloqueado, hasta cuándo (null si no). */
export async function bloqueadoHasta(supabase: Supa, idUsuario: string): Promise<Date | null> {
  const { data, error } = await supabase.from("usuarios").select("bloqueado_hasta").eq("id_usuario", idUsuario).maybeSingle();
  if (error || !data?.bloqueado_hasta) return null;
  const hasta = new Date(data.bloqueado_hasta as string);
  return hasta.getTime() > Date.now() ? hasta : null;
}

/** Una contraseña mal. Devuelve true si con esta quedó bloqueado. */
export async function anotarFallido(
  supabase: Supa,
  u: { id_usuario: string; nombre: string; rol: string | null; email: string }
): Promise<boolean> {
  const { data, error } = await supabase.from("usuarios").select("login_fallidos").eq("id_usuario", u.id_usuario).maybeSingle();
  if (error) return false;
  const n = Number(data?.login_fallidos ?? 0) + 1;
  if (n < INTENTOS_MAX) {
    await supabase.from("usuarios").update({ login_fallidos: n }).eq("id_usuario", u.id_usuario);
    return false;
  }
  const hasta = new Date(Date.now() + BLOQUEO_MIN * 60_000);
  await supabase.from("usuarios").update({ login_fallidos: 0, bloqueado_hasta: hasta.toISOString() }).eq("id_usuario", u.id_usuario);
  if (u.rol === "admin") {
    const hora = hasta.toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" });
    const texto =
      `Alguien puso ${INTENTOS_MAX} veces mal la contraseña de tu usuario de WiiGo (${u.email}). ` +
      `Por seguridad quedó bloqueado hasta las ${hora}. Si fuiste vos, esperá y volvé a probar. ` +
      `Si no fuiste vos, cambiá la contraseña apenas entres.`;
    await enviarMail({ para: [u.email], asunto: "WiiGo: intentaron entrar con tu usuario", html: `<p>${texto}</p>`, texto }).catch(() => null);
  }
  return true;
}

/** Entró bien: se borra la cuenta de intentos. */
export async function limpiarFallidos(supabase: Supa, idUsuario: string) {
  await supabase.from("usuarios").update({ login_fallidos: 0, bloqueado_hasta: null }).eq("id_usuario", idUsuario).then(() => null, () => null);
}

export function mensajeBloqueado(hasta: Date) {
  const min = Math.max(1, Math.ceil((hasta.getTime() - Date.now()) / 60_000));
  return `Por seguridad, tu usuario quedó bloqueado por varios intentos fallidos. Probá de nuevo en ${min} ${min === 1 ? "minuto" : "minutos"}, o pedile a Gonzalo que te desbloquee.`;
}
