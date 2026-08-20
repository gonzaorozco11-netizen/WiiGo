"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

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

function intOrZero(formData: FormData, name: string) {
  const n = number(formData, name);
  return n === null ? 0 : Math.trunc(n);
}

// Si se escribió el nombre de una subcategoría nueva, la crea y devuelve su
// id. Si no, usa la que ya estaba seleccionada (puede ser null).
async function resolveSubcategoria(supabase: SupabaseClient, formData: FormData, idMarca: string) {
  const nueva = text(formData, "nueva_subcategoria");
  if (!nueva) return text(formData, "id_subcategoria");

  const { data, error } = await supabase
    .from("subcategorias")
    .insert({ id_marca: idMarca, nombre: nueva, estado: "ACTIVO" })
    .select("id_subcategoria")
    .single();
  if (error) throw new Error(error.message);
  return data.id_subcategoria as string;
}

function productoFromForm(formData: FormData, idMarca: string, idSubcategoria: string | null) {
  return {
    id_marca: idMarca,
    id_subcategoria: idSubcategoria,
    sku: text(formData, "sku"),
    codigo_barras: text(formData, "codigo_barras"),
    nombre: text(formData, "nombre"),
    descripcion: text(formData, "descripcion"),
    costo_informado: number(formData, "costo_informado"),
    precio_venta: number(formData, "precio_venta"),
    stock_minimo: intOrZero(formData, "stock_minimo"),
    stock_objetivo: intOrZero(formData, "stock_objetivo"),
    puntos: intOrZero(formData, "puntos"),
    imagen: text(formData, "imagen"),
    estado: text(formData, "estado") ?? "ACTIVO",
    fecha_actualizacion: new Date().toISOString(),
  };
}

export async function createProducto(formData: FormData) {
  const idMarca = text(formData, "id_marca");
  if (!idMarca) throw new Error("Elegí una marca");
  if (!text(formData, "nombre")) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const idSubcategoria = await resolveSubcategoria(supabase, formData, idMarca);
  const data = productoFromForm(formData, idMarca, idSubcategoria);

  const { error } = await supabase.from("productos").insert(data);
  if (error) throw new Error(error.message);
  revalidatePath("/productos");
}

export async function updateProducto(id: string, formData: FormData) {
  const idMarca = text(formData, "id_marca");
  if (!idMarca) throw new Error("Elegí una marca");
  if (!text(formData, "nombre")) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const idSubcategoria = await resolveSubcategoria(supabase, formData, idMarca);
  const data = productoFromForm(formData, idMarca, idSubcategoria);

  const { error } = await supabase.from("productos").update(data).eq("id_producto", id);
  if (error) throw new Error(error.message);
  revalidatePath("/productos");
}

export async function deleteProducto(id: string) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("productos").delete().eq("id_producto", id);
  if (error) throw new Error(error.message);
  revalidatePath("/productos");
}
