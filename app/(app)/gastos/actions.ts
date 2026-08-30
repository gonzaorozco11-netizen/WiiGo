"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { verifyPassword } from "@/lib/auth";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { turnoAbiertoDeLocal } from "@/app/(app)/turnos/actions";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Gasto } from "@/lib/supabase";

async function sesionActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return readSessionToken(token, process.env.AUTH_SECRET ?? "");
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

// Mismo criterio que las subcategorías de Productos: si se escribió el
// nombre de una categoría nueva, reutiliza la que ya exista con ese
// nombre (ignorando may/min y tildes) en vez de crear una duplicada.
export async function resolveCategoria(supabase: SupabaseClient, formData: FormData) {
  const nueva = text(formData, "nueva_categoria");
  if (!nueva) return text(formData, "id_categoria");

  const { data: existentes, error: errorBusqueda } = await supabase
    .from("categorias_gasto")
    .select("id_categoria, nombre");
  if (errorBusqueda) throw new Error(friendlyDbError(errorBusqueda));
  const normalizada = normalizarNombre(nueva);
  const existente = (existentes ?? []).find((c) => normalizarNombre(c.nombre) === normalizada);
  if (existente) return existente.id_categoria as string;

  const { data, error } = await supabase
    .from("categorias_gasto")
    .insert({ nombre: nueva, tipo_default: text(formData, "tipo") ?? "VARIABLE", estado: "ACTIVA" })
    .select("id_categoria")
    .single();
  if (error) throw new Error(friendlyDbError(error));
  return data.id_categoria as string;
}

export async function resolveSubcategoria(supabase: SupabaseClient, formData: FormData, idCategoria: string) {
  const nueva = text(formData, "nueva_subcategoria_gasto");
  if (!nueva) return text(formData, "id_subcategoria");

  const { data: existentes, error: errorBusqueda } = await supabase
    .from("subcategorias_gasto")
    .select("id_subcategoria, nombre")
    .eq("id_categoria", idCategoria);
  if (errorBusqueda) throw new Error(friendlyDbError(errorBusqueda));
  const normalizada = normalizarNombre(nueva);
  const existente = (existentes ?? []).find((s) => normalizarNombre(s.nombre) === normalizada);
  if (existente) return existente.id_subcategoria as string;

  const { data, error } = await supabase
    .from("subcategorias_gasto")
    .insert({ id_categoria: idCategoria, nombre: nueva, estado: "ACTIVA" })
    .select("id_subcategoria")
    .single();
  if (error) throw new Error(friendlyDbError(error));
  return data.id_subcategoria as string;
}

// Fijo/Variable se define una sola vez, en la categoría — nunca se le
// vuelve a preguntar a quien carga un gasto, y la subcategoría no tiene tipo
// propio (todas las subcategorías de una categoría comparten su tipo).
async function resolverTipoGasto(supabase: SupabaseClient, idCategoria: string) {
  const { data: cat } = await supabase.from("categorias_gasto").select("tipo_default").eq("id_categoria", idCategoria).maybeSingle();
  return (cat?.tipo_default as "FIJO" | "VARIABLE" | undefined) ?? "VARIABLE";
}

async function topeAutorizacion(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("configuracion")
    .select("valor")
    .eq("parametro", "GASTOS_TOPE_SIN_AUTORIZACION")
    .maybeSingle();
  return Number(data?.valor ?? 10000);
}

function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

// Mismo parámetro que ya usan Liquidaciones, Rentabilidad y Gastos e
// Ingresos — no se define un % de IVA aparte acá.
async function ivaGeneralPorcentaje(supabase: SupabaseClient) {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", "IVA_GENERAL_PORCENTAJE").maybeSingle();
  return Number(data?.valor ?? 21);
}

// Baja lógica, no borrado: pisa el estado en vez de eliminar la fila, así
// los gastos ya cargados con esta categoría/subcategoría siguen intactos y
// se siguen viendo bien en el historial — solo deja de aparecer para
// elegirla de nuevo en gastos futuros.
export async function desactivarCategoria(idCategoria: string): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("categorias_gasto").update({ estado: "INACTIVA" }).eq("id_categoria", idCategoria);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo desactivar la categoría" };
  }
}

export async function desactivarSubcategoria(idSubcategoria: string): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("subcategorias_gasto").update({ estado: "INACTIVA" }).eq("id_subcategoria", idSubcategoria);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo desactivar la subcategoría" };
  }
}

export async function crearCategoriaGasto(nombre: string, tipoDefault: "FIJO" | "VARIABLE"): Promise<{ error: string | null }> {
  if (!nombre.trim()) return { error: "Poné un nombre para la categoría" };
  try {
    const supabase = getSupabaseServerClient();
    // Si la categoría se llama "Impuestos", queda marcada automáticamente
    // como tal — así el Tablero de Resultados sabe excluirla de Gastos
    // fijos/variables (para no contar dos veces un impuesto que también
    // calcula por fórmula) sin que haga falta ningún paso manual.
    const esImpuestos = normalizarNombre(nombre) === "impuestos";
    const { error } = await supabase
      .from("categorias_gasto")
      .insert({ nombre: nombre.trim(), tipo_default: tipoDefault, estado: "ACTIVA", es_impuestos: esImpuestos });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la categoría" };
  }
}

// El tipo acá es solo el valor por defecto sugerido para gastos nuevos —
// no toca los gastos que ya cargaste con esta categoría (cada uno guarda su
// propio Fijo/Variable de forma independiente, para siempre).
export async function renombrarCategoriaGasto(idCategoria: string, nombre: string, tipoDefault: "FIJO" | "VARIABLE"): Promise<{ error: string | null }> {
  if (!nombre.trim()) return { error: "Poné un nombre para la categoría" };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("categorias_gasto")
      .update({ nombre: nombre.trim(), tipo_default: tipoDefault })
      .eq("id_categoria", idCategoria);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar la categoría" };
  }
}

export async function crearSubcategoriaGasto(idCategoria: string, nombre: string): Promise<{ error: string | null }> {
  if (!nombre.trim()) return { error: "Poné un nombre para la subcategoría" };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("subcategorias_gasto").insert({ id_categoria: idCategoria, nombre: nombre.trim(), estado: "ACTIVA" });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la subcategoría" };
  }
}

export async function renombrarSubcategoriaGasto(idSubcategoria: string, nombre: string): Promise<{ error: string | null }> {
  if (!nombre.trim()) return { error: "Poné un nombre para la subcategoría" };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("subcategorias_gasto").update({ nombre: nombre.trim() }).eq("id_subcategoria", idSubcategoria);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo renombrar la subcategoría" };
  }
}

// Aplica el Fijo/Variable actual de la categoría a todos los gastos que ya
// cargaste con ella (tengan o no subcategoría) — para corregir de una sola
// vez lo que quedó mal clasificado, sin tener que editar gasto por gasto.
export async function aplicarTipoACategoria(idCategoria: string): Promise<{ error: string | null; actualizados?: number }> {
  const supabase = getSupabaseServerClient();
  const { data: categoria } = await supabase.from("categorias_gasto").select("tipo_default").eq("id_categoria", idCategoria).maybeSingle();
  if (!categoria) return { error: "No se encontró la categoría" };
  const { data, error } = await supabase
    .from("gastos")
    .update({ tipo: categoria.tipo_default })
    .eq("id_categoria", idCategoria)
    .select("id_gasto");
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/gastos");
  revalidatePath("/resultado-mes");
  return { error: null, actualizados: data?.length ?? 0 };
}

// Cuántos gastos activos tiene cada categoría/subcategoría — se usa para
// avisar antes de desactivar una que ya tiene historial cargado (así no se
// corta sin querer una serie que se venía comparando mes a mes).
export async function contarGastosPorCategoria(): Promise<{ porCategoria: Record<string, number>; porSubcategoria: Record<string, number> }> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("gastos").select("id_categoria, id_subcategoria").eq("anulado", false);
  if (error) throw new Error(friendlyDbError(error));
  const porCategoria: Record<string, number> = {};
  const porSubcategoria: Record<string, number> = {};
  for (const g of data ?? []) {
    const idCategoria = g.id_categoria as string;
    porCategoria[idCategoria] = (porCategoria[idCategoria] ?? 0) + 1;
    if (g.id_subcategoria) {
      const idSubcategoria = g.id_subcategoria as string;
      porSubcategoria[idSubcategoria] = (porSubcategoria[idSubcategoria] ?? 0) + 1;
    }
  }
  return { porCategoria, porSubcategoria };
}

export async function listarCategorias() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("categorias_gasto").select("*").eq("estado", "ACTIVA").order("nombre");
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function listarSubcategorias() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("subcategorias_gasto").select("*").eq("estado", "ACTIVA").order("nombre");
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

// El egreso en efectivo de un turno abierto descuenta del arqueo (ver
// resumenTurno en turnos/actions.ts); el de Caja Administración se anota
// como salida en ese libro; transferencia y tarjeta/MP no tocan ninguna
// caja física — quedan solo para el reporte de gastos.
// Next.js redacta en producción el mensaje de cualquier Error que se
// lance desde una Server Action (queda solo un "digest" genérico en el
// navegador) — por eso esta función nunca throwea para errores
// esperables: devuelve { error } como dato y el componente lo muestra tal cual.
export async function crearGasto(formData: FormData): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const sesion = await sesionActual();
    const usuario = sesion?.nombre ?? null;

    const idCategoria = await resolveCategoria(supabase, formData);
    if (!idCategoria) return { error: "Elegí o creá una categoría" };
    const idSubcategoria = await resolveSubcategoria(supabase, formData, idCategoria);
    if (!idSubcategoria) return { error: "Elegí o creá una subcategoría" };

    // El monto que se carga acá siempre es el neto — el IVA se suma
    // aparte, solo si se tildó "Tiene factura con IVA".
    const neto = number(formData, "monto");
    if (!neto || neto <= 0) return { error: "El monto tiene que ser mayor a 0" };
    const llevaIva = formData.get("lleva_iva") === "on";
    const iva = llevaIva ? redondear2(neto * ((await ivaGeneralPorcentaje(supabase)) / 100)) : 0;
    const monto = redondear2(neto + iva);

    const medioPago = text(formData, "medio_pago") ?? "TRANSFERENCIA";
    const tipo = await resolverTipoGasto(supabase, idCategoria);
    const descripcion = text(formData, "descripcion");
    const pendienteFactura = formData.get("pendiente_factura") === "on";
    const idUsuarioAdelanto = text(formData, "id_usuario_adelanto");
    const idLocal = text(formData, "id_local");

    let idTurno: string | null = null;
    if (medioPago === "EFECTIVO_TURNO") {
      if (!idLocal) return { error: "Elegí el local para descontar del turno abierto" };
      idTurno = await turnoAbiertoDeLocal(supabase, idLocal);
      if (!idTurno) return { error: "No hay un turno de caja abierto en ese local — no se puede descontar de ahí." };
    }

    // Si quien carga no puede autorizar gastos sin límite (no es admin ni
    // tiene ese permiso puntual) y el monto supera el tope, hace falta la
    // contraseña de alguien que sí pueda, para autorizarlo en el momento.
    const tope = await topeAutorizacion(supabase);
    let requirioAutorizacion = false;
    let autorizadoPor: string | null = null;
    const sesionCompleta = await obtenerSesionConPermisos();
    if (!tienePermiso(sesionCompleta, PERMISOS.AUTORIZAR_GASTOS_SIN_LIMITE) && monto > tope) {
      requirioAutorizacion = true;
      const claveAdmin = String(formData.get("clave_admin") ?? "");
      if (!claveAdmin) {
        return { error: `Este gasto supera el tope de $${tope} — hace falta la contraseña de alguien autorizado.` };
      }
      const { data: candidatos } = await supabase
        .from("usuarios")
        .select("nombre, rol, permisos, password_hash")
        .eq("estado", "ACTIVO");
      let autorizador: { nombre: string } | null = null;
      for (const c of candidatos ?? []) {
        const puedeAutorizar = c.rol === "admin" || (c.permisos ?? []).includes(PERMISOS.AUTORIZAR_GASTOS_SIN_LIMITE);
        if (puedeAutorizar && (await verifyPassword(claveAdmin, c.password_hash))) {
          autorizador = c;
          break;
        }
      }
      if (!autorizador) return { error: "Contraseña incorrecta" };
      autorizadoPor = autorizador.nombre;
    }

    // Se usa cuando el mes actual ya está cerrado y se eligió cargar este
    // gasto en el mes siguiente en vez de reabrir el cierre (ver
    // GastosIngresosApp / estaPeriodoCerrado).
    const fechaOverride = text(formData, "fecha_override");

    const { data: gasto, error } = await supabase
      .from("gastos")
      .insert({
        id_local: idLocal,
        id_turno: idTurno,
        id_categoria: idCategoria,
        id_subcategoria: idSubcategoria,
        tipo,
        medio_pago: medioPago,
        monto,
        neto,
        iva,
        descripcion,
        pendiente_factura: pendienteFactura,
        requirio_autorizacion: requirioAutorizacion,
        autorizado_por: autorizadoPor,
        id_usuario_adelanto: idUsuarioAdelanto,
        usuario,
        ...(fechaOverride ? { fecha: fechaOverride } : {}),
      })
      .select("id_gasto")
      .single();
    if (error) return { error: friendlyDbError(error) };

    const comprobante = formData.get("comprobante") as File | null;
    if (comprobante && comprobante.size > 0) {
      const extension = comprobante.name.split(".").pop() ?? "jpg";
      const path = `${gasto.id_gasto}.${extension}`;
      const { error: errorUpload } = await supabase.storage
        .from("comprobantes-gasto")
        .upload(path, comprobante, { upsert: true, contentType: comprobante.type || undefined });
      // No bloquea el gasto si falla la subida — la plata ya se movió, el
      // comprobante se puede volver a intentar después.
      if (!errorUpload) {
        await supabase.from("gastos").update({ comprobante_path: path }).eq("id_gasto", gasto.id_gasto);
      }
    }

    if (medioPago === "EFECTIVO_ADMIN") {
      await supabase.from("movimientos_caja_admin").insert({
        tipo: "EGRESO_GASTO",
        monto: -monto,
        id_gasto: gasto.id_gasto,
        descripcion: descripcion ?? "Gasto pagado desde Caja Administración",
        usuario,
      });
    }

    revalidatePath("/gastos");
    revalidatePath("/turnos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo guardar el gasto" };
  }
}

// Edición de un gasto ya cargado — para corregir un error de tipeo (monto,
// categoría, descripción). A propósito NO toca medio de pago, local ni
// comprobante: esos están atados al turno/caja donde ya impactó la plata,
// tocarlos ahí podría descuadrar un arqueo ya cerrado.
export async function actualizarGasto(idGasto: string, formData: FormData): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();

    const idCategoria = await resolveCategoria(supabase, formData);
    if (!idCategoria) return { error: "Elegí o creá una categoría" };
    const idSubcategoria = await resolveSubcategoria(supabase, formData, idCategoria);
    if (!idSubcategoria) return { error: "Elegí o creá una subcategoría" };

    const neto = number(formData, "monto");
    if (!neto || neto <= 0) return { error: "El monto tiene que ser mayor a 0" };
    const llevaIva = formData.get("lleva_iva") === "on";
    const iva = llevaIva ? redondear2(neto * ((await ivaGeneralPorcentaje(supabase)) / 100)) : 0;
    const monto = redondear2(neto + iva);

    const tipo = await resolverTipoGasto(supabase, idCategoria);
    const descripcion = text(formData, "descripcion");
    const pendienteFactura = formData.get("pendiente_factura") === "on";

    // Mismo criterio que al crear: si el monto corregido supera el tope y
    // quien edita no puede autorizar sin límite, hace falta la contraseña
    // de alguien que sí pueda.
    const tope = await topeAutorizacion(supabase);
    let requirioAutorizacion = false;
    let autorizadoPor: string | null = null;
    const sesionCompleta = await obtenerSesionConPermisos();
    if (!tienePermiso(sesionCompleta, PERMISOS.AUTORIZAR_GASTOS_SIN_LIMITE) && monto > tope) {
      requirioAutorizacion = true;
      const claveAdmin = String(formData.get("clave_admin") ?? "");
      if (!claveAdmin) {
        return { error: `Este gasto supera el tope de $${tope} — hace falta la contraseña de alguien autorizado.` };
      }
      const { data: candidatos } = await supabase
        .from("usuarios")
        .select("nombre, rol, permisos, password_hash")
        .eq("estado", "ACTIVO");
      let autorizador: { nombre: string } | null = null;
      for (const c of candidatos ?? []) {
        const puedeAutorizar = c.rol === "admin" || (c.permisos ?? []).includes(PERMISOS.AUTORIZAR_GASTOS_SIN_LIMITE);
        if (puedeAutorizar && (await verifyPassword(claveAdmin, c.password_hash))) {
          autorizador = c;
          break;
        }
      }
      if (!autorizador) return { error: "Contraseña incorrecta" };
      autorizadoPor = autorizador.nombre;
    }

    const { error } = await supabase
      .from("gastos")
      .update({
        id_categoria: idCategoria,
        id_subcategoria: idSubcategoria,
        tipo,
        monto,
        neto,
        iva,
        descripcion,
        pendiente_factura: pendienteFactura,
        requirio_autorizacion: requirioAutorizacion,
        autorizado_por: autorizadoPor,
      })
      .eq("id_gasto", idGasto);
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/gastos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar el gasto" };
  }
}

export async function obtenerUrlComprobanteGasto(path: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.storage.from("comprobantes-gasto").createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export type FiltrosGastos = { idLocal?: string; idCategoria?: string; desde: string; hasta: string };

export async function listarGastos(filtros: FiltrosGastos) {
  const supabase = getSupabaseServerClient();
  let query = supabase
    .from("gastos")
    .select("*")
    .eq("anulado", false)
    .gte("fecha", `${filtros.desde}T00:00:00`)
    .lte("fecha", `${filtros.hasta}T23:59:59`)
    .order("fecha", { ascending: false });
  if (filtros.idLocal) query = query.eq("id_local", filtros.idLocal);
  if (filtros.idCategoria) query = query.eq("id_categoria", filtros.idCategoria);
  const { data, error } = await query;
  if (error) throw new Error(friendlyDbError(error));
  return (data ?? []) as Gasto[];
}

// Anula un gasto ya cargado (no lo borra de la base): deja de sumar en
// Historial, Resumen, Nómina, el Tablero de Resultados y todo lo demás que
// lea "gastos", pero queda el registro con el motivo por si hay que
// auditarlo después.
export async function anularGasto(idGasto: string, motivo: string): Promise<{ error: string | null }> {
  if (!motivo.trim()) return { error: "Contá brevemente por qué lo anulás." };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("gastos")
    .update({ anulado: true, motivo_anulacion: motivo.trim(), anulado_en: new Date().toISOString() })
    .eq("id_gasto", idGasto);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/gastos");
  revalidatePath("/resultado-mes");
  return { error: null };
}

export async function resumenGastos(filtros: { idLocal?: string; desde: string; hasta: string }) {
  const supabase = getSupabaseServerClient();
  let query = supabase
    .from("gastos")
    .select("id_categoria, monto, tipo, pendiente_factura")
    .eq("anulado", false)
    .gte("fecha", `${filtros.desde}T00:00:00`)
    .lte("fecha", `${filtros.hasta}T23:59:59`);
  if (filtros.idLocal) query = query.eq("id_local", filtros.idLocal);
  const { data: gastos, error } = await query;
  if (error) throw new Error(friendlyDbError(error));

  const { data: categorias } = await supabase.from("categorias_gasto").select("id_categoria, nombre").eq("estado", "ACTIVA");
  const { data: presupuestos } = await supabase.from("presupuestos_gasto").select("id_categoria, monto_mensual");
  const presupuestoPorCategoria = new Map((presupuestos ?? []).map((p) => [p.id_categoria, p.monto_mensual]));

  let total = 0;
  let totalFijos = 0;
  let totalVariables = 0;
  let pendientesFactura = 0;
  const totalesPorCategoria = new Map<string, number>();
  for (const g of gastos ?? []) {
    total += g.monto ?? 0;
    if (g.tipo === "FIJO") totalFijos += g.monto ?? 0;
    else totalVariables += g.monto ?? 0;
    if (g.pendiente_factura) pendientesFactura++;
    totalesPorCategoria.set(g.id_categoria, (totalesPorCategoria.get(g.id_categoria) ?? 0) + (g.monto ?? 0));
  }

  const porCategoria = (categorias ?? [])
    .map((c) => {
      const gastado = totalesPorCategoria.get(c.id_categoria) ?? 0;
      const presupuesto = presupuestoPorCategoria.get(c.id_categoria) ?? null;
      return {
        idCategoria: c.id_categoria as string,
        nombre: c.nombre as string,
        gastado,
        pct: total > 0 ? (gastado / total) * 100 : 0,
        presupuesto,
        pctPresupuesto: presupuesto ? (gastado / presupuesto) * 100 : null,
      };
    })
    .filter((c) => c.gastado > 0)
    .sort((a, b) => b.gastado - a.gastado);

  return { total, totalFijos, totalVariables, pendientesFactura, porCategoria };
}

export async function guardarPresupuesto(idCategoria: string, montoMensual: number) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("presupuestos_gasto")
    .upsert(
      { id_categoria: idCategoria, monto_mensual: montoMensual, fecha_actualizacion: new Date().toISOString() },
      { onConflict: "id_categoria" }
    );
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/gastos");
}

export async function listarPresupuestos() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("presupuestos_gasto").select("*");
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

// Semi-automático a propósito: el sistema recuerda qué falta cargar este
// mes, pero un humano confirma el monto (puede variar) antes de que
// impacte en la caja — nunca se crea un gasto sin que alguien lo mire.
export async function listarRecurrentes() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("gastos_recurrentes").select("*").eq("activo", true).order("dia_mes");
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function crearRecurrente(formData: FormData): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const idCategoria = await resolveCategoria(supabase, formData);
    if (!idCategoria) return { error: "Elegí o creá una categoría" };
    const idSubcategoria = await resolveSubcategoria(supabase, formData, idCategoria);
    if (!idSubcategoria) return { error: "Elegí o creá una subcategoría" };
    const descripcion = text(formData, "descripcion");
    if (!descripcion) return { error: "La descripción es obligatoria" };
    const montoEstimado = number(formData, "monto_estimado") ?? 0;
    const diaMes = Number(formData.get("dia_mes") ?? 1);
    const idLocal = text(formData, "id_local");
    const llevaIva = formData.get("lleva_iva") === "on";

    const { error } = await supabase.from("gastos_recurrentes").insert({
      id_categoria: idCategoria,
      id_subcategoria: idSubcategoria,
      descripcion,
      monto_estimado: montoEstimado,
      dia_mes: diaMes,
      id_local: idLocal,
      lleva_iva: llevaIva,
      activo: true,
    });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el gasto recurrente" };
  }
}

// Convierte un recurrente en un Gasto real del mes actual — el monto
// (siempre neto) se puede ajustar acá si varió (ej. la luz nunca es
// exactamente igual), y el IVA se recalcula con el % vigente al momento
// de cargarlo, no con el que había cuando se creó la plantilla.
export async function cargarRecurrente(idRecurrente: string, montoConfirmadoNeto: number, medioPago: string, llevaIva: boolean) {
  const supabase = getSupabaseServerClient();
  const sesion = await sesionActual();
  const { data: recurrente, error: errorRec } = await supabase
    .from("gastos_recurrentes")
    .select("*")
    .eq("id_recurrente", idRecurrente)
    .maybeSingle();
  if (errorRec) throw new Error(friendlyDbError(errorRec));
  if (!recurrente) throw new Error("No se encontró el gasto recurrente");

  const iva = llevaIva ? redondear2(montoConfirmadoNeto * ((await ivaGeneralPorcentaje(supabase)) / 100)) : 0;
  const monto = redondear2(montoConfirmadoNeto + iva);
  const tipo = await resolverTipoGasto(supabase, recurrente.id_categoria);

  const mesActual = new Date().toISOString().slice(0, 7);
  const { data: gasto, error } = await supabase
    .from("gastos")
    .insert({
      id_local: recurrente.id_local,
      id_categoria: recurrente.id_categoria,
      id_subcategoria: recurrente.id_subcategoria,
      tipo,
      medio_pago: medioPago,
      monto,
      neto: montoConfirmadoNeto,
      iva,
      descripcion: recurrente.descripcion,
      usuario: sesion?.nombre ?? null,
    })
    .select("id_gasto")
    .single();
  if (error) throw new Error(friendlyDbError(error));

  if (medioPago === "EFECTIVO_ADMIN") {
    await supabase.from("movimientos_caja_admin").insert({
      tipo: "EGRESO_GASTO",
      monto: -monto,
      id_gasto: gasto.id_gasto,
      descripcion: recurrente.descripcion,
      usuario: sesion?.nombre ?? null,
    });
  }

  await supabase.from("gastos_recurrentes").update({ ultimo_mes_cargado: mesActual }).eq("id_recurrente", idRecurrente);
  revalidatePath("/gastos");
}

// Nómina simplificada: sueldo base (en usuarios.sueldo_base) menos la
// suma de los gastos cargados como adelanto para ese empleado en el mes.
export async function resumenNomina(mes: string) {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) throw new Error("No tenés permiso para ver la Nómina.");

  const supabase = getSupabaseServerClient();
  const { data: usuarios, error } = await supabase
    .from("usuarios")
    .select("id_usuario, nombre, sueldo_base")
    .eq("estado", "ACTIVO")
    .order("nombre");
  if (error) throw new Error(friendlyDbError(error));

  const { data: adelantos } = await supabase
    .from("gastos")
    .select("id_usuario_adelanto, monto")
    .eq("anulado", false)
    .not("id_usuario_adelanto", "is", null)
    .gte("fecha", `${mes}-01T00:00:00`)
    .lt("fecha", `${mes}-32T00:00:00`);

  const adelantosPorUsuario = new Map<string, number>();
  for (const a of adelantos ?? []) {
    if (!a.id_usuario_adelanto) continue;
    adelantosPorUsuario.set(a.id_usuario_adelanto, (adelantosPorUsuario.get(a.id_usuario_adelanto) ?? 0) + (a.monto ?? 0));
  }

  return (usuarios ?? []).map((u) => {
    const adelantado = adelantosPorUsuario.get(u.id_usuario) ?? 0;
    const sueldoBase = u.sueldo_base ?? 0;
    return {
      idUsuario: u.id_usuario as string,
      nombre: u.nombre as string,
      sueldoBase,
      adelantado,
      aPagar: sueldoBase - adelantado,
    };
  });
}

// Caja Administración — solo efectivo físico. Mercado Pago/transferencia
// nunca entra acá, ya cae directo al banco (ver totalCobradoPorBanco).
export async function resumenCajaAdmin() {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.VER_CAJA_ADMIN)) throw new Error("No tenés permiso para ver la Caja Administración.");

  const supabase = getSupabaseServerClient();
  const { data: movimientos, error } = await supabase.from("movimientos_caja_admin").select("tipo, monto, fecha");
  if (error) throw new Error(friendlyDbError(error));

  const saldo = (movimientos ?? []).reduce((acc, m) => acc + (m.monto ?? 0), 0);

  const hace7dias = new Date();
  hace7dias.setDate(hace7dias.getDate() - 7);
  let ingresadoSemana = 0;
  let gastadoSemana = 0;
  for (const m of movimientos ?? []) {
    if (new Date(m.fecha) < hace7dias) continue;
    if ((m.monto ?? 0) > 0) ingresadoSemana += m.monto;
    else gastadoSemana += Math.abs(m.monto ?? 0);
  }

  return { saldo, ingresadoSemana, gastadoSemana };
}

export async function movimientosCajaAdmin() {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.VER_CAJA_ADMIN)) throw new Error("No tenés permiso para ver la Caja Administración.");

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("movimientos_caja_admin")
    .select("*")
    .order("fecha", { ascending: true })
    .limit(500);
  if (error) throw new Error(friendlyDbError(error));

  let saldo = 0;
  const conSaldo = (data ?? []).map((m) => {
    saldo += m.monto ?? 0;
    return { ...m, saldoAcumulado: saldo };
  });
  return conSaldo.reverse();
}

export async function registrarMovimientoCajaAdmin(
  tipo: "RETIRO_MANUAL" | "DEPOSITO_MANUAL",
  monto: number,
  descripcion: string
): Promise<{ error: string | null }> {
  if (!monto || monto <= 0) return { error: "El monto tiene que ser mayor a 0" };
  const sesionPermisos = await obtenerSesionConPermisos();
  if (!tienePermiso(sesionPermisos, PERMISOS.VER_CAJA_ADMIN)) {
    return { error: "No tenés permiso para operar la Caja Administración." };
  }
  try {
    const supabase = getSupabaseServerClient();
    const sesion = await sesionActual();
    const { error } = await supabase.from("movimientos_caja_admin").insert({
      tipo,
      monto: tipo === "RETIRO_MANUAL" ? -monto : monto,
      descripcion: descripcion || null,
      usuario: sesion?.nombre ?? null,
    });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/gastos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar el movimiento" };
  }
}

// Informativo — no se maneja en Caja Administración, ya está seguro en
// el banco. Solo para tener la foto completa de liquidez.
export async function totalCobradoPorBanco(desde: string, hasta: string) {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.VER_CAJA_ADMIN)) throw new Error("No tenés permiso para ver la Caja Administración.");

  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("ventas")
    .select("total")
    .eq("estado", "PAGADA")
    .eq("medio_pago", "MERCADO_PAGO")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  return (data ?? []).reduce((acc, v) => acc + (v.total ?? 0), 0);
}
