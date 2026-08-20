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

export async function createLocal(formData: FormData) {
  const data = localFromForm(formData);
  if (!data.nombre) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("locales").insert(data);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/locales");
}

export async function updateLocal(id: string, formData: FormData) {
  const data = localFromForm(formData);
  if (!data.nombre) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("locales").update(data).eq("id_local", id);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/locales");
}

export async function deleteLocal(id: string) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("locales").delete().eq("id_local", id);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/locales");
}
