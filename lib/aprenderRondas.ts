import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina } from "@/lib/horarios";
import { cargarBanco, armarPreguntas, type PreguntaRonda } from "@/lib/aprenderPreguntas";
import { puedeVerPantalla, type SesionConPantallas } from "@/lib/roles";

// Las rondas de Aprender (sql/aprender-rondas.sql): «Las 5 de hoy» y la
// evaluación de la semana (10, una vez, cierra el domingo a las 21:00).
// Lo usan las acciones de /aprender y el fichaje de salida (son obligatorias).

export type TipoRonda = "DIA" | "SEMANA";
export const PREGUNTAS_POR_RONDA: Record<TipoRonda, number> = { DIA: 5, SEMANA: 10 };
/** 15 segundos por pregunta, más 2 de margen por la conexión. */
export const SEGUNDOS_POR_PREGUNTA = 15;
export const LIMITE_MS = (SEGUNDOS_POR_PREGUNTA + 2) * 1000;

export type Respuesta = { i: number; elegidas: number[]; bien: boolean; ms: number | null; en: string };
export type FilaRonda = {
  id_ronda: string;
  id_usuario: string;
  tipo: TipoRonda;
  periodo: string;
  preguntas: PreguntaRonda[];
  respuestas: Respuesta[];
  bien: number;
  terminada: string | null;
};

const COLUMNAS = "id_ronda, id_usuario, tipo, periodo, preguntas, respuestas, bien, terminada";

function sumarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** El período de cada tipo, en hora de Argentina. La semana cierra el domingo a las 21:00. */
export function periodoDe(tipo: TipoRonda, ahora = new Date()) {
  const a = fechaHoraArgentina(ahora);
  if (tipo === "DIA") return { periodo: a.fecha, cerrada: false };
  return { periodo: sumarDias(a.fecha, -(a.diaSemanaISO - 1)), cerrada: a.diaSemanaISO === 7 && a.minutosDelDia >= 21 * 60 };
}

export async function buscarRonda(supabase: SupabaseClient, idUsuario: string, tipo: TipoRonda, periodo: string) {
  return supabase.from("aprender_rondas").select(COLUMNAS).eq("id_usuario", idUsuario).eq("tipo", tipo).eq("periodo", periodo).maybeSingle();
}

/**
 * La ronda de esta persona para este período: la que ya tiene, o una nueva con
 * sus preguntas (semilla usuario + tipo + período: siempre las mismas para ella,
 * distintas a las de sus compañeros). null + motivo si no se puede.
 */
export async function obtenerOCrearRonda(
  supabase: SupabaseClient,
  idUsuario: string,
  tipo: TipoRonda
): Promise<{ ronda: FilaRonda | null; motivo: "sql" | "pocas" | "cerrada" | null }> {
  const { periodo, cerrada } = periodoDe(tipo);
  const ya = await buscarRonda(supabase, idUsuario, tipo, periodo);
  if (ya.error) return { ronda: null, motivo: "sql" };
  if (ya.data) return { ronda: ya.data as unknown as FilaRonda, motivo: null };
  if (cerrada) return { ronda: null, motivo: "cerrada" };

  const preguntas = armarPreguntas(await cargarBanco(supabase), `${idUsuario}|${tipo}|${periodo}`, PREGUNTAS_POR_RONDA[tipo]);
  if (preguntas.length < PREGUNTAS_POR_RONDA[tipo]) return { ronda: null, motivo: "pocas" };
  const nueva = await supabase.from("aprender_rondas").insert({ id_usuario: idUsuario, tipo, periodo, preguntas }).select(COLUMNAS).single();
  if (nueva.error) {
    // Dos pestañas a la vez: la otra ya la creó.
    const otra = await buscarRonda(supabase, idUsuario, tipo, periodo);
    return otra.data ? { ronda: otra.data as unknown as FilaRonda, motivo: null } : { ronda: null, motivo: "sql" };
  }
  return { ronda: nueva.data as unknown as FilaRonda, motivo: null };
}

/** Días seguidos con «Las 5 de hoy» terminadas, contando hoy (o ayer, si hoy todavía no las hizo). */
export async function rachaDe(supabase: SupabaseClient, idUsuario: string): Promise<number> {
  const hoy = periodoDe("DIA").periodo;
  const { data } = await supabase
    .from("aprender_rondas")
    .select("periodo")
    .eq("id_usuario", idUsuario)
    .eq("tipo", "DIA")
    .not("terminada", "is", null)
    .gte("periodo", sumarDias(hoy, -400))
    .order("periodo", { ascending: false });
  const hechos = new Set((data ?? []).map((r) => String(r.periodo).slice(0, 10)));
  let dia = hechos.has(hoy) ? hoy : sumarDias(hoy, -1);
  let racha = 0;
  while (hechos.has(dia)) {
    racha++;
    dia = sumarDias(dia, -1);
  }
  return racha;
}

/**
 * ¿Le faltan «Las 5 de hoy» para poder fichar la salida? Falla ABIERTO: el
 * Dueño, quien no tiene Aprender, la tabla sin crear o un día sin datos para
 * armar 5 preguntas nunca frenan a nadie.
 */
export async function faltanLasDeHoy(supabase: SupabaseClient, sesion: SesionConPantallas | null): Promise<boolean> {
  try {
    if (!sesion || sesion.rol === "admin" || !puedeVerPantalla(sesion, "aprender")) return false;
    const { ronda } = await obtenerOCrearRonda(supabase, sesion.idUsuario, "DIA");
    return Boolean(ronda && !ronda.terminada);
  } catch {
    return false;
  }
}
