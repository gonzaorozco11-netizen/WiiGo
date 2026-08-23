"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";

function text(formData: FormData, name: string) {
  const s = String(formData.get(name) ?? "").trim();
  return s.length ? s : null;
}

function number(formData: FormData, name: string) {
  const raw = formData.get(name);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function bool(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function marcaFromForm(formData: FormData) {
  return {
    nombre: text(formData, "nombre"),
    tipo_comercializacion: text(formData, "tipo_comercializacion") ?? "CONSIGNACION",
    cuit: text(formData, "cuit"),
    contacto: text(formData, "contacto"),
    telefono: text(formData, "telefono"),
    email: text(formData, "email"),
    direccion: text(formData, "direccion"),
    fee_ingreso: number(formData, "fee_ingreso"),
    royalty_porcentaje: number(formData, "royalty_porcentaje"),
    fecha_ingreso: text(formData, "fecha_ingreso"),
    estado: text(formData, "estado") ?? "ACTIVA",
    observaciones: text(formData, "observaciones"),
    iva_royalty_porcentaje: number(formData, "iva_royalty_porcentaje"),
    trasladar_comision_cobro: bool(formData, "trasladar_comision_cobro"),
    trasladar_iva_comision: bool(formData, "trasladar_iva_comision"),
    trasladar_sircreb: bool(formData, "trasladar_sircreb"),
    trasladar_imp_creditos: bool(formData, "trasladar_imp_creditos"),
    trasladar_otras_retenciones: bool(formData, "trasladar_otras_retenciones"),
    trasladar_otros_costos_cobro: bool(formData, "trasladar_otros_costos_cobro"),
    imp_debitos_porcentaje: number(formData, "imp_debitos_porcentaje"),
    trasladar_imp_debitos: bool(formData, "trasladar_imp_debitos"),
    frecuencia_liquidacion: text(formData, "frecuencia_liquidacion"),
  };
}

// Next.js redacta en producción el mensaje de un throw new Error() en una
// Server Action (queda solo un digest genérico) — por eso estas funciones
// devuelven { error } como dato en vez de tirar throw.
export async function createMarca(formData: FormData): Promise<{ error: string | null }> {
  try {
    const data = marcaFromForm(formData);
    if (!data.nombre) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("marcas").insert(data);
    if (error) return { error: error.message };
    revalidatePath("/marcas");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la marca" };
  }
}

export async function updateMarca(id: string, formData: FormData): Promise<{ error: string | null }> {
  try {
    const data = marcaFromForm(formData);
    if (!data.nombre) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("marcas").update(data).eq("id_marca", id);
    if (error) return { error: error.message };
    revalidatePath("/marcas");
    revalidatePath(`/marcas/${id}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar la marca" };
  }
}

export async function subirLogoMarca(
  idMarca: string,
  formData: FormData
): Promise<{ error: string | null; url?: string }> {
  const archivo = formData.get("archivo") as File | null;
  if (!archivo || archivo.size === 0) return { error: "Elegí un logo primero" };

  try {
    const supabase = getSupabaseServerClient();
    const extension = archivo.name.split(".").pop() ?? "jpg";
    const path = `${idMarca}-${Date.now()}.${extension}`;

    const { error: errorUpload } = await supabase.storage
      .from("fotos-marcas")
      .upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
    if (errorUpload) return { error: errorUpload.message };

    const { data } = supabase.storage.from("fotos-marcas").getPublicUrl(path);

    const { error: errorUpdate } = await supabase.from("marcas").update({ logo: data.publicUrl }).eq("id_marca", idMarca);
    if (errorUpdate) return { error: friendlyDbError(errorUpdate) };

    revalidatePath("/marcas");
    revalidatePath(`/marcas/${idMarca}`);
    return { error: null, url: data.publicUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo subir el logo" };
  }
}

export async function deleteMarca(id: string): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("marcas").delete().eq("id_marca", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/marcas");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo eliminar la marca" };
  }
}

function subcategoriaFromForm(formData: FormData) {
  return {
    nombre: text(formData, "nombre"),
    estado: text(formData, "estado") ?? "ACTIVA",
  };
}

export async function createSubcategoria(idMarca: string, formData: FormData): Promise<{ error: string | null }> {
  try {
    const data = subcategoriaFromForm(formData);
    if (!data.nombre) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("subcategorias").insert({ id_marca: idMarca, ...data });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath(`/marcas/${idMarca}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la subcategoría" };
  }
}

export async function updateSubcategoria(id: string, idMarca: string, formData: FormData): Promise<{ error: string | null }> {
  try {
    const data = subcategoriaFromForm(formData);
    if (!data.nombre) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("subcategorias").update(data).eq("id_subcategoria", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath(`/marcas/${idMarca}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar la subcategoría" };
  }
}

export async function deleteSubcategoria(id: string, idMarca: string): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("subcategorias").delete().eq("id_subcategoria", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath(`/marcas/${idMarca}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo eliminar la subcategoría" };
  }
}
