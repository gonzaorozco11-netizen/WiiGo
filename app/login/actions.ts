"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, createSessionToken } from "@/lib/session";
import { verifyPassword } from "@/lib/auth";
import { getSupabaseServerClient, type Usuario } from "@/lib/supabase";

export async function login(_prevState: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    return { error: "La app no está configurada todavía (falta AUTH_SECRET)." };
  }

  if (!email || !password) {
    return { error: "Ingresá tu email y tu contraseña." };
  }

  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("usuarios")
    .select("id_usuario, nombre, rol, estado, password_hash")
    .eq("email", email)
    .maybeSingle();
  const usuario = data as Pick<
    Usuario,
    "id_usuario" | "nombre" | "rol" | "estado" | "password_hash"
  > | null;

  if (!usuario || usuario.estado !== "ACTIVO") {
    return { error: "Email o contraseña incorrectos." };
  }

  const valid = await verifyPassword(password, usuario.password_hash);
  if (!valid) {
    return { error: "Email o contraseña incorrectos." };
  }

  const token = await createSessionToken(
    { sub: usuario.id_usuario, nombre: usuario.nombre, rol: usuario.rol ?? "" },
    authSecret
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 días
  });

  // Cada rol a su casa. El usuario de una marca no ve el sistema interno, así
  // que no tiene sentido mandarlo a "/" ni respetar un ?next= que apunte
  // adentro: de ahí lo rebotaría el layout igual.
  if (usuario.rol === "marca") redirect("/portal");

  redirect(next && next.startsWith("/") ? next : "/");
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
