// La parte de la tablet del local que necesita la base (ver lib/aparatoLocal.ts).
// No la usa el proxy (Edge): la usan el layout, el fichaje y la salida.
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { COOKIE_APARATO, leerAparato, rolAtadoALaTablet, type Aparato } from "@/lib/aparatoLocal";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

/**
 * En qué aparato se está usando el sistema:
 *   - "local": una tablet registrada y vigente.
 *   - "otro":  cualquier otro (el celular de alguien).
 *   - "baja":  una tablet que el Dueño dio de baja (se perdió, se cambió).
 * Si la base no contesta se confía en la firma: que un corte no deje al local
 * sin poder fichar ni cobrar.
 */
export async function estadoAparato(): Promise<{ estado: "local" | "otro" | "baja"; aparato: Aparato | null }> {
  const cookieStore = await cookies();
  const aparato = await leerAparato(cookieStore.get(COOKIE_APARATO)?.value, process.env.AUTH_SECRET ?? "");
  if (!aparato) return { estado: "otro", aparato: null };
  const { data, error } = await getSupabaseServerClient().from("aparatos_local").select("baja_en").eq("id_aparato", aparato.id).maybeSingle();
  if (error) return { estado: "local", aparato };
  if (!data || data.baja_en) return { estado: "baja", aparato };
  return { estado: "local", aparato };
}

/** Para las acciones que solo valen en el local (fichar): null si puede, o el error para mostrar. */
export async function errorSiNoEsLaTablet(): Promise<string | null> {
  const cookieStore = await cookies();
  const sesion = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  if (!sesion || !rolAtadoALaTablet(sesion.rol)) return null;
  const { estado } = await estadoAparato();
  return estado === "local" ? null : "Esto se hace solo en la tablet del local.";
}
