"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";

function text(formData: FormData, name: string) {
  const s = String(formData.get(name) ?? "").trim();
  return s.length ? s : null;
}

function clienteFromForm(formData: FormData) {
  return {
    nombre: text(formData, "nombre"),
    apellido: text(formData, "apellido"),
    dni: text(formData, "dni"),
    email: text(formData, "email"),
    telefono: text(formData, "telefono"),
    fecha_nacimiento: text(formData, "fecha_nacimiento"),
    estado: text(formData, "estado") ?? "ACTIVO",
  };
}

// Next.js redacta en producción el mensaje de un throw new Error() en una
// Server Action (queda solo un digest genérico) — por eso estas funciones
// devuelven { error } como dato en vez de tirar throw.
export async function createCliente(formData: FormData): Promise<{ error: string | null }> {
  try {
    const data = clienteFromForm(formData);
    if (!data.nombre) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("clientes").insert({ ...data, puntos: 0 });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/clientes");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el cliente" };
  }
}

export async function updateCliente(id: string, formData: FormData): Promise<{ error: string | null }> {
  try {
    const data = clienteFromForm(formData);
    if (!data.nombre) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("clientes").update(data).eq("id_cliente", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/clientes");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar el cliente" };
  }
}

export async function deleteCliente(id: string): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("clientes").delete().eq("id_cliente", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/clientes");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo eliminar el cliente" };
  }
}
