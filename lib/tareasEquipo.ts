// Tareas del equipo: lo que propone la Junta (o carga el Dueño), aprobado por
// el Dueño, y que le aparece al equipo en Mis Tareas "de parte de
// Administración WiiGo".
//
// Una tarea es para todos, para un turno o para una persona, y se hace una
// vez (con fecha o sin fecha) o se repite cada semana el mismo día. Si es
// para un turno o para todos, alcanza con que la haga uno: se ve quién.
//
// Tolerante a que falte sql/tareas-equipo.sql: sin las tablas, todo devuelve
// vacío y la Junta avisa.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina } from "@/lib/horarios";

export const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export type TareaFila = {
  id_tarea: string;
  titulo: string;
  detalle: string | null;
  motivo: string | null;
  propuesta_por: string;
  id_mensaje: string | null;
  para_tipo: "TODOS" | "TURNO" | "PERSONA";
  id_horario: string | null;
  id_persona: string | null;
  vence: string | null;
  repite_dia: number | null;
  estado: "PROPUESTA" | "ACTIVA" | "DESCARTADA" | "ARCHIVADA";
  creado: string;
  aprobado_en: string | null;
};

export type EquipoTareas = {
  turnos: { id: string; nombre: string }[];
  personas: { id: string; nombre: string; idHorario: string | null }[];
};

/** Una tarea lista para mostrar: a quién va, cuándo toca y cómo está. */
export type TareaVista = {
  id: string;
  titulo: string;
  detalle: string | null;
  motivo: string | null;
  propuestaPor: string;
  idMensaje: string | null;
  estadoTarea: TareaFila["estado"];
  paraTipo: TareaFila["para_tipo"];
  idHorario: string | null;
  idPersona: string | null;
  vence: string | null;
  repiteDia: number | null;
  /** "Turno mañana", "Florencia", "Todo el equipo". */
  para: string;
  /** "Para el lunes 26/10", "Todos los viernes", "Cuando puedas". */
  cuando: string;
  /** El día que toca esta vez (YYYY-MM-DD). */
  fecha: string;
  situacion: "PENDIENTE" | "VENCIDA" | "HECHA";
  /** Quién la hizo esta vez, "viernes 20:40" y el día (YYYY-MM-DD). */
  hecha: { nombre: string; hora: string; el: string } | null;
};

const faltaTabla = (m: string) => /tareas_equipo|schema cache|does not exist/i.test(m);

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
function diaDe(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return DIAS[d === 0 ? 6 : d - 1];
}
function sumarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** El día que toca esta vez: el de esta semana si se repite, si no la fecha (o hoy si no tiene). */
export function fechaQueToca(t: Pick<TareaFila, "repite_dia" | "vence">, hoy = fechaHoraArgentina()) {
  if (t.repite_dia) return sumarDias(hoy.fecha, t.repite_dia - hoy.diaSemanaISO);
  return t.vence ?? hoy.fecha;
}

export async function equipoParaTareas(supabase: SupabaseClient): Promise<EquipoTareas> {
  const [horarios, personas] = await Promise.all([
    supabase.from("horarios_trabajo").select("id_horario, nombre").eq("estado", "ACTIVO").order("hora_entrada", { ascending: true }),
    supabase.from("personas").select("id_persona, nombre, apellido, id_horario, tipo").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
  ]);
  return {
    turnos: (horarios.data ?? []).map((h) => ({ id: h.id_horario as string, nombre: h.nombre as string })),
    personas: (personas.data ?? [])
      .filter((p) => p.tipo !== "EXTERNO")
      .map((p) => ({ id: p.id_persona as string, nombre: [p.nombre, p.apellido].filter(Boolean).join(" "), idHorario: (p.id_horario as string | null) ?? null })),
  };
}

function vista(t: TareaFila, equipo: EquipoTareas, hechas: Map<string, { nombre: string | null; hecho_en: string }>, hoy = fechaHoraArgentina()): TareaVista {
  const para =
    t.para_tipo === "TURNO"
      ? equipo.turnos.find((x) => x.id === t.id_horario)?.nombre ?? "Un turno"
      : t.para_tipo === "PERSONA"
        ? equipo.personas.find((x) => x.id === t.id_persona)?.nombre ?? "Una persona"
        : "Todo el equipo";
  const fecha = fechaQueToca(t, hoy);
  // "todos los lunes" pero "todos los sábados": solo sábado y domingo llevan s.
  const cuando = t.repite_dia ? `Todos los ${DIAS[t.repite_dia - 1]}${t.repite_dia >= 6 ? "s" : ""}` : t.vence ? `Para el ${diaDe(t.vence)} ${ddmm(t.vence)}` : "Cuando puedas";
  const h = t.repite_dia ? hechas.get(`${t.id_tarea}|${fecha}`) : hechas.get(t.id_tarea);
  const situacion = h ? "HECHA" : (t.repite_dia || t.vence) && fecha < hoy.fecha ? "VENCIDA" : "PENDIENTE";
  return {
    id: t.id_tarea,
    titulo: t.titulo,
    detalle: t.detalle,
    motivo: t.motivo,
    propuestaPor: t.propuesta_por,
    idMensaje: t.id_mensaje,
    estadoTarea: t.estado,
    paraTipo: t.para_tipo,
    idHorario: t.id_horario,
    idPersona: t.id_persona,
    vence: t.vence,
    repiteDia: t.repite_dia,
    para,
    cuando,
    fecha,
    situacion,
    hecha: h
      ? (() => {
          const f = fechaHoraArgentina(h.hecho_en);
          return { nombre: h.nombre ?? "Alguien del equipo", hora: `${diaDe(f.fecha)} ${f.hora}`, el: f.fecha };
        })()
      : null,
  };
}

/**
 * Cuándo se hizo cada una. Las que se repiten se buscan por tarea y día
 * ("tarea|2026-10-30"); las de una sola vez, por tarea sola: una vez hecha,
 * queda hecha aunque se haya hecho otro día.
 */
async function hechasDe(supabase: SupabaseClient, ids: string[]) {
  const mapa = new Map<string, { nombre: string | null; hecho_en: string }>();
  if (!ids.length) return mapa;
  const { data } = await supabase.from("tareas_equipo_hechas").select("id_tarea, fecha, nombre, hecho_en").in("id_tarea", ids);
  for (const h of data ?? []) {
    const fila = { nombre: h.nombre as string | null, hecho_en: h.hecho_en as string };
    mapa.set(`${h.id_tarea}|${h.fecha}`, fila);
    mapa.set(h.id_tarea as string, fila);
  }
  return mapa;
}

/** Para la Junta: lo que espera aprobación, lo activo y lo que se propuso en el chat. */
export async function tareasParaJunta(supabase: SupabaseClient): Promise<{ tareas: TareaVista[]; equipo: EquipoTareas; faltaSql: boolean }> {
  const equipo = await equipoParaTareas(supabase);
  const { data, error } = await supabase.from("tareas_equipo").select("*").order("creado", { ascending: false }).limit(300);
  if (error) return { tareas: [], equipo, faltaSql: faltaTabla(error.message) };
  const filas = (data ?? []) as TareaFila[];
  const hechas = await hechasDe(supabase, filas.filter((t) => t.estado === "ACTIVA").map((t) => t.id_tarea));
  return { tareas: filas.map((t) => vista(t, equipo, hechas)), equipo, faltaSql: false };
}

/** Para Mis Tareas: las activas que le tocan a este usuario (por él, por su turno o para todos). */
export async function tareasDeUsuario(supabase: SupabaseClient, idUsuario: string): Promise<TareaVista[]> {
  const { data: usuario } = await supabase.from("usuarios").select("id_persona").eq("id_usuario", idUsuario).maybeSingle();
  const idPersona = (usuario?.id_persona as string | null) ?? null;
  const equipo = await equipoParaTareas(supabase);
  const idHorario = idPersona ? equipo.personas.find((p) => p.id === idPersona)?.idHorario ?? null : null;
  const { data, error } = await supabase.from("tareas_equipo").select("*").eq("estado", "ACTIVA");
  if (error) return [];
  const propias = ((data ?? []) as TareaFila[]).filter(
    (t) => t.para_tipo === "TODOS" || (t.para_tipo === "TURNO" && t.id_horario === idHorario) || (t.para_tipo === "PERSONA" && t.id_persona === idPersona)
  );
  const hechas = await hechasDe(supabase, propias.map((t) => t.id_tarea));
  const hoy = fechaHoraArgentina();
  return (
    propias
      .map((t) => vista(t, equipo, hechas, hoy))
      // Las de una sola vez ya hechas se ven solo el día que se hicieron.
      .filter((t) => !(t.situacion === "HECHA" && !t.repiteDia && t.hecha && t.hecha.el < hoy.fecha))
      .sort((a, b) => (a.situacion === "HECHA" ? 1 : 0) - (b.situacion === "HECHA" ? 1 : 0) || a.fecha.localeCompare(b.fecha))
  );
}

/** Lo que propone un encargado, ya traducido a quién va (por nombre de turno o de persona). */
export function resolverPara(para: string | undefined, equipo: EquipoTareas): Pick<TareaFila, "para_tipo" | "id_horario" | "id_persona"> {
  const limpio = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^turno\s+/, "").trim();
  const buscado = limpio(para ?? "");
  if (buscado && !/^(todos|todo el equipo|equipo|el equipo)$/.test(buscado)) {
    const turno = equipo.turnos.find((t) => limpio(t.nombre) === buscado || limpio(t.nombre).includes(buscado));
    if (turno) return { para_tipo: "TURNO", id_horario: turno.id, id_persona: null };
    const persona = equipo.personas.find((p) => limpio(p.nombre) === buscado || limpio(p.nombre).startsWith(buscado));
    if (persona) return { para_tipo: "PERSONA", id_horario: null, id_persona: persona.id };
  }
  return { para_tipo: "TODOS", id_horario: null, id_persona: null };
}

/** El día de la semana que propone un encargado ("viernes") a número ISO. */
export function diaDeTexto(texto: string | undefined | null) {
  if (!texto) return null;
  const t = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const i = DIAS.findIndex((d) => t.startsWith(d.normalize("NFD").replace(/[̀-ͯ]/g, "").slice(0, 3)));
  return i >= 0 ? i + 1 : null;
}
