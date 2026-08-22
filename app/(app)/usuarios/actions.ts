"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth";

function text(formData: FormData, name: string) {
  const s = String(formData.get(name) ?? "").trim();
  return s.length ? s : null;
}

// Next.js redacta en producción el mensaje de un Error tirado desde una
// Server Action (queda solo un digest genérico en el navegador) — por eso
// estas funciones no throwean para errores esperables: devuelven { error }.
export async function crearUsuario(formData: FormData): Promise<{ error: string | null }> {
  const nombre = text(formData, "nombre");
  const email = text(formData, "email")?.toLowerCase() ?? null;
  const rol = text(formData, "rol") ?? "operativo";
  const password = String(formData.get("password") ?? "");

  if (!nombre) return { error: "El nombre es obligatorio" };
  if (!email) return { error: "El email es obligatorio" };
  if (password.length < 6) return { error: "La contraseña tiene que tener al menos 6 caracteres" };

  try {
    const supabase = getSupabaseServerClient();
    const password_hash = await hashPassword(password);

    const { error } = await supabase.from("usuarios").insert({
      nombre,
      email,
      rol,
      password_hash,
      estado: "ACTIVO",
    });
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/usuarios");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el usuario" };
  }
}

export async function cambiarEstadoUsuario(id: string, estado: string): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("usuarios").update({ estado }).eq("id_usuario", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/usuarios");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cambiar el estado del usuario" };
  }
}

export async function cambiarPasswordUsuario(id: string, password: string): Promise<{ error: string | null }> {
  if (password.length < 6) return { error: "La contraseña tiene que tener al menos 6 caracteres" };
  try {
    const supabase = getSupabaseServerClient();
    const password_hash = await hashPassword(password);
    const { error } = await supabase.from("usuarios").update({ password_hash }).eq("id_usuario", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/usuarios");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cambiar la contraseña" };
  }
}

// Usado desde la pestaña Nómina de Gastos para calcular sueldo base −
// adelantos del mes.
export async function actualizarSueldoBase(id: string, sueldoBase: number): Promise<{ error: string | null }> {
  if (sueldoBase < 0) return { error: "El sueldo no puede ser negativo" };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("usuarios").update({ sueldo_base: sueldoBase }).eq("id_usuario", id);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/gastos");
  return { error: null };
}
