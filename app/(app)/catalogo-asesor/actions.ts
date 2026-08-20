"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";

function text(formData: FormData, name: string) {
  const s = String(formData.get(name) ?? "").trim();
  return s.length ? s : null;
}

function intOrNull(formData: FormData, name: string) {
  const raw = formData.get(name);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function objetivoFromForm(formData: FormData) {
  return {
    nombre: text(formData, "nombre"),
    descripcion: text(formData, "descripcion"),
    imagen: text(formData, "imagen"),
    orden: intOrNull(formData, "orden"),
    estado: text(formData, "estado") ?? "ACTIVO",
  };
}

export async function createObjetivo(formData: FormData) {
  const data = objetivoFromForm(formData);
  if (!data.nombre) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("objetivos").insert(data);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/catalogo-asesor");
}

export async function updateObjetivo(id: string, formData: FormData) {
  const data = objetivoFromForm(formData);
  if (!data.nombre) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("objetivos").update(data).eq("id_objetivo", id);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/catalogo-asesor");
}

export async function deleteObjetivo(id: string) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("objetivos").delete().eq("id_objetivo", id);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/catalogo-asesor");
}

function filtroFromForm(formData: FormData) {
  return {
    nombre: text(formData, "nombre"),
    tipo: text(formData, "tipo"),
    orden: intOrNull(formData, "orden"),
    estado: text(formData, "estado") ?? "ACTIVO",
  };
}

export async function createFiltro(formData: FormData) {
  const data = filtroFromForm(formData);
  if (!data.nombre) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("filtros_producto").insert(data);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/catalogo-asesor");
}

export async function updateFiltro(id: string, formData: FormData) {
  const data = filtroFromForm(formData);
  if (!data.nombre) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("filtros_producto").update(data).eq("id_filtro", id);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/catalogo-asesor");
}

export async function deleteFiltro(id: string) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("filtros_producto").delete().eq("id_filtro", id);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/catalogo-asesor");
}
