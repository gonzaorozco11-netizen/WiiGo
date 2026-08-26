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
    nombre_en: text(formData, "nombre_en"),
    nombre_pt: text(formData, "nombre_pt"),
    descripcion: text(formData, "descripcion"),
    imagen: text(formData, "imagen"),
    orden: intOrNull(formData, "orden"),
    estado: text(formData, "estado") ?? "ACTIVO",
  };
}

// Next.js redacta en producción el mensaje de un throw new Error() en una
// Server Action (queda solo un digest genérico) — por eso estas funciones
// devuelven { error } como dato en vez de tirar throw.
export async function createObjetivo(formData: FormData): Promise<{ error: string | null }> {
  try {
    const data = objetivoFromForm(formData);
    if (!data.nombre) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("objetivos").insert(data);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/catalogo-asesor");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el objetivo" };
  }
}

export async function updateObjetivo(id: string, formData: FormData): Promise<{ error: string | null }> {
  try {
    const data = objetivoFromForm(formData);
    if (!data.nombre) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("objetivos").update(data).eq("id_objetivo", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/catalogo-asesor");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar el objetivo" };
  }
}

export async function deleteObjetivo(id: string): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("objetivos").delete().eq("id_objetivo", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/catalogo-asesor");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo eliminar el objetivo" };
  }
}

function filtroFromForm(formData: FormData) {
  return {
    nombre: text(formData, "nombre"),
    nombre_en: text(formData, "nombre_en"),
    nombre_pt: text(formData, "nombre_pt"),
    tipo: text(formData, "tipo"),
    orden: intOrNull(formData, "orden"),
    estado: text(formData, "estado") ?? "ACTIVO",
  };
}

export async function createFiltro(formData: FormData): Promise<{ error: string | null }> {
  try {
    const data = filtroFromForm(formData);
    if (!data.nombre) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("filtros_producto").insert(data);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/catalogo-asesor");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el filtro" };
  }
}

export async function updateFiltro(id: string, formData: FormData): Promise<{ error: string | null }> {
  try {
    const data = filtroFromForm(formData);
    if (!data.nombre) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("filtros_producto").update(data).eq("id_filtro", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/catalogo-asesor");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar el filtro" };
  }
}

export async function deleteFiltro(id: string): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("filtros_producto").delete().eq("id_filtro", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/catalogo-asesor");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo eliminar el filtro" };
  }
}
