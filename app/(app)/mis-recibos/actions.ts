"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

// Firmar el recibo propio desde el usuario de cada uno. Solo el dueño del
// recibo lo puede firmar, y solo uno ya pagado.

function firmaValida(firma: string | null | undefined): firma is string {
  return typeof firma === "string" && firma.length < 200_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(firma);
}

export async function firmarMiRecibo(idCierre: string, firma: string): Promise<{ error: string | null }> {
  if (!firmaValida(firma)) return { error: "Firmá en el recuadro antes de confirmar." };
  const cookieStore = await cookies();
  const sesion = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  if (!sesion) return { error: "Tu sesión se cerró: volvé a entrar." };

  const supabase = getSupabaseServerClient();
  const { data: usuario } = await supabase.from("usuarios").select("id_persona").eq("id_usuario", sesion.sub).maybeSingle();
  const { data: cierre } = await supabase.from("nomina_cierres").select("id_persona, estado").eq("id_cierre", idCierre).maybeSingle();
  if (!cierre || !usuario?.id_persona || cierre.id_persona !== usuario.id_persona) return { error: "Ese recibo no es tuyo." };
  if (cierre.estado !== "PAGADO") return { error: "Ese sueldo todavía no está pagado." };

  const { error } = await supabase.from("nomina_cierres").update({ firma, firmado_en: new Date().toISOString() }).eq("id_cierre", idCierre);
  if (error) return { error: "No se pudo guardar la firma. Avisale a administración." };
  revalidatePath("/mis-recibos");
  revalidatePath("/mis-tareas");
  return { error: null };
}
