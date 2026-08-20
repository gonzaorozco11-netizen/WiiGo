"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";

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
    cuit: text(formData, "cuit"),
    contacto: text(formData, "contacto"),
    telefono: text(formData, "telefono"),
    email: text(formData, "email"),
    direccion: text(formData, "direccion"),
    fee_ingreso: number(formData, "fee_ingreso"),
    royalty_porcentaje: number(formData, "royalty_porcentaje"),
    fecha_ingreso: text(formData, "fecha_ingreso"),
    estado: text(formData, "estado") ?? "ACTIVO",
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

export async function createMarca(formData: FormData) {
  const data = marcaFromForm(formData);
  if (!data.nombre) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("marcas").insert(data);
  if (error) throw new Error(error.message);
  revalidatePath("/marcas");
}

export async function updateMarca(id: string, formData: FormData) {
  const data = marcaFromForm(formData);
  if (!data.nombre) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("marcas").update(data).eq("id_marca", id);
  if (error) throw new Error(error.message);
  revalidatePath("/marcas");
}

export async function deleteMarca(id: string) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("marcas").delete().eq("id_marca", id);
  if (error) throw new Error(error.message);
  revalidatePath("/marcas");
}
