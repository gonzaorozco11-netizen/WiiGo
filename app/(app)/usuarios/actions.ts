"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth";

function text(formData: FormData, name: string) {
  const s = String(formData.get(name) ?? "").trim();
  return s.length ? s : null;
}

export async function crearUsuario(formData: FormData) {
  const nombre = text(formData, "nombre");
  const email = text(formData, "email")?.toLowerCase() ?? null;
  const rol = text(formData, "rol") ?? "operativo";
  const password = String(formData.get("password") ?? "");

  if (!nombre) throw new Error("El nombre es obligatorio");
  if (!email) throw new Error("El email es obligatorio");
  if (password.length < 6) throw new Error("La contraseña tiene que tener al menos 6 caracteres");

  const supabase = getSupabaseServerClient();
  const password_hash = await hashPassword(password);

  const { error } = await supabase.from("usuarios").insert({
    nombre,
    email,
    rol,
    password_hash,
    estado: "ACTIVO",
  });
  if (error) throw new Error(friendlyDbError(error));

  revalidatePath("/usuarios");
}

export async function cambiarEstadoUsuario(id: string, estado: string) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("usuarios").update({ estado }).eq("id_usuario", id);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/usuarios");
}

export async function cambiarPasswordUsuario(id: string, password: string) {
  if (password.length < 6) throw new Error("La contraseña tiene que tener al menos 6 caracteres");
  const supabase = getSupabaseServerClient();
  const password_hash = await hashPassword(password);
  const { error } = await supabase.from("usuarios").update({ password_hash }).eq("id_usuario", id);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/usuarios");
}
