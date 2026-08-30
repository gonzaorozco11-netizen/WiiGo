"use server";

import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { fechaHoraArgentina, minutosDeHora } from "@/lib/horarios";

async function personaActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const { data: usuario } = await supabase.from("usuarios").select("id_persona").eq("id_usuario", sesion.sub).maybeSingle();
  if (!usuario?.id_persona) return null;

  const { data: persona } = await supabase
    .from("personas")
    .select("id_persona, nombre, apellido, id_horario")
    .eq("id_persona", usuario.id_persona)
    .maybeSingle();
  if (!persona) return null;
  return { ...persona, nombreSesion: sesion.nombre as string };
}

export type HorarioResumen = {
  id_horario: string;
  nombre: string;
  hora_entrada: string;
  hora_salida: string | null;
  tolerancia_minutos: number;
};

export type EstadoFicha = {
  persona: { nombre: string; apellido: string | null } | null;
  sinPersonaVinculada: boolean;
  siguienteTipo: "ENTRADA" | "SALIDA";
  // Para ENTRADA: lista de horarios activos para elegir, y cuál viene
  // pre-marcado (el suyo, solo si hoy es uno de sus días habituales — si no,
  // no se pre-marca ninguno y ella elige a mano si vino por otro turno).
  horarios: HorarioResumen[];
  idHorarioSugerido: string | null;
  // Para SALIDA: el horario que se usó en la entrada de hoy (no se vuelve a
  // elegir, tiene que ser el mismo para que el par entrada/salida sea
  // coherente).
  horarioDeHoy: HorarioResumen | null;
};

// El usuario que ficha tiene que estar vinculado a una Persona en
// Organización (usuarios.id_persona) — si no, no hay a quién asociarle la
// marcación ni contra qué horario compararla.
export async function obtenerEstadoFicha(): Promise<EstadoFicha> {
  const persona = await personaActual();
  if (!persona) {
    return { persona: null, sinPersonaVinculada: true, siguienteTipo: "ENTRADA", horarios: [], idHorarioSugerido: null, horarioDeHoy: null };
  }

  const supabase = getSupabaseServerClient();
  const { data: horariosData } = await supabase
    .from("horarios_trabajo")
    .select("id_horario, nombre, hora_entrada, hora_salida, tolerancia_minutos, dias_semana")
    .eq("estado", "ACTIVO")
    .order("nombre");
  const horarios = (horariosData ?? []) as (HorarioResumen & { dias_semana: number[] })[];

  // Se trae el último fichaje sin importar cuándo, y se compara la fecha en
  // JS (no con un rango gte/lte en la consulta) — más simple y sin
  // ambigüedad de con qué huso horario Postgres interpreta un string de
  // fecha sin "Z".
  const { data: ultimoFichaje } = await supabase
    .from("fichajes")
    .select("tipo, fecha_hora, id_horario")
    .eq("id_persona", persona.id_persona as string)
    .order("fecha_hora", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ahora = fechaHoraArgentina();
  const esDeHoy = !!ultimoFichaje && fechaHoraArgentina(ultimoFichaje.fecha_hora as string).fecha === ahora.fecha;
  const siguienteTipo: "ENTRADA" | "SALIDA" = esDeHoy && ultimoFichaje!.tipo === "ENTRADA" ? "SALIDA" : "ENTRADA";

  let idHorarioSugerido: string | null = null;
  if (siguienteTipo === "ENTRADA" && persona.id_horario) {
    const asignado = horarios.find((h) => h.id_horario === persona.id_horario);
    if (asignado && asignado.dias_semana.includes(ahora.diaSemanaISO)) idHorarioSugerido = asignado.id_horario;
  }

  let horarioDeHoy: HorarioResumen | null = null;
  if (siguienteTipo === "SALIDA" && ultimoFichaje?.id_horario) {
    horarioDeHoy = horarios.find((h) => h.id_horario === ultimoFichaje.id_horario) ?? null;
  }

  return {
    persona: { nombre: persona.nombre as string, apellido: persona.apellido as string | null },
    sinPersonaVinculada: false,
    siguienteTipo,
    horarios: horarios.map(({ dias_semana: _dias_semana, ...h }) => h),
    idHorarioSugerido,
    horarioDeHoy,
  };
}

export type ResultadoFichaje = {
  error: string | null;
  idFichaje?: string;
  nombre?: string;
  tipo?: "ENTRADA" | "SALIDA";
  estado?: "A_TIEMPO" | "TARDE" | "ANTICIPADA" | "SIN_HORARIO";
  minutos?: number;
  turnoAbiertoLocal?: string | null;
};

// El fichaje se registra siempre con la hora del servidor (nunca la del
// dispositivo) — es lo que lo vuelve inalterable: nadie puede "atrasar" el
// reloj de la tablet para marcar que llegó a tiempo.
//
// idHorarioElegido es el que se ve/elige en pantalla para una ENTRADA (null
// si es un día excepcional y no se eligió ninguno — ahí no se evalúa
// tardanza, solo se registra la hora). Para una SALIDA se ignora: siempre
// se usa el mismo horario que quedó guardado en la entrada de hoy, para que
// el par sea coherente.
export async function fichar(tipo: "ENTRADA" | "SALIDA", idHorarioElegido: string | null): Promise<ResultadoFichaje> {
  const persona = await personaActual();
  if (!persona) return { error: "Tu usuario no está vinculado a ninguna persona — avisale a administración." };

  const supabase = getSupabaseServerClient();
  const ahora = new Date();

  let idHorarioAUsar: string | null = idHorarioElegido;
  if (tipo === "SALIDA") {
    const hoy = fechaHoraArgentina(ahora).fecha;
    const { data: entradaHoy } = await supabase
      .from("fichajes")
      .select("id_horario, fecha_hora")
      .eq("id_persona", persona.id_persona as string)
      .eq("tipo", "ENTRADA")
      .order("fecha_hora", { ascending: false })
      .limit(1)
      .maybeSingle();
    const esDeHoy = !!entradaHoy && fechaHoraArgentina(entradaHoy.fecha_hora as string).fecha === hoy;
    idHorarioAUsar = esDeHoy ? (entradaHoy!.id_horario as string | null) : null;
  }

  let horario: { hora_entrada: string; hora_salida: string | null; tolerancia_minutos: number } | null = null;
  if (idHorarioAUsar) {
    const { data } = await supabase
      .from("horarios_trabajo")
      .select("hora_entrada, hora_salida, tolerancia_minutos")
      .eq("id_horario", idHorarioAUsar)
      .maybeSingle();
    horario = data as typeof horario;
  }

  let estado: "A_TIEMPO" | "TARDE" | "ANTICIPADA" | "SIN_HORARIO" = "SIN_HORARIO";
  let minutos = 0;

  const horaReferencia = horario ? (tipo === "ENTRADA" ? horario.hora_entrada : horario.hora_salida) : null;
  if (horario && horaReferencia) {
    const diffMin = fechaHoraArgentina(ahora).minutosDelDia - minutosDeHora(horaReferencia);
    if (tipo === "ENTRADA") {
      estado = diffMin > horario.tolerancia_minutos ? "TARDE" : "A_TIEMPO";
      minutos = estado === "TARDE" ? diffMin : 0;
    } else {
      estado = diffMin < -horario.tolerancia_minutos ? "ANTICIPADA" : "A_TIEMPO";
      minutos = estado === "ANTICIPADA" ? Math.abs(diffMin) : 0;
    }
  }

  const { data: fichajeCreado, error } = await supabase
    .from("fichajes")
    .insert({
      id_persona: persona.id_persona,
      tipo,
      fecha_hora: ahora.toISOString(),
      minutos_diferencia: minutos || null,
      estado,
      id_horario: idHorarioAUsar,
    })
    .select("id_fichaje")
    .single();
  if (error) return { error: error.message };

  // Recordatorio de caja: si esta persona tiene un turno de caja abierto a
  // su nombre, se lo avisamos justo al fichar la salida — es el momento en
  // que más sentido tiene, antes de que se vaya del local.
  let turnoAbiertoLocal: string | null = null;
  if (tipo === "SALIDA") {
    const { data: turno } = await supabase
      .from("turnos")
      .select("id_local")
      .eq("usuario_apertura", persona.nombreSesion)
      .eq("estado", "ABIERTO")
      .maybeSingle();
    if (turno?.id_local) {
      const { data: local } = await supabase.from("locales").select("nombre").eq("id_local", turno.id_local as string).maybeSingle();
      turnoAbiertoLocal = (local?.nombre as string | undefined) ?? "un local";
    }
  }

  return { error: null, idFichaje: fichajeCreado.id_fichaje as string, nombre: persona.nombre as string, tipo, estado, minutos, turnoAbiertoLocal };
}

// Se llama aparte, después de fichar, para no obligar a escribir el motivo
// antes de que quede registrada la hora — la marcación en sí nunca espera.
export async function guardarMotivoTardanza(idFichaje: string, motivo: string): Promise<{ error: string | null }> {
  const persona = await personaActual();
  if (!persona) return { error: "Tu usuario no está vinculado a ninguna persona." };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("fichajes")
    .update({ motivo: motivo.trim() || null })
    .eq("id_fichaje", idFichaje)
    .eq("id_persona", persona.id_persona as string);
  if (error) return { error: error.message };
  return { error: null };
}

export type AvisoSalida = { debeRecordar: boolean; horaSalida: string | null };

// Se llama desde el layout general (no solo desde Ficha Asistencia) para
// que el aviso le aparezca en cualquier pantalla que esté usando pasada su
// hora de salida — no solo si vuelve a entrar ahí. Solo aplica si la
// entrada de hoy quedó ligada a un horario (si fichó sin elegir ninguno, no
// hay una "hora de salida esperada" contra la cual avisar).
export async function verificarAvisoSalida(): Promise<AvisoSalida> {
  const persona = await personaActual();
  if (!persona) return { debeRecordar: false, horaSalida: null };

  const supabase = getSupabaseServerClient();
  const { data: ultimoFichaje } = await supabase
    .from("fichajes")
    .select("tipo, fecha_hora, id_horario")
    .eq("id_persona", persona.id_persona as string)
    .order("fecha_hora", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ahora = fechaHoraArgentina();
  const yaFichoEntradaHoySinSalida =
    !!ultimoFichaje && fechaHoraArgentina(ultimoFichaje.fecha_hora as string).fecha === ahora.fecha && ultimoFichaje.tipo === "ENTRADA";
  if (!yaFichoEntradaHoySinSalida || !ultimoFichaje?.id_horario) return { debeRecordar: false, horaSalida: null };

  const { data: horario } = await supabase
    .from("horarios_trabajo")
    .select("hora_salida")
    .eq("id_horario", ultimoFichaje.id_horario as string)
    .maybeSingle();
  const horaSalida = horario?.hora_salida as string | undefined;
  if (!horaSalida) return { debeRecordar: false, horaSalida: null };

  const debeRecordar = ahora.minutosDelDia >= minutosDeHora(horaSalida);
  return { debeRecordar, horaSalida: horaSalida.slice(0, 5) };
}
