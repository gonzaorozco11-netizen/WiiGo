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
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("id_usuario, nombre, rol, estado, password_hash")
    .eq("email", email)
    .maybeSingle<Pick<Usuario, "id_usuario" | "nombre" | "rol" | "estado" | "password_hash">>();

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

  redirect(next && next.startsWith("/") ? next : "/");
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
