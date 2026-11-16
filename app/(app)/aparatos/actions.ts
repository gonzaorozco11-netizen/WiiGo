"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { COOKIE_APARATO, firmarAparato, leerAparato, opcionesCookieAparato } from "@/lib/aparatoLocal";

// Tablets del local (lib/aparatoLocal.ts): solo el Dueño las registra o las da de baja.
async function dueno() {
  const cookieStore = await cookies();
  const sesion = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  return sesion?.rol === "admin" ? sesion : null;
}

/** Marca el aparato desde el que se toca el botón como tablet del local. */
export async function registrarEsteAparato(formData: FormData) {
  const sesion = await dueno();
  if (!sesion) redirect("/aparatos?error=permiso");
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret) redirect("/aparatos?error=config");
  const nombre = String(formData.get("nombre") ?? "").trim().slice(0, 60) || "Tablet del local";

  const { data, error } = await getSupabaseServerClient()
    .from("aparatos_local")
    .insert({ nombre, registrado_por: sesion.sub })
    .select("id_aparato")
    .single();
  if (error || !data) redirect(`/aparatos?error=${error?.code === "42P01" || error?.code === "PGRST205" ? "sql" : "guardar"}`);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_APARATO, await firmarAparato({ id: data.id_aparato as string, nombre }, secret), opcionesCookieAparato);
  revalidatePath("/aparatos");
  redirect("/aparatos?ok=1");
}

/** Una tablet que se perdió o se cambió: deja de abrir el sistema para los operativos. */
export async function darDeBajaAparato(formData: FormData) {
  if (!(await dueno())) redirect("/aparatos?error=permiso");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/aparatos");
  const { error } = await getSupabaseServerClient().from("aparatos_local").update({ baja_en: new Date().toISOString() }).eq("id_aparato", id).is("baja_en", null);
  if (error) redirect("/aparatos?error=guardar");

  // Si es esta misma, se le borra también la marca.
  const cookieStore = await cookies();
  const este = await leerAparato(cookieStore.get(COOKIE_APARATO)?.value, process.env.AUTH_SECRET ?? "");
  if (este?.id === id) cookieStore.delete(COOKIE_APARATO);
  revalidatePath("/aparatos");
  redirect("/aparatos");
}
