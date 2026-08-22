"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";

function text(formData: FormData, name: string) {
  const s = String(formData.get(name) ?? "").trim();
  return s.length ? s : null;
}

function localFromForm(formData: FormData) {
  return {
    nombre: text(formData, "nombre"),
    direccion: text(formData, "direccion"),
    telefono: text(formData, "telefono"),
    estado: text(formData, "estado") ?? "ACTIVO",
    observaciones: text(formData, "observaciones"),
  };
}

// Next.js redacta en producción el mensaje de un throw new Error() en una
// Server Action (queda solo un digest genérico) — por eso estas funciones
// devuelven { error } como dato en vez de tirar throw.
export async function createLocal(formData: FormData): Promise<{ error: string | null }> {
  try {
    const data = localFromForm(formData);
    if (!data.nombre) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("locales").insert(data);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/locales");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el local" };
  }
}

export async function updateLocal(id: string, formData: FormData): Promise<{ error: string | null }> {
  try {
    const data = localFromForm(formData);
    if (!data.nombre) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("locales").update(data).eq("id_local", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/locales");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar el local" };
  }
}

export async function deleteLocal(id: string): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("locales").delete().eq("id_local", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/locales");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo eliminar el local" };
  }
}
