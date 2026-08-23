"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import type { SupabaseClient } from "@supabase/supabase-js";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

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

// Compara nombres ignorando mayúsculas/minúsculas, tildes y espacios de
// sobra (mismo criterio que prefijoDesdeNombre, más abajo, para el SKU).
function normalizarNombre(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Si se escribió el nombre de una subcategoría nueva, reutiliza la que ya
// exista con ese nombre para la marca en vez de crear una duplicada (la
// comparación ignora may/min y tildes: "Proteínas" y "Proteinas" son la
// misma subcategoría). Si no existe, recién ahí la crea. Si no se escribió
// nada, usa la que ya estaba seleccionada (puede ser null).
async function resolveSubcategoria(supabase: SupabaseClient, formData: FormData, idMarca: string) {
  const nueva = text(formData, "nueva_subcategoria");
  if (!nueva) return text(formData, "id_subcategoria");

  const { data: existentes, error: errorBusqueda } = await supabase
    .from("subcategorias")
    .select("id_subcategoria, nombre")
    .eq("id_marca", idMarca);
  if (errorBusqueda) throw new Error(errorBusqueda.message);
  const nuevaNormalizada = normalizarNombre(nueva);
  const existente = (existentes ?? []).find((s) => normalizarNombre(s.nombre) === nuevaNormalizada);
  if (existente) return existente.id_subcategoria as string;

  const { data, error } = await supabase
    .from("subcategorias")
    .insert({ id_marca: idMarca, nombre: nueva, estado: "ACTIVA" })
    .select("id_subcategoria")
    .single();
  if (error) throw new Error(error.message);
  return data.id_subcategoria as string;
}

// El producto es la "familia" (nombre, ficha, objetivos, filtros). El SKU,
// código de barras y stock viven en sus variantes (ver sincronizarVariantes).
function productoFromForm(formData: FormData, idMarca: string, idSubcategoria: string | null) {
  return {
    id_marca: idMarca,
    id_subcategoria: idSubcategoria,
    nombre: text(formData, "nombre"),
    descripcion: text(formData, "descripcion"),
    costo_informado: number(formData, "costo_informado"),
    precio_venta: number(formData, "precio_venta"),
    descuento_porcentaje: number(formData, "descuento_porcentaje"),
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

async function generarSkuVariante(supabase: SupabaseClient, idMarca: string) {
  const { data: marca } = await supabase
    .from("marcas")
    .select("nombre")
    .eq("id_marca", idMarca)
    .maybeSingle();
  const prefijo = prefijoDesdeNombre(marca?.nombre ?? "PRD");

  const { data: productosDeLaMarca } = await supabase
    .from("productos")
    .select("id_producto")
    .eq("id_marca", idMarca);
  const idsProductos = (productosDeLaMarca ?? []).map((p: { id_producto: string }) => p.id_producto);

  let mayor = 0;
  if (idsProductos.length > 0) {
    const { data: existentes } = await supabase
      .from("variantes_producto")
      .select("sku")
      .in("id_producto", idsProductos)
      .like("sku", `${prefijo}-%`);
    (existentes ?? []).forEach((row: { sku: string | null }) => {
      const m = row.sku?.match(new RegExp(`^${prefijo}-(\\d+)$`));
      if (m) mayor = Math.max(mayor, parseInt(m[1], 10));
    });
  }

  return `${prefijo}-${String(mayor + 1).padStart(4, "0")}`;
}

// Código interno de 11 dígitos empezando en "20...", el rango que el
// estándar EAN reserva para uso interno/en tienda (no es un código
// registrado globalmente, pero sirve igual para escanear en Self Checkout).
async function generarCodigoBarrasVariante(supabase: SupabaseClient) {
  const BASE = 20000000000;
  const { data: existentes } = await supabase.from("variantes_producto").select("codigo_barras");

  let mayor = BASE;
  (existentes ?? []).forEach((row: { codigo_barras: string | null }) => {
    const n = Number(row.codigo_barras);
    if (Number.isFinite(n) && n > mayor) mayor = n;
  });

  return String(mayor + 1);
}

// Carga el stock físico inicial de una variante recién creada, con su
// movimiento de auditoría — mismo patrón que ajustarStock en
// app/(app)/stock/actions.ts, pero sin pasar por esa función porque acá
// ya sabemos que la cantidad previa es 0 (variante nueva).
async function cargarStockInicial(
  supabase: SupabaseClient,
  idVariante: string,
  idLocal: string,
  cantidad: number,
  usuario: string | null
) {
  if (cantidad <= 0) return;
  const { error: errorStock } = await supabase
    .from("stock")
    .upsert(
      { id_variante: idVariante, id_local: idLocal, cantidad, fecha_actualizacion: new Date().toISOString() },
      { onConflict: "id_variante,id_local" }
    );
  if (errorStock) throw new Error(friendlyDbError(errorStock));

  const { error: errorMov } = await supabase.from("movimientos_stock").insert({
    id_variante: idVariante,
    id_local: idLocal,
    tipo: "CARGA_INICIAL",
    cantidad,
    motivo: "Carga inicial al crear el producto",
    usuario,
  });
  if (errorMov) throw new Error(friendlyDbError(errorMov));
}

// Sincroniza las variantes del producto con lo que llegó del formulario:
// renombra las que ya existían, crea las nuevas (con SKU/código
// automáticos) y borra las que se sacaron de la lista. Si no queda
// ninguna, crea una por defecto llamada "Único" — todo producto necesita
// al menos una variante para tener stock. `idLocalInicial` solo se pasa
// al crear un producto nuevo — al editar nunca se toca el stock acá,
// eso se maneja desde /stock.
async function sincronizarVariantes(
  supabase: SupabaseClient,
  idProducto: string,
  idMarca: string,
  formData: FormData,
  idLocalInicial: string | null,
  usuario: string | null
) {
  const ids = formData.getAll("variante_id").map(String);
  const nombres = formData.getAll("variante_nombre").map(String);
  const stocksMinimos = formData.getAll("variante_stock_minimo").map(Number);
  const stocksObjetivo = formData.getAll("variante_stock_objetivo").map(Number);
  const stocksIniciales = formData.getAll("variante_stock_inicial").map(Number);

  const { data: existentes } = await supabase
    .from("variantes_producto")
    .select("id_variante")
    .eq("id_producto", idProducto);
  const idsExistentes = new Set((existentes ?? []).map((v: { id_variante: string }) => v.id_variante));
  const idsEnviados = new Set(ids.filter(Boolean));

  for (const idExistente of idsExistentes) {
    if (!idsEnviados.has(idExistente)) {
      const { error } = await supabase.from("variantes_producto").delete().eq("id_variante", idExistente);
      if (error) throw new Error(friendlyDbError(error));
    }
  }

  for (let i = 0; i < nombres.length; i++) {
    const nombre = nombres[i].trim();
    if (!nombre) continue;
    const id = ids[i];
    const stockMinimo = Number.isFinite(stocksMinimos[i]) ? stocksMinimos[i] : 0;
    const stockObjetivo = Number.isFinite(stocksObjetivo[i]) ? stocksObjetivo[i] : 0;

    if (id) {
      const { error } = await supabase
        .from("variantes_producto")
        .update({ nombre, stock_minimo: stockMinimo, stock_objetivo: stockObjetivo })
        .eq("id_variante", id);
      if (error) throw new Error(friendlyDbError(error));
    } else {
      const sku = await generarSkuVariante(supabase, idMarca);
      const codigoBarras = await generarCodigoBarrasVariante(supabase);
      const { data: nueva, error } = await supabase
        .from("variantes_producto")
        .insert({
          id_producto: idProducto,
          nombre,
          sku,
          codigo_barras: codigoBarras,
          stock_minimo: stockMinimo,
          stock_objetivo: stockObjetivo,
        })
        .select("id_variante")
        .single();
      if (error) throw new Error(friendlyDbError(error));

      const stockInicial = Number.isFinite(stocksIniciales[i]) ? stocksIniciales[i] : 0;
      if (idLocalInicial && stockInicial > 0) {
        await cargarStockInicial(supabase, nueva.id_variante, idLocalInicial, stockInicial, usuario);
      }
    }
  }

  const { count } = await supabase
    .from("variantes_producto")
    .select("id_variante", { count: "exact", head: true })
    .eq("id_producto", idProducto);

  if (!count) {
    const sku = await generarSkuVariante(supabase, idMarca);
    const codigoBarras = await generarCodigoBarrasVariante(supabase);
    const { data: unica, error } = await supabase
      .from("variantes_producto")
      .insert({ id_producto: idProducto, nombre: "Único", sku, codigo_barras: codigoBarras })
      .select("id_variante")
      .single();
    if (error) throw new Error(friendlyDbError(error));

    const stockInicial = Number.isFinite(stocksIniciales[0]) ? stocksIniciales[0] : 0;
    if (idLocalInicial && stockInicial > 0) {
      await cargarStockInicial(supabase, unica.id_variante, idLocalInicial, stockInicial, usuario);
    }
  }
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

// Next.js redacta en producción el mensaje de un throw new Error() en una
// Server Action (queda solo un digest genérico) — por eso estas funciones
// devuelven { error } como dato. Los helpers de arriba (resolveSubcategoria,
// sincronizarVariantes, etc.) siguen usando throw — como se llaman desde
// acá adentro, el try/catch de estas funciones los atrapa igual.
export async function createProducto(formData: FormData): Promise<{ error: string | null }> {
  try {
    const idMarca = text(formData, "id_marca");
    if (!idMarca) return { error: "Elegí una marca" };
    if (!text(formData, "nombre")) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const idSubcategoria = await resolveSubcategoria(supabase, formData, idMarca);
    const data = productoFromForm(formData, idMarca, idSubcategoria);

    const { data: inserted, error } = await supabase
      .from("productos")
      .insert(data)
      .select("id_producto")
      .single();
    if (error) return { error: friendlyDbError(error) };

    const idLocalInicial = text(formData, "id_local_inicial");
    const usuario = await usuarioActual();
    await sincronizarVariantes(supabase, inserted.id_producto, idMarca, formData, idLocalInicial, usuario);
    await guardarContenidoAsesor(supabase, inserted.id_producto, formData);

    revalidatePath("/productos");
    revalidatePath("/stock");
    revalidatePath(`/marcas/${idMarca}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el producto" };
  }
}

export async function updateProducto(id: string, formData: FormData): Promise<{ error: string | null }> {
  try {
    const idMarca = text(formData, "id_marca");
    if (!idMarca) return { error: "Elegí una marca" };
    if (!text(formData, "nombre")) return { error: "El nombre es obligatorio" };

    const supabase = getSupabaseServerClient();
    const idSubcategoria = await resolveSubcategoria(supabase, formData, idMarca);
    const data = productoFromForm(formData, idMarca, idSubcategoria);

    const { error } = await supabase.from("productos").update(data).eq("id_producto", id);
    if (error) return { error: friendlyDbError(error) };

    // Al editar nunca se toca el stock desde acá (idLocalInicial null) — eso
    // se maneja desde /stock, para no pisar cantidades reales sin querer.
    await sincronizarVariantes(supabase, id, idMarca, formData, null, null);
    await guardarContenidoAsesor(supabase, id, formData);

    revalidatePath("/productos");
    revalidatePath(`/marcas/${idMarca}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar el producto" };
  }
}

export async function subirFotoProducto(
  idProducto: string,
  formData: FormData
): Promise<{ error: string | null; url?: string }> {
  const archivo = formData.get("archivo") as File | null;
  if (!archivo || archivo.size === 0) return { error: "Elegí una foto primero" };

  try {
    const supabase = getSupabaseServerClient();
    const extension = archivo.name.split(".").pop() ?? "jpg";
    const path = `${idProducto}-${Date.now()}.${extension}`;

    const { error: errorUpload } = await supabase.storage
      .from("fotos-productos")
      .upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
    if (errorUpload) return { error: errorUpload.message };

    const { data } = supabase.storage.from("fotos-productos").getPublicUrl(path);

    const { error: errorUpdate } = await supabase
      .from("productos")
      .update({ imagen: data.publicUrl })
      .eq("id_producto", idProducto);
    if (errorUpdate) return { error: friendlyDbError(errorUpdate) };

    revalidatePath("/productos");
    return { error: null, url: data.publicUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo subir la foto" };
  }
}

export async function deleteProducto(id: string): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const { data: producto } = await supabase
      .from("productos")
      .select("id_marca")
      .eq("id_producto", id)
      .maybeSingle();

    const { error } = await supabase.from("productos").delete().eq("id_producto", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/productos");
    if (producto?.id_marca) revalidatePath(`/marcas/${producto.id_marca}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo eliminar el producto" };
  }
}
