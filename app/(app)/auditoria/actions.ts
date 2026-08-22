"use server";

import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

// Ver todo lo que se movió de plata (Fases 1 a 6) es siempre solo del
// Dueño — a diferencia de las pantallas de Situación de marca, esto NO se
// delega vía Roles, ni siquiera a "Administración": auditar a alguien no
// se le puede dejar a esa misma persona.
async function requireDueño() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (sesion?.rol !== "admin") return "Esta pantalla es solo para el Dueño.";
  return null;
}

export type FiltroAuditoria = { idMarca?: string; origen?: string; desde: string; hasta: string };

export type FilaAuditoria = {
  id: string;
  fecha: string;
  idMarca: string | null;
  nombreMarca: string;
  origen: "Comercial" | "Retenciones" | "Compensación" | "Profesional";
  tipo: string;
  importe: number;
  usuario: string | null;
  observaciones: string | null;
};

const ETIQUETA_TIPO_CARGO: Record<string, string> = {
  FEE_INGRESO: "Fee de ingreso",
  GASTO_FIJO_MENSUAL: "Gasto fijo mensual",
  OTRO_CARGO: "Otro cargo",
  PAGO: "Pago",
  AJUSTE: "Ajuste",
  COMPENSACION: "Compensación",
};

const ETIQUETA_TIPO_RETENCION: Record<string, string> = {
  RETENCION: "Retención",
  COMPENSACION: "Compensación",
  DEVOLUCION: "Devolución",
  AJUSTE_POSITIVO: "Ajuste (+)",
  AJUSTE_NEGATIVO: "Ajuste (−)",
  ANULACION: "Anulación",
};

const ETIQUETA_CUENTA: Record<string, string> = {
  LIQUIDACIONES: "Liquidaciones",
  COMERCIAL: "Comercial",
  RETENCIONES: "Retenciones",
};

export async function listarAuditoria(filtro: FiltroAuditoria): Promise<{ error: string | null; filas: FilaAuditoria[] }> {
  const permisoError = await requireDueño();
  if (permisoError) return { error: permisoError, filas: [] };

  const supabase = getSupabaseServerClient();
  const { data: marcas } = await supabase.from("marcas").select("id_marca, nombre");
  const nombrePorMarca = new Map((marcas ?? []).map((m) => [m.id_marca, m.nombre]));

  const desdeTs = `${filtro.desde}T00:00:00`;
  const hastaTs = `${filtro.hasta}T23:59:59`;
  const filas: FilaAuditoria[] = [];

  if (!filtro.origen || filtro.origen === "Comercial") {
    let q = supabase
      .from("movimientos_cuenta_comercial_marca")
      .select("id_movimiento, id_marca, tipo_cargo, importe, usuario, observaciones, fecha")
      .gte("fecha", desdeTs)
      .lte("fecha", hastaTs);
    if (filtro.idMarca) q = q.eq("id_marca", filtro.idMarca);
    const { data, error } = await q;
    if (error) return { error: friendlyDbError(error), filas: [] };
    for (const m of data ?? []) {
      filas.push({
        id: m.id_movimiento,
        fecha: m.fecha,
        idMarca: m.id_marca,
        nombreMarca: nombrePorMarca.get(m.id_marca) ?? "Marca",
        origen: "Comercial",
        tipo: ETIQUETA_TIPO_CARGO[m.tipo_cargo] ?? m.tipo_cargo,
        importe: m.importe ?? 0,
        usuario: m.usuario,
        observaciones: m.observaciones,
      });
    }
  }

  if (!filtro.origen || filtro.origen === "Retenciones") {
    let q = supabase
      .from("movimientos_retencion_marca")
      .select("id_movimiento, id_marca, tipo_retencion, tipo_movimiento, importe, usuario, observaciones, fecha")
      .gte("fecha", desdeTs)
      .lte("fecha", hastaTs);
    if (filtro.idMarca) q = q.eq("id_marca", filtro.idMarca);
    const { data, error } = await q;
    if (error) return { error: friendlyDbError(error), filas: [] };
    for (const m of data ?? []) {
      filas.push({
        id: m.id_movimiento,
        fecha: m.fecha,
        idMarca: m.id_marca,
        nombreMarca: nombrePorMarca.get(m.id_marca) ?? "Marca",
        origen: "Retenciones",
        tipo: `${m.tipo_retencion} — ${ETIQUETA_TIPO_RETENCION[m.tipo_movimiento] ?? m.tipo_movimiento}`,
        importe: m.importe ?? 0,
        usuario: m.usuario,
        observaciones: m.observaciones,
      });
    }
  }

  if (!filtro.origen || filtro.origen === "Compensación") {
    let q = supabase
      .from("compensaciones_marca")
      .select("id_compensacion, id_marca, cuenta_a, cuenta_b, importe, usuario, observaciones, fecha")
      .gte("fecha", desdeTs)
      .lte("fecha", hastaTs);
    if (filtro.idMarca) q = q.eq("id_marca", filtro.idMarca);
    const { data, error } = await q;
    if (error) return { error: friendlyDbError(error), filas: [] };
    for (const c of data ?? []) {
      filas.push({
        id: c.id_compensacion,
        fecha: c.fecha,
        idMarca: c.id_marca,
        nombreMarca: nombrePorMarca.get(c.id_marca) ?? "Marca",
        origen: "Compensación",
        tipo: `${ETIQUETA_CUENTA[c.cuenta_a] ?? c.cuenta_a} ⇄ ${ETIQUETA_CUENTA[c.cuenta_b] ?? c.cuenta_b}`,
        importe: c.importe ?? 0,
        usuario: c.usuario,
        observaciones: c.observaciones,
      });
    }
  }

  if (!filtro.origen || filtro.origen === "Profesional") {
    let q = supabase
      .from("movimientos_profesional_marca")
      .select("id_movimiento, id_marca, tipo, monto, usuario, descripcion, fecha")
      .gte("fecha", desdeTs)
      .lte("fecha", hastaTs);
    if (filtro.idMarca) q = q.eq("id_marca", filtro.idMarca);
    const { data, error } = await q;
    if (error) return { error: friendlyDbError(error), filas: [] };
    for (const m of data ?? []) {
      filas.push({
        id: m.id_movimiento,
        fecha: m.fecha,
        idMarca: m.id_marca,
        nombreMarca: nombrePorMarca.get(m.id_marca) ?? "Marca",
        origen: "Profesional",
        tipo: m.tipo === "CANJE" ? "Canje" : "Pago",
        importe: m.monto ?? 0,
        usuario: m.usuario,
        observaciones: m.descripcion,
      });
    }
  }

  filas.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return { error: null, filas: filas.slice(0, 300) };
}
