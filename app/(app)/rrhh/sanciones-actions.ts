"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { APERCIBIMIENTO_DESDE_DEFECTO } from "@/lib/sanciones";

// Llamados de atención y apercibimientos por llegada tarde, del lado de
// administración: verlos en el legajo, anularlos si la tardanza se
// justifica, y la regla de desde qué llegada tarde del mes hay apercibimiento.
// Se crean solos al fichar (ver ficha-asistencia/actions.ts).

async function requireAcceso() {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return { error: "No tenés permiso para hacer esto.", sesion: null };
  return { error: null, sesion };
}

const FALTA_SQL = "Falta correr sql/llamados-y-caja.sql en Supabase.";
const faltaTabla = (m: string) => /sanciones|schema cache|does not exist/i.test(m);

export type Sancion = {
  idSancion: string;
  tipo: "LLAMADO" | "APERCIBIMIENTO";
  fecha: string;
  numeroEnMes: number;
  minutosTarde: number | null;
  horaIngreso: string | null;
  motivo: string | null;
  firma: string | null;
  firmadoEn: string | null;
  seNego: boolean;
  estado: "VIGENTE" | "ANULADA";
  anuladaPor: string | null;
  motivoAnulacion: string | null;
};

export async function listarSancionesPersona(idPersona: string): Promise<{ sanciones: Sancion[]; faltaSql: boolean }> {
  const acceso = await requireAcceso();
  if (acceso.error) throw new Error(acceso.error);
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("sanciones")
    .select("id_sancion, tipo, fecha, numero_en_mes, minutos_tarde, hora_ingreso, motivo, firma, firmado_en, se_nego, estado, anulada_por, motivo_anulacion")
    .eq("id_persona", idPersona)
    .order("fecha", { ascending: false })
    .order("creado_en", { ascending: false });
  if (error) {
    if (faltaTabla(error.message)) return { sanciones: [], faltaSql: true };
    throw new Error(friendlyDbError(error));
  }
  return {
    faltaSql: false,
    sanciones: (data ?? []).map((s) => ({
      idSancion: s.id_sancion as string,
      tipo: s.tipo as Sancion["tipo"],
      fecha: s.fecha as string,
      numeroEnMes: s.numero_en_mes as number,
      minutosTarde: (s.minutos_tarde as number | null) ?? null,
      horaIngreso: (s.hora_ingreso as string | null) ?? null,
      motivo: (s.motivo as string | null) ?? null,
      firma: (s.firma as string | null) ?? null,
      firmadoEn: (s.firmado_en as string | null) ?? null,
      seNego: Boolean(s.se_nego),
      estado: s.estado as Sancion["estado"],
      anuladaPor: (s.anulada_por as string | null) ?? null,
      motivoAnulacion: (s.motivo_anulacion as string | null) ?? null,
    })),
  };
}

/**
 * Administración justifica la tardanza: el llamado queda anulado y la
 * tardanza deja de contar (para los próximos llamados y para el presentismo).
 * El motivo que haya escrito la persona no anula nada por sí solo.
 */
export async function anularSancion(idSancion: string, motivo: string): Promise<{ error: string | null }> {
  const acceso = await requireAcceso();
  if (acceso.error) return { error: acceso.error };
  if (!motivo.trim()) return { error: "Escribí por qué se justifica." };
  const supabase = getSupabaseServerClient();
  const { data: s } = await supabase.from("sanciones").select("id_fichaje").eq("id_sancion", idSancion).maybeSingle();
  const { error } = await supabase
    .from("sanciones")
    .update({ estado: "ANULADA", anulada_por: acceso.sesion?.nombre ?? null, anulada_en: new Date().toISOString(), motivo_anulacion: motivo.trim() })
    .eq("id_sancion", idSancion);
  if (error) return { error: faltaTabla(error.message) ? FALTA_SQL : friendlyDbError(error) };
  if (s?.id_fichaje) await supabase.from("fichajes").update({ justificado: true }).eq("id_fichaje", s.id_fichaje as string);
  revalidatePath("/rrhh");
  return { error: null };
}

/** Desde qué llegada tarde del mes corresponde apercibimiento (por defecto, la 4ª). */
export async function obtenerReglaApercibimiento(): Promise<number> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", "APERCIBIMIENTO_DESDE").maybeSingle();
  const n = Number(data?.valor);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : APERCIBIMIENTO_DESDE_DEFECTO;
}

export async function guardarReglaApercibimiento(desde: number): Promise<{ error: string | null }> {
  const acceso = await requireAcceso();
  if (acceso.error) return { error: acceso.error };
  if (!(desde >= 1 && desde <= 10)) return { error: "Elegí un número entre 1 y 10." };
  const supabase = getSupabaseServerClient();
  const { data: existente } = await supabase.from("configuracion").select("parametro").eq("parametro", "APERCIBIMIENTO_DESDE").maybeSingle();
  const { error } = existente
    ? await supabase.from("configuracion").update({ valor: String(Math.round(desde)) }).eq("parametro", "APERCIBIMIENTO_DESDE")
    : await supabase.from("configuracion").insert({ parametro: "APERCIBIMIENTO_DESDE", valor: String(Math.round(desde)) });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/rrhh");
  return { error: null };
}
