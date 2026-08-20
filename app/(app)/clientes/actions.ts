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

export async function createCliente(formData: FormData) {
  const data = clienteFromForm(formData);
  if (!data.nombre) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("clientes").insert({ ...data, puntos: 0 });
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/clientes");
}

export async function updateCliente(id: string, formData: FormData) {
  const data = clienteFromForm(formData);
  if (!data.nombre) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("clientes").update(data).eq("id_cliente", id);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/clientes");
}

export async function deleteCliente(id: string) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("clientes").delete().eq("id_cliente", id);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/clientes");
}
