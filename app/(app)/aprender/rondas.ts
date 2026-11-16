"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { rolAtadoALaTablet } from "@/lib/aparatoLocal";
import { estadoAparato } from "@/lib/aparatoLocalServidor";
import type { PreguntaRonda } from "@/lib/aprenderPreguntas";
import {
  LIMITE_MS,
  PREGUNTAS_POR_RONDA,
  SEGUNDOS_POR_PREGUNTA,
  buscarRonda,
  obtenerOCrearRonda,
  periodoDe,
  rachaDe,
  type FilaRonda,
  type Respuesta,
  type TipoRonda,
} from "@/lib/aprenderRondas";

// «Las 5 de hoy» y la evaluación de la semana (Gonzalo, 2026-11-16).
// Todo se corrige acá: el navegador recibe cada pregunta SIN la respuesta, el
// reloj lo lleva el servidor (si pasan más de 15 s desde que se mostró, cuenta
// mal aunque la recargue) y una ronda terminada no se repite.

const FALTA_SQL = "Falta correr sql/aprender-rondas.sql en Supabase.";
const TABLET = "La evaluación de la semana se hace en la tablet del local.";

async function sesionQueVe() {
  const s = await obtenerSesionConPantallas();
  return s && (puedeVerPantalla(s, "aprender") || puedeVerPantalla(s, "aprender-revisar")) ? s : null;
}

/** Los operativos hacen la de la semana solo en la tablet del local (lib/aparatoLocal.ts). */
async function semanaPermitida(rol: string) {
  return !rolAtadoALaTablet(rol) || (await estadoAparato()).estado === "local";
}

const proxima = (r: FilaRonda) => r.respuestas.length;

export type ResumenAprender = {
  faltaSql: boolean;
  racha: number;
  hoy: { total: number; hechas: number; bien: number; terminada: boolean };
  semana: { total: number; hechas: number; bien: number; terminada: boolean; cerrada: boolean; soloTablet: boolean };
  ranking: { nombre: string; bien: number; total: number; yo: boolean }[];
  segundos: number;
};

/** Lo de arriba de Aprender: racha, cómo van las de hoy y la de la semana, y el ranking. */
export async function resumenAprender(): Promise<ResumenAprender> {
  const sesion = await sesionQueVe();
  const vacio: ResumenAprender = {
    faltaSql: false,
    racha: 0,
    hoy: { total: PREGUNTAS_POR_RONDA.DIA, hechas: 0, bien: 0, terminada: false },
    semana: { total: PREGUNTAS_POR_RONDA.SEMANA, hechas: 0, bien: 0, terminada: false, cerrada: periodoDe("SEMANA").cerrada, soloTablet: false },
    ranking: [],
    segundos: SEGUNDOS_POR_PREGUNTA,
  };
  if (!sesion) return vacio;
  const supabase = getSupabaseServerClient();
  const semana = periodoDe("SEMANA");
  const [hoy, sem, todas] = await Promise.all([
    buscarRonda(supabase, sesion.idUsuario, "DIA", periodoDe("DIA").periodo),
    buscarRonda(supabase, sesion.idUsuario, "SEMANA", semana.periodo),
    supabase.from("aprender_rondas").select("id_usuario, bien, preguntas, terminada").eq("tipo", "SEMANA").eq("periodo", semana.periodo),
  ]);
  if (hoy.error) return { ...vacio, faltaSql: true };
  const h = hoy.data as unknown as FilaRonda | null;
  const s = sem.data as unknown as FilaRonda | null;

  const terminadas = (todas.data ?? []).filter((r) => r.terminada);
  const ids = [...new Set(terminadas.map((r) => r.id_usuario as string))];
  const { data: usuarios } = ids.length ? await supabase.from("usuarios").select("id_usuario, nombre").in("id_usuario", ids) : { data: [] };
  const nombre = new Map((usuarios ?? []).map((u) => [u.id_usuario as string, String(u.nombre ?? "").trim().split(/\s+/)[0] || "Alguien"]));
  const ranking = terminadas
    .map((r) => ({ nombre: r.id_usuario === sesion.idUsuario ? "Vos" : nombre.get(r.id_usuario as string) ?? "Alguien", bien: Number(r.bien) || 0, total: (r.preguntas as unknown[]).length, yo: r.id_usuario === sesion.idUsuario }))
    .sort((a, b) => b.bien - a.bien || a.nombre.localeCompare(b.nombre, "es"));

  return {
    faltaSql: false,
    racha: await rachaDe(supabase, sesion.idUsuario),
    hoy: { total: h?.preguntas.length ?? PREGUNTAS_POR_RONDA.DIA, hechas: h?.respuestas.length ?? 0, bien: h?.bien ?? 0, terminada: Boolean(h?.terminada) },
    semana: {
      total: s?.preguntas.length ?? PREGUNTAS_POR_RONDA.SEMANA,
      hechas: s?.respuestas.length ?? 0,
      bien: s?.bien ?? 0,
      terminada: Boolean(s?.terminada),
      cerrada: semana.cerrada,
      soloTablet: !(await semanaPermitida(sesion.rol)),
    },
    ranking,
    segundos: SEGUNDOS_POR_PREGUNTA,
  };
}

export type EstadoRonda = { idRonda: string; total: number; hechas: number; bien: number; terminada: boolean };

export async function empezarRonda(tipo: TipoRonda): Promise<{ error: string } | EstadoRonda> {
  const sesion = await sesionQueVe();
  if (!sesion) return { error: "No tenés Aprender habilitado." };
  if (tipo === "SEMANA" && !(await semanaPermitida(sesion.rol))) return { error: TABLET };
  const { ronda, motivo } = await obtenerOCrearRonda(getSupabaseServerClient(), sesion.idUsuario, tipo);
  if (!ronda) {
    return {
      error:
        motivo === "sql"
          ? FALTA_SQL
          : motivo === "cerrada"
            ? "La evaluación de esta semana ya cerró. La próxima abre el lunes."
            : "Todavía no hay datos suficientes para armar las preguntas.",
    };
  }
  if (tipo === "SEMANA" && !ronda.terminada && periodoDe("SEMANA").cerrada) return { error: "La evaluación de esta semana ya cerró." };
  return { idRonda: ronda.id_ronda, total: ronda.preguntas.length, hechas: ronda.respuestas.length, bien: ronda.bien, terminada: Boolean(ronda.terminada) };
}

async function rondaDe(idRonda: string) {
  const sesion = await sesionQueVe();
  if (!sesion) return { error: "No tenés Aprender habilitado." } as const;
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("aprender_rondas")
    .select("id_ronda, id_usuario, tipo, periodo, preguntas, respuestas, bien, terminada")
    .eq("id_ronda", idRonda)
    .maybeSingle();
  if (error) return { error: FALTA_SQL } as const;
  const ronda = data as unknown as FilaRonda | null;
  if (!ronda || ronda.id_usuario !== sesion.idUsuario) return { error: "No se encontró la ronda." } as const;
  if (ronda.tipo === "SEMANA" && !(await semanaPermitida(sesion.rol))) return { error: TABLET } as const;
  return { ronda, supabase, idUsuario: sesion.idUsuario } as const;
}

export type PreguntaVisible = Omit<PreguntaRonda, "correctas" | "explicacion" | "mostradaEn">;

/** La pregunta que sigue, sin la respuesta. Desde acá corre su reloj (también si recarga la página). */
export async function siguientePregunta(
  idRonda: string
): Promise<{ error: string } | { fin: true; bien: number; total: number } | { fin: false; i: number; total: number; bien: number; pregunta: PreguntaVisible; quedanMs: number }> {
  const r = await rondaDe(idRonda);
  if ("error" in r) return { error: r.error as string };
  const { ronda, supabase } = r;
  const i = proxima(ronda);
  if (ronda.terminada || i >= ronda.preguntas.length) return { fin: true, bien: ronda.bien, total: ronda.preguntas.length };

  const q = ronda.preguntas[i];
  let mostrada = q.mostradaEn ? new Date(q.mostradaEn).getTime() : NaN;
  if (Number.isNaN(mostrada)) {
    mostrada = Date.now();
    const preguntas = ronda.preguntas.map((x, k) => (k === i ? { ...x, mostradaEn: new Date(mostrada).toISOString() } : x));
    await supabase.from("aprender_rondas").update({ preguntas }).eq("id_ronda", ronda.id_ronda);
  }
  const visible: PreguntaVisible = { tipo: q.tipo, etiqueta: q.etiqueta, pregunta: q.pregunta, opciones: q.opciones, idProducto: q.idProducto, producto: q.producto, imagen: q.imagen };
  return {
    fin: false,
    i,
    total: ronda.preguntas.length,
    bien: ronda.bien,
    pregunta: visible,
    quedanMs: Math.max(0, SEGUNDOS_POR_PREGUNTA * 1000 - (Date.now() - mostrada)),
  };
}

/** Corrige una respuesta. Fuera de tiempo (o sin elegir nada) cuenta mal. */
export async function responder(
  idRonda: string,
  i: number,
  elegidas: number[]
): Promise<
  | { error: string }
  | { bien: boolean; fueraDeTiempo: boolean; correctas: number[]; explicacion: string; idProducto: string | null; terminada: boolean; totalBien: number; total: number }
> {
  const r = await rondaDe(idRonda);
  if ("error" in r) return { error: r.error as string };
  const { ronda, supabase, idUsuario } = r;
  if (ronda.terminada) return { error: "Esta ronda ya está terminada." };
  if (i !== proxima(ronda)) return { error: "Esa pregunta ya se contestó." };
  const q = ronda.preguntas[i];
  if (!q) return { error: "No existe esa pregunta." };

  const mostrada = q.mostradaEn ? new Date(q.mostradaEn).getTime() : NaN;
  const ms = Number.isNaN(mostrada) ? null : Date.now() - mostrada;
  const fueraDeTiempo = ms === null || ms > LIMITE_MS;
  const limpias = [...new Set((Array.isArray(elegidas) ? elegidas : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < q.opciones.length))];
  const exacta = limpias.length === q.correctas.length && q.correctas.every((c) => limpias.includes(c));
  const bien = !fueraDeTiempo && exacta;

  const respuestas: Respuesta[] = [...ronda.respuestas, { i, elegidas: limpias, bien, ms, en: new Date().toISOString() }];
  const totalBien = ronda.bien + (bien ? 1 : 0);
  const terminada = respuestas.length >= ronda.preguntas.length;
  const { error } = await supabase
    .from("aprender_rondas")
    .update({ respuestas, bien: totalBien, ...(terminada ? { terminada: new Date().toISOString() } : {}) })
    .eq("id_ronda", ronda.id_ronda)
    .is("terminada", null);
  if (error) return { error: "No se pudo guardar la respuesta. Probá de nuevo." };
  // Para el progreso que mira RR.HH. en el legajo.
  await supabase.from("aprender_respuestas").insert({ id_usuario: idUsuario, id_producto: q.idProducto, correcta: bien });

  return { bien, fueraDeTiempo, correctas: q.correctas, explicacion: q.explicacion, idProducto: q.idProducto, terminada, totalBien, total: ronda.preguntas.length };
}
