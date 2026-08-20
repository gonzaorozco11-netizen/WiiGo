"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
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
    .insert({ id_marca: idMarca, nombre: nueva, estado: "ACTIVA" })
    .select("id_subcategoria")
    .single();
  if (error) throw new Error(error.message);
  return data.id_subcategoria as string;
}

// SKU y código de barras NO se piden por formulario: se generan una sola
// vez al crear el producto y quedan fijos para siempre (mismo código en
// todos los locales), así nunca hay que volver a cargarlos a mano.
function productoFromForm(formData: FormData, idMarca: string, idSubcategoria: string | null) {
  return {
    id_marca: idMarca,
    id_subcategoria: idSubcategoria,
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

// Prefijo de 3 letras a partir del nombre de la marca (sin tildes ni
// símbolos), para armar un SKU legible: BLO-0001, BLO-0002...
function prefijoDesdeNombre(nombre: string) {
  const soloLetras = nombre
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  return soloLetras.slice(0, 3) || "PRD";
}

async function generarSku(supabase: SupabaseClient, idMarca: string) {
  const { data: marca } = await supabase
    .from("marcas")
    .select("nombre")
    .eq("id_marca", idMarca)
    .maybeSingle();
  const prefijo = prefijoDesdeNombre(marca?.nombre ?? "PRD");

  const { data: existentes } = await supabase
    .from("productos")
    .select("sku")
    .eq("id_marca", idMarca)
    .like("sku", `${prefijo}-%`);

  let mayor = 0;
  (existentes ?? []).forEach((row: { sku: string | null }) => {
    const m = row.sku?.match(new RegExp(`^${prefijo}-(\\d+)$`));
    if (m) mayor = Math.max(mayor, parseInt(m[1], 10));
  });

  return `${prefijo}-${String(mayor + 1).padStart(4, "0")}`;
}

// Código interno de 11 dígitos empezando en "20...", el rango que el
// estándar EAN reserva para uso interno/en tienda (no es un código
// registrado globalmente, pero sirve igual para escanear en Self Checkout).
async function generarCodigoBarras(supabase: SupabaseClient) {
  const BASE = 20000000000;
  const { data: existentes } = await supabase.from("productos").select("codigo_barras");

  let mayor = BASE;
  (existentes ?? []).forEach((row: { codigo_barras: string | null }) => {
    const n = Number(row.codigo_barras);
    if (Number.isFinite(n) && n > mayor) mayor = n;
  });

  return String(mayor + 1);
}

function fichaFromForm(formData: FormData) {
  return {
    origen: text(formData, "ficha_origen"),
    ingredientes: text(formData, "ficha_ingredientes"),
    porcion: text(formData, "ficha_porcion"),
    kcal_100g: number(formData, "ficha_kcal"),
    proteinas: number(formData, "ficha_proteinas"),
    carbohidratos: number(formData, "ficha_carbohidratos"),
    grasas: number(formData, "ficha_grasas"),
    fibra: number(formData, "ficha_fibra"),
    sodio: number(formData, "ficha_sodio"),
    micronutrientes: text(formData, "ficha_micronutrientes"),
    clasificacion: text(formData, "ficha_clasificacion"),
    descripcion_publica: text(formData, "ficha_descripcion_publica"),
    imagen_principal: text(formData, "ficha_imagen_principal"),
    video: text(formData, "ficha_video"),
    estado: text(formData, "ficha_estado") ?? "ACTIVO",
  };
}

async function guardarFicha(supabase: SupabaseClient, idProducto: string, formData: FormData) {
  const data = fichaFromForm(formData);
  const { error } = await supabase
    .from("ficha_producto")
    .upsert({ id_producto: idProducto, ...data }, { onConflict: "id_producto" });
  if (error) throw new Error(friendlyDbError(error));
}

// Reemplaza por completo las relaciones producto↔objetivo o producto↔filtro:
// borra todas las que había y crea las que quedaron tildadas en el form.
async function sincronizarRelacion(
  supabase: SupabaseClient,
  tabla: "producto_objetivos" | "producto_filtros",
  columna: "id_objetivo" | "id_filtro",
  idProducto: string,
  seleccionados: string[]
) {
  const { error: errorBorrado } = await supabase.from(tabla).delete().eq("id_producto", idProducto);
  if (errorBorrado) throw new Error(friendlyDbError(errorBorrado));

  if (seleccionados.length === 0) return;

  const filas = seleccionados.map((id) => ({ id_producto: idProducto, [columna]: id }));
  const { error } = await supabase.from(tabla).insert(filas);
  if (error) throw new Error(friendlyDbError(error));
}

async function guardarContenidoAsesor(supabase: SupabaseClient, idProducto: string, formData: FormData) {
  await guardarFicha(supabase, idProducto, formData);
  await sincronizarRelacion(
    supabase,
    "producto_objetivos",
    "id_objetivo",
    idProducto,
    formData.getAll("objetivos").map(String)
  );
  await sincronizarRelacion(
    supabase,
    "producto_filtros",
    "id_filtro",
    idProducto,
    formData.getAll("filtros").map(String)
  );
}

export async function createProducto(formData: FormData) {
  const idMarca = text(formData, "id_marca");
  if (!idMarca) throw new Error("Elegí una marca");
  if (!text(formData, "nombre")) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const idSubcategoria = await resolveSubcategoria(supabase, formData, idMarca);
  const sku = await generarSku(supabase, idMarca);
  const codigoBarras = await generarCodigoBarras(supabase);
  const data = {
    ...productoFromForm(formData, idMarca, idSubcategoria),
    sku,
    codigo_barras: codigoBarras,
  };

  const { data: inserted, error } = await supabase
    .from("productos")
    .insert(data)
    .select("id_producto")
    .single();
  if (error) throw new Error(friendlyDbError(error));

  await guardarContenidoAsesor(supabase, inserted.id_producto, formData);

  revalidatePath("/productos");
  revalidatePath(`/marcas/${idMarca}`);
}

export async function updateProducto(id: string, formData: FormData) {
  const idMarca = text(formData, "id_marca");
  if (!idMarca) throw new Error("Elegí una marca");
  if (!text(formData, "nombre")) throw new Error("El nombre es obligatorio");

  const supabase = getSupabaseServerClient();
  const idSubcategoria = await resolveSubcategoria(supabase, formData, idMarca);
  const data = productoFromForm(formData, idMarca, idSubcategoria);

  const { error } = await supabase.from("productos").update(data).eq("id_producto", id);
  if (error) throw new Error(friendlyDbError(error));

  await guardarContenidoAsesor(supabase, id, formData);

  revalidatePath("/productos");
  revalidatePath(`/marcas/${idMarca}`);
}

export async function deleteProducto(id: string) {
  const supabase = getSupabaseServerClient();
  const { data: producto } = await supabase
    .from("productos")
    .select("id_marca")
    .eq("id_producto", id)
    .maybeSingle();

  const { error } = await supabase.from("productos").delete().eq("id_producto", id);
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/productos");
  if (producto?.id_marca) revalidatePath(`/marcas/${producto.id_marca}`);
}
