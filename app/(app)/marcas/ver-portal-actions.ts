"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase";
import { COOKIE_VER_MARCA } from "@/lib/marcaSesion";

// "Ver su portal como lo ve la marca" (Gonzalo, 2026-11-02). Deja a Gonzalo
// mirando el portal de una marca en solo lectura: no entra con el usuario de
// la marca ni toca su sesión. Ver sesionDelPortal en lib/marcaSesion.ts.

export async function verPortalComoMarca(idMarca: string): Promise<{ error: string | null }> {
  const cookieStore = await cookies();
  const sesion = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  if (sesion?.rol !== "admin") return { error: "Solo el Dueño puede mirar el portal de una marca." };
  const { data } = await getSupabaseServerClient().from("marcas").select("estado, tipo_comercializacion").eq("id_marca", idMarca).maybeSingle();
  if (!data) return { error: "No encontré esa marca." };
  if (data.estado !== "ACTIVA") return { error: "La marca está dada de baja: no tiene portal para mirar." };
  cookieStore.set(COOKIE_VER_MARCA, idMarca, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 });
  return { error: null };
}

export async function dejarDeVerPortal(): Promise<void> {
  const cookieStore = await cookies();
  const id = cookieStore.get(COOKIE_VER_MARCA)?.value;
  cookieStore.delete(COOKIE_VER_MARCA);
  redirect(id ? `/marcas/${encodeURIComponent(id)}` : "/marcas");
}
