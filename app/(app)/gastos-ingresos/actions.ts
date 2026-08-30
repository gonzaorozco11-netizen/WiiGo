"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { registrarMovimientoComercial, anularMovimientoComercial, type TipoCargoComercial } from "@/lib/cuentaComercialMarca";
import type { SupabaseClient } from "@supabase/supabase-js";

async function sesionActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return readSessionToken(token, process.env.AUTH_SECRET ?? "");
}

// Mismo criterio de permiso que Situación de marca: cualquiera puede ver
// esta pantalla, pero registrar un movimiento real requiere que el Área del
// usuario incluya "gastos-ingresos" (u ser Dueño).
async function requireAdmin() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "gastos-ingresos")) {
    return "No tenés permiso para hacer esto.";
  }
  return null;
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

function normalizarNombre(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function periodoDe(recurrencia: string) {
  const ahora = new Date();
  return recurrencia === "ANUAL" ? String(ahora.getFullYear()) : ahora.toISOString().slice(0, 7);
}

function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

// Mismo parámetro que ya usan Liquidaciones y Rentabilidad — no se define
// un % de IVA aparte acá.
async function ivaGeneralPorcentaje(supabase: SupabaseClient) {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", "IVA_GENERAL_PORCENTAJE").maybeSingle();
  return Number(data?.valor ?? 21);
}

// ===================== CATEGORÍAS (cargo a marca) =====================

async function resolveCategoriaCargoMarca(supabase: SupabaseClient, formData: FormData) {
  const nueva = text(formData, "nueva_categoria");
  if (!nueva) return text(formData, "id_categoria");

  const { data: existentes, error: errorBusqueda } = await supabase.from("categorias_cargo_marca").select("id_categoria, nombre");
  if (errorBusqueda) throw new Error(friendlyDbError(errorBusqueda));
  const normalizada = normalizarNombre(nueva);
  const existente = (existentes ?? []).find((c) => normalizarNombre(c.nombre) === normalizada);
  if (existente) return existente.id_categoria as string;

  const { data, error } = await supabase.from("categorias_cargo_marca").insert({ nombre: nueva, estado: "ACTIVA" }).select("id_categoria").single();
  if (error) throw new Error(friendlyDbError(error));
  return data.id_categoria as string;
}

async function resolveSubcategoriaCargoMarca(supabase: SupabaseClient, formData: FormData, idCategoria: string) {
  const nueva = text(formData, "nueva_subcategoria");
  if (!nueva) return text(formData, "id_subcategoria");

  const { data: existentes, error: errorBusqueda } = await supabase
    .from("subcategorias_cargo_marca")
    .select("id_subcategoria, nombre")
    .eq("id_categoria", idCategoria);
  if (errorBusqueda) throw new Error(friendlyDbError(errorBusqueda));
  const normalizada = normalizarNombre(nueva);
  const existente = (existentes ?? []).find((s) => normalizarNombre(s.nombre) === normalizada);
  if (existente) return existente.id_subcategoria as string;

  const { data, error } = await supabase
    .from("subcategorias_cargo_marca")
    .insert({ id_categoria: idCategoria, nombre: nueva, estado: "ACTIVA" })
    .select("id_subcategoria")
    .single();
  if (error) throw new Error(friendlyDbError(error));
  return data.id_subcategoria as string;
}

export async function listarCategoriasCargoMarca() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("categorias_cargo_marca").select("*").eq("estado", "ACTIVA").order("nombre");
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function listarSubcategoriasCargoMarca() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("subcategorias_cargo_marca").select("*").eq("estado", "ACTIVA").order("nombre");
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function crearCategoriaCargoMarca(nombre: string): Promise<{ error: string | null }> {
  if (!nombre.trim()) return { error: "Poné un nombre para la categoría" };
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("categorias_cargo_marca").insert({ nombre: nombre.trim(), estado: "ACTIVA" });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la categoría" };
  }
}

export async function renombrarCategoriaCargoMarca(idCategoria: string, nombre: string): Promise<{ error: string | null }> {
  if (!nombre.trim()) return { error: "Poné un nombre para la categoría" };
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("categorias_cargo_marca").update({ nombre: nombre.trim() }).eq("id_categoria", idCategoria);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar la categoría" };
  }
}

// Baja lógica — los cargos ya cargados con esta categoría siguen intactos,
// solo deja de aparecer para elegirla en cargos nuevos.
export async function desactivarCategoriaCargoMarca(idCategoria: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("categorias_cargo_marca").update({ estado: "INACTIVA" }).eq("id_categoria", idCategoria);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo desactivar la categoría" };
  }
}

export async function crearSubcategoriaCargoMarca(idCategoria: string, nombre: string): Promise<{ error: string | null }> {
  if (!nombre.trim()) return { error: "Poné un nombre para la subcategoría" };
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("subcategorias_cargo_marca").insert({ id_categoria: idCategoria, nombre: nombre.trim(), estado: "ACTIVA" });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la subcategoría" };
  }
}

export async function renombrarSubcategoriaCargoMarca(idSubcategoria: string, nombre: string): Promise<{ error: string | null }> {
  if (!nombre.trim()) return { error: "Poné un nombre para la subcategoría" };
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("subcategorias_cargo_marca").update({ nombre: nombre.trim() }).eq("id_subcategoria", idSubcategoria);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo renombrar la subcategoría" };
  }
}

export async function desactivarSubcategoriaCargoMarca(idSubcategoria: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("subcategorias_cargo_marca").update({ estado: "INACTIVA" }).eq("id_subcategoria", idSubcategoria);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo desactivar la subcategoría" };
  }
}

// Cuántos cargos activos tiene cada categoría/subcategoría — mismo criterio
// que contarGastosPorCategoria, para avisar antes de desactivar una que ya
// tiene historial.
export async function contarCargosPorCategoria(): Promise<{ porCategoria: Record<string, number>; porSubcategoria: Record<string, number> }> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("id_categoria, id_subcategoria")
    .in("tipo_cargo", ["GASTO_FIJO_MENSUAL", "CARGO_RECURRENTE", "OTRO_CARGO"])
    .eq("anulado", false);
  if (error) throw new Error(friendlyDbError(error));
  const porCategoria: Record<string, number> = {};
  const porSubcategoria: Record<string, number> = {};
  for (const m of data ?? []) {
    if (m.id_categoria) {
      const idCategoria = m.id_categoria as string;
      porCategoria[idCategoria] = (porCategoria[idCategoria] ?? 0) + 1;
    }
    if (m.id_subcategoria) {
      const idSubcategoria = m.id_subcategoria as string;
      porSubcategoria[idSubcategoria] = (porSubcategoria[idSubcategoria] ?? 0) + 1;
    }
  }
  return { porCategoria, porSubcategoria };
}

// ===================== CATEGORÍAS (otro ingreso) =====================

async function resolveCategoriaIngreso(supabase: SupabaseClient, formData: FormData) {
  const nueva = text(formData, "nueva_categoria");
  if (!nueva) return text(formData, "id_categoria");

  const { data: existentes, error: errorBusqueda } = await supabase.from("categorias_ingreso").select("id_categoria, nombre");
  if (errorBusqueda) throw new Error(friendlyDbError(errorBusqueda));
  const normalizada = normalizarNombre(nueva);
  const existente = (existentes ?? []).find((c) => normalizarNombre(c.nombre) === normalizada);
  if (existente) return existente.id_categoria as string;

  const { data, error } = await supabase.from("categorias_ingreso").insert({ nombre: nueva, estado: "ACTIVA" }).select("id_categoria").single();
  if (error) throw new Error(friendlyDbError(error));
  return data.id_categoria as string;
}

async function resolveSubcategoriaIngreso(supabase: SupabaseClient, formData: FormData, idCategoria: string) {
  const nueva = text(formData, "nueva_subcategoria");
  if (!nueva) return text(formData, "id_subcategoria");

  const { data: existentes, error: errorBusqueda } = await supabase
    .from("subcategorias_ingreso")
    .select("id_subcategoria, nombre")
    .eq("id_categoria", idCategoria);
  if (errorBusqueda) throw new Error(friendlyDbError(errorBusqueda));
  const normalizada = normalizarNombre(nueva);
  const existente = (existentes ?? []).find((s) => normalizarNombre(s.nombre) === normalizada);
  if (existente) return existente.id_subcategoria as string;

  const { data, error } = await supabase
    .from("subcategorias_ingreso")
    .insert({ id_categoria: idCategoria, nombre: nueva, estado: "ACTIVA" })
    .select("id_subcategoria")
    .single();
  if (error) throw new Error(friendlyDbError(error));
  return data.id_subcategoria as string;
}

export async function listarCategoriasIngreso() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("categorias_ingreso").select("*").eq("estado", "ACTIVA").order("nombre");
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function listarSubcategoriasIngreso() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("subcategorias_ingreso").select("*").eq("estado", "ACTIVA").order("nombre");
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function crearCategoriaIngreso(nombre: string): Promise<{ error: string | null }> {
  if (!nombre.trim()) return { error: "Poné un nombre para la categoría" };
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("categorias_ingreso").insert({ nombre: nombre.trim(), estado: "ACTIVA" });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la categoría" };
  }
}

export async function renombrarCategoriaIngreso(idCategoria: string, nombre: string): Promise<{ error: string | null }> {
  if (!nombre.trim()) return { error: "Poné un nombre para la categoría" };
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("categorias_ingreso").update({ nombre: nombre.trim() }).eq("id_categoria", idCategoria);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar la categoría" };
  }
}

export async function desactivarCategoriaIngreso(idCategoria: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("categorias_ingreso").update({ estado: "INACTIVA" }).eq("id_categoria", idCategoria);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo desactivar la categoría" };
  }
}

export async function crearSubcategoriaIngreso(idCategoria: string, nombre: string): Promise<{ error: string | null }> {
  if (!nombre.trim()) return { error: "Poné un nombre para la subcategoría" };
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("subcategorias_ingreso").insert({ id_categoria: idCategoria, nombre: nombre.trim(), estado: "ACTIVA" });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la subcategoría" };
  }
}

export async function renombrarSubcategoriaIngreso(idSubcategoria: string, nombre: string): Promise<{ error: string | null }> {
  if (!nombre.trim()) return { error: "Poné un nombre para la subcategoría" };
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("subcategorias_ingreso").update({ nombre: nombre.trim() }).eq("id_subcategoria", idSubcategoria);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo renombrar la subcategoría" };
  }
}

export async function desactivarSubcategoriaIngreso(idSubcategoria: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("subcategorias_ingreso").update({ estado: "INACTIVA" }).eq("id_subcategoria", idSubcategoria);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo desactivar la subcategoría" };
  }
}

export async function contarIngresosPorCategoria(): Promise<{ porCategoria: Record<string, number>; porSubcategoria: Record<string, number> }> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("ingresos").select("id_categoria, id_subcategoria").eq("anulado", false);
  if (error) throw new Error(friendlyDbError(error));
  const porCategoria: Record<string, number> = {};
  const porSubcategoria: Record<string, number> = {};
  for (const i of data ?? []) {
    if (i.id_categoria) {
      const idCategoria = i.id_categoria as string;
      porCategoria[idCategoria] = (porCategoria[idCategoria] ?? 0) + 1;
    }
    if (i.id_subcategoria) {
      const idSubcategoria = i.id_subcategoria as string;
      porSubcategoria[idSubcategoria] = (porSubcategoria[idSubcategoria] ?? 0) + 1;
    }
  }
  return { porCategoria, porSubcategoria };
}

// ===================== CARGO A MARCA — único =====================

// Nace la deuda en la cuenta comercial de la marca — no mueve plata de
// WiiGo, eso pasa después y por separado, cuando la marca paga (ver
// registrarPagoComercial en situacion-marca/actions.ts, que sigue igual).
export async function registrarCargoMarcaUnico(idMarca: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  // El monto que se carga acá siempre es el neto — el IVA se suma aparte,
  // solo si se tildó "lleva IVA".
  const neto = number(formData, "monto");
  if (!neto || neto <= 0) return { error: "El monto tiene que ser mayor a 0" };

  try {
    const supabase = getSupabaseServerClient();
    const idCategoria = await resolveCategoriaCargoMarca(supabase, formData);
    if (!idCategoria) return { error: "Elegí o creá una categoría" };
    const idSubcategoria = await resolveSubcategoriaCargoMarca(supabase, formData, idCategoria);
    const llevaIva = formData.get("lleva_iva") === "on";
    const iva = llevaIva ? redondear2(neto * ((await ivaGeneralPorcentaje(supabase)) / 100)) : 0;
    const importe = redondear2(neto + iva);

    const sesion = await sesionActual();
    await registrarMovimientoComercial(supabase, {
      idMarca,
      tipoCargo: "OTRO_CARGO",
      importe,
      neto,
      iva,
      idCategoria,
      idSubcategoria,
      usuario: sesion?.nombre ?? null,
      observaciones: text(formData, "descripcion") ?? "Cargo manual",
      fecha: text(formData, "fecha_override"),
    });

    revalidatePath("/gastos-ingresos");
    revalidatePath("/situacion-marca");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar el cargo" };
  }
}

// ===================== CARGO A MARCA — recurrente =====================

export async function listarCargosRecurrentesMarca() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("cargos_recurrentes_marca").select("*").eq("activo", true).order("dia_mes");
  if (error) throw new Error(friendlyDbError(error));
  const recurrentes = data ?? [];

  const idsMarca = [...new Set(recurrentes.map((r) => r.id_marca as string))];
  const { data: marcas } = await supabase.from("marcas").select("id_marca, nombre").in("id_marca", idsMarca.length > 0 ? idsMarca : ["00000000-0000-0000-0000-000000000000"]);
  const nombrePorMarca = new Map((marcas ?? []).map((m) => [m.id_marca as string, m.nombre as string]));

  return recurrentes.map((r) => ({ ...r, nombreMarca: nombrePorMarca.get(r.id_marca as string) ?? "—" }));
}

export async function crearCargoRecurrenteMarca(idMarca: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  try {
    const supabase = getSupabaseServerClient();
    const idCategoria = await resolveCategoriaCargoMarca(supabase, formData);
    if (!idCategoria) return { error: "Elegí o creá una categoría" };
    const idSubcategoria = await resolveSubcategoriaCargoMarca(supabase, formData, idCategoria);
    const descripcion = text(formData, "descripcion");
    if (!descripcion) return { error: "La descripción es obligatoria" };
    const montoEstimado = number(formData, "monto_estimado") ?? 0;
    const recurrencia = text(formData, "recurrencia") === "ANUAL" ? "ANUAL" : "MENSUAL";
    const diaMes = Number(formData.get("dia_mes") ?? 1);
    const mesAnual = recurrencia === "ANUAL" ? Number(formData.get("mes_anual") ?? 1) : null;
    const llevaIva = formData.get("lleva_iva") === "on";

    const { error } = await supabase.from("cargos_recurrentes_marca").insert({
      id_marca: idMarca,
      id_categoria: idCategoria,
      id_subcategoria: idSubcategoria,
      descripcion,
      monto_estimado: montoEstimado,
      recurrencia,
      dia_mes: diaMes,
      mes_anual: mesAnual,
      lleva_iva: llevaIva,
      activo: true,
    });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el cargo recurrente" };
  }
}

export async function cargarCargoRecurrenteMarca(
  idRecurrente: string,
  montoConfirmadoNeto: number,
  llevaIva: boolean
): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  if (!montoConfirmadoNeto || montoConfirmadoNeto <= 0) return { error: "El monto tiene que ser mayor a 0" };

  try {
    const supabase = getSupabaseServerClient();
    const { data: recurrente, error: errorRec } = await supabase
      .from("cargos_recurrentes_marca")
      .select("*")
      .eq("id_recurrente", idRecurrente)
      .maybeSingle();
    if (errorRec) return { error: friendlyDbError(errorRec) };
    if (!recurrente) return { error: "No se encontró el cargo recurrente" };

    const periodo = periodoDe(recurrente.recurrencia);
    if (recurrente.ultimo_periodo_cargado === periodo) {
      return { error: `Ya se generó el cargo de ${periodo} para esta marca.` };
    }

    const iva = llevaIva ? redondear2(montoConfirmadoNeto * ((await ivaGeneralPorcentaje(supabase)) / 100)) : 0;
    const importe = redondear2(montoConfirmadoNeto + iva);

    const sesion = await sesionActual();
    await registrarMovimientoComercial(supabase, {
      idMarca: recurrente.id_marca,
      tipoCargo: "CARGO_RECURRENTE" as TipoCargoComercial,
      importe,
      neto: montoConfirmadoNeto,
      iva,
      periodo,
      idCategoria: recurrente.id_categoria,
      idSubcategoria: recurrente.id_subcategoria,
      usuario: sesion?.nombre ?? null,
      observaciones: recurrente.descripcion,
    });

    await supabase.from("cargos_recurrentes_marca").update({ ultimo_periodo_cargado: periodo }).eq("id_recurrente", idRecurrente);
    revalidatePath("/gastos-ingresos");
    revalidatePath("/situacion-marca");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cargar el cargo recurrente" };
  }
}

// Marcas con saldo a favor de WiiGo en su cuenta comercial — lo que
// registrarCargoMarcaUnico/cargarCargoRecurrenteMarca ya imputó pero la
// marca todavía no pagó (ver registrarPagoComercial en situacion-marca,
// que sigue igual, para saldarlo).
export async function listarMarcasConSaldoPendiente() {
  const supabase = getSupabaseServerClient();
  const { data: movimientos, error } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("id_marca, importe")
    .eq("anulado", false);
  if (error) throw new Error(friendlyDbError(error));

  const saldoPorMarca = new Map<string, number>();
  for (const m of movimientos ?? []) {
    const id = m.id_marca as string;
    saldoPorMarca.set(id, (saldoPorMarca.get(id) ?? 0) + (m.importe ?? 0));
  }
  const idsConSaldo = [...saldoPorMarca.entries()].filter(([, saldo]) => saldo > 0).map(([id]) => id);
  if (idsConSaldo.length === 0) return [];

  const { data: marcas } = await supabase.from("marcas").select("id_marca, nombre").in("id_marca", idsConSaldo);
  return (marcas ?? [])
    .map((m) => ({ idMarca: m.id_marca as string, nombre: m.nombre as string, saldo: saldoPorMarca.get(m.id_marca as string) ?? 0 }))
    .sort((a, b) => b.saldo - a.saldo);
}

// ===================== OTRO INGRESO — único =====================

// A diferencia del cargo a marca, acá se asume que la plata ya entró —
// por eso pide medio de pago, igual que un Gasto.
export async function crearIngreso(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  // El monto que se carga acá siempre es el neto — el IVA se suma aparte,
  // solo si se tildó "lleva IVA".
  const neto = number(formData, "monto");
  if (!neto || neto <= 0) return { error: "El monto tiene que ser mayor a 0" };

  try {
    const supabase = getSupabaseServerClient();
    const idCategoria = await resolveCategoriaIngreso(supabase, formData);
    if (!idCategoria) return { error: "Elegí o creá una categoría" };
    const idSubcategoria = await resolveSubcategoriaIngreso(supabase, formData, idCategoria);
    const medioPago = text(formData, "medio_pago") ?? "TRANSFERENCIA";
    const descripcion = text(formData, "descripcion");
    const idLocal = text(formData, "id_local");
    const llevaIva = formData.get("lleva_iva") === "on";
    const iva = llevaIva ? redondear2(neto * ((await ivaGeneralPorcentaje(supabase)) / 100)) : 0;
    const monto = redondear2(neto + iva);
    const sesion = await sesionActual();
    const fechaOverride = text(formData, "fecha_override");

    const { error } = await supabase.from("ingresos").insert({
      id_local: idLocal,
      id_categoria: idCategoria,
      id_subcategoria: idSubcategoria,
      medio_pago: medioPago,
      monto,
      neto,
      iva,
      descripcion,
      usuario: sesion?.nombre ?? null,
      ...(fechaOverride ? { fecha: fechaOverride } : {}),
    });
    if (error) return { error: friendlyDbError(error) };

    if (medioPago === "EFECTIVO_ADMIN") {
      await supabase.from("movimientos_caja_admin").insert({
        tipo: "INGRESO_OTRO",
        monto,
        id_gasto: null,
        descripcion: descripcion ?? "Otro ingreso",
        usuario: sesion?.nombre ?? null,
      });
    }

    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar el ingreso" };
  }
}

export async function listarIngresos(desde: string, hasta: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("ingresos")
    .select("*")
    .eq("anulado", false)
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`)
    .order("fecha", { ascending: false });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

// Anula un ingreso ya cargado (no se borra de la base) — deja de sumar en
// Últimos movimientos, IVA a pagar y el Tablero de Resultados.
export async function anularIngreso(idIngreso: string, motivo: string): Promise<{ error: string | null }> {
  if (!motivo.trim()) return { error: "Contá brevemente por qué lo anulás." };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("ingresos")
    .update({ anulado: true, motivo_anulacion: motivo.trim(), anulado_en: new Date().toISOString() })
    .eq("id_ingreso", idIngreso);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/gastos-ingresos");
  revalidatePath("/resultado-mes");
  return { error: null };
}

// Anula un cargo/pago a marca ya cargado — deja de sumar en el saldo de la
// cuenta comercial, Últimos movimientos, IVA a pagar y el Tablero.
export async function anularCargoMarca(idMovimiento: string, motivo: string): Promise<{ error: string | null }> {
  const supabase = getSupabaseServerClient();
  const res = await anularMovimientoComercial(supabase, idMovimiento, motivo);
  if (res.error) return res;
  revalidatePath("/gastos-ingresos");
  revalidatePath("/situacion-marca");
  revalidatePath("/resultado-mes");
  return { error: null };
}

// ===================== OTRO INGRESO — recurrente =====================

export async function listarIngresosRecurrentes() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("ingresos_recurrentes").select("*").eq("activo", true).order("dia_mes");
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function crearIngresoRecurrente(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  try {
    const supabase = getSupabaseServerClient();
    const idCategoria = await resolveCategoriaIngreso(supabase, formData);
    if (!idCategoria) return { error: "Elegí o creá una categoría" };
    const idSubcategoria = await resolveSubcategoriaIngreso(supabase, formData, idCategoria);
    const descripcion = text(formData, "descripcion");
    if (!descripcion) return { error: "La descripción es obligatoria" };
    const montoEstimado = number(formData, "monto_estimado") ?? 0;
    const recurrencia = text(formData, "recurrencia") === "ANUAL" ? "ANUAL" : "MENSUAL";
    const diaMes = Number(formData.get("dia_mes") ?? 1);
    const mesAnual = recurrencia === "ANUAL" ? Number(formData.get("mes_anual") ?? 1) : null;
    const llevaIva = formData.get("lleva_iva") === "on";

    const { error } = await supabase.from("ingresos_recurrentes").insert({
      id_categoria: idCategoria,
      id_subcategoria: idSubcategoria,
      descripcion,
      monto_estimado: montoEstimado,
      recurrencia,
      dia_mes: diaMes,
      mes_anual: mesAnual,
      lleva_iva: llevaIva,
      activo: true,
    });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el ingreso recurrente" };
  }
}

export async function cargarIngresoRecurrente(
  idRecurrente: string,
  montoConfirmadoNeto: number,
  medioPago: string,
  llevaIva: boolean
): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  if (!montoConfirmadoNeto || montoConfirmadoNeto <= 0) return { error: "El monto tiene que ser mayor a 0" };

  try {
    const supabase = getSupabaseServerClient();
    const { data: recurrente, error: errorRec } = await supabase
      .from("ingresos_recurrentes")
      .select("*")
      .eq("id_recurrente", idRecurrente)
      .maybeSingle();
    if (errorRec) return { error: friendlyDbError(errorRec) };
    if (!recurrente) return { error: "No se encontró el ingreso recurrente" };

    const periodo = periodoDe(recurrente.recurrencia);
    if (recurrente.ultimo_periodo_cargado === periodo) {
      return { error: `Ya se cargó el ingreso de ${periodo}.` };
    }

    const iva = llevaIva ? redondear2(montoConfirmadoNeto * ((await ivaGeneralPorcentaje(supabase)) / 100)) : 0;
    const monto = redondear2(montoConfirmadoNeto + iva);

    const sesion = await sesionActual();
    const { error } = await supabase.from("ingresos").insert({
      id_categoria: recurrente.id_categoria,
      id_subcategoria: recurrente.id_subcategoria,
      medio_pago: medioPago,
      monto,
      neto: montoConfirmadoNeto,
      iva,
      descripcion: recurrente.descripcion,
      usuario: sesion?.nombre ?? null,
    });
    if (error) return { error: friendlyDbError(error) };

    if (medioPago === "EFECTIVO_ADMIN") {
      await supabase.from("movimientos_caja_admin").insert({
        tipo: "INGRESO_OTRO",
        monto,
        id_gasto: null,
        descripcion: recurrente.descripcion,
        usuario: sesion?.nombre ?? null,
      });
    }

    await supabase.from("ingresos_recurrentes").update({ ultimo_periodo_cargado: periodo }).eq("id_recurrente", idRecurrente);
    revalidatePath("/gastos-ingresos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cargar el ingreso" };
  }
}

// ===================== ÚLTIMOS MOVIMIENTOS (vista combinada) =====================

export type MovimientoUnificado = {
  id: string;
  tipo: "GASTO" | "CARGO_MARCA" | "INGRESO";
  fecha: string;
  concepto: string;
  categoria: string;
  monto: number;
  recurrente: boolean;
};

const LIMITE_MOVIMIENTOS = 15;

export async function listarUltimosMovimientos(): Promise<MovimientoUnificado[]> {
  const supabase = getSupabaseServerClient();

  const [gastosRes, cargosRes, ingresosRes] = await Promise.all([
    supabase
      .from("gastos")
      .select("id_gasto, fecha, descripcion, monto, id_categoria")
      .eq("anulado", false)
      .order("fecha", { ascending: false })
      .limit(LIMITE_MOVIMIENTOS),
    supabase
      .from("movimientos_cuenta_comercial_marca")
      .select("id_movimiento, fecha, observaciones, importe, neto, iva, tipo_cargo, id_marca, id_categoria")
      .in("tipo_cargo", ["OTRO_CARGO", "CARGO_RECURRENTE", "GASTO_FIJO_MENSUAL"])
      .eq("anulado", false)
      .order("fecha", { ascending: false })
      .limit(LIMITE_MOVIMIENTOS),
    supabase
      .from("ingresos")
      .select("id_ingreso, fecha, descripcion, monto, neto, iva, id_categoria")
      .eq("anulado", false)
      .order("fecha", { ascending: false })
      .limit(LIMITE_MOVIMIENTOS),
  ]);

  const gastosData = gastosRes.data ?? [];
  const cargosData = cargosRes.data ?? [];
  const ingresosData = ingresosRes.data ?? [];

  const [categoriasGastoRes, categoriasCargoRes, categoriasIngresoRes, marcasRes] = await Promise.all([
    supabase.from("categorias_gasto").select("id_categoria, nombre"),
    supabase.from("categorias_cargo_marca").select("id_categoria, nombre"),
    supabase.from("categorias_ingreso").select("id_categoria, nombre"),
    supabase
      .from("marcas")
      .select("id_marca, nombre")
      .in("id_marca", [...new Set(cargosData.map((c) => c.id_marca as string))].length > 0 ? [...new Set(cargosData.map((c) => c.id_marca as string))] : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  const nombreCategoriaGasto = new Map((categoriasGastoRes.data ?? []).map((c) => [c.id_categoria as string, c.nombre as string]));
  const nombreCategoriaCargo = new Map((categoriasCargoRes.data ?? []).map((c) => [c.id_categoria as string, c.nombre as string]));
  const nombreCategoriaIngreso = new Map((categoriasIngresoRes.data ?? []).map((c) => [c.id_categoria as string, c.nombre as string]));
  const nombreMarca = new Map((marcasRes.data ?? []).map((m) => [m.id_marca as string, m.nombre as string]));

  const gastos: MovimientoUnificado[] = gastosData.map((g) => ({
    id: g.id_gasto as string,
    tipo: "GASTO",
    fecha: g.fecha as string,
    concepto: (g.descripcion as string | null) ?? "Gasto",
    categoria: nombreCategoriaGasto.get(g.id_categoria as string) ?? "—",
    monto: -(g.monto as number),
    recurrente: false,
  }));
  const notaIva = (neto: unknown, iva: unknown) =>
    typeof iva === "number" && iva > 0 ? ` (neto $${(neto as number).toLocaleString("es-AR")} + IVA $${iva.toLocaleString("es-AR")})` : "";

  const cargos: MovimientoUnificado[] = cargosData.map((c) => ({
    id: c.id_movimiento as string,
    tipo: "CARGO_MARCA",
    fecha: c.fecha as string,
    concepto: `${nombreMarca.get(c.id_marca as string) ?? "Marca"} — ${(c.observaciones as string | null) ?? "Cargo"}${notaIva(c.neto, c.iva)}`,
    categoria: c.id_categoria ? nombreCategoriaCargo.get(c.id_categoria as string) ?? "—" : "—",
    monto: c.importe as number,
    recurrente: c.tipo_cargo === "CARGO_RECURRENTE" || c.tipo_cargo === "GASTO_FIJO_MENSUAL",
  }));
  const ingresos: MovimientoUnificado[] = ingresosData.map((i) => ({
    id: i.id_ingreso as string,
    tipo: "INGRESO",
    fecha: i.fecha as string,
    concepto: `${(i.descripcion as string | null) ?? "Ingreso"}${notaIva(i.neto, i.iva)}`,
    categoria: nombreCategoriaIngreso.get(i.id_categoria as string) ?? "—",
    monto: i.monto as number,
    recurrente: false,
  }));

  return [...gastos, ...cargos, ...ingresos].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, LIMITE_MOVIMIENTOS);
}
