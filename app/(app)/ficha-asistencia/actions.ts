"use server";

import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

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

export type EstadoFicha = {
  persona: { nombre: string; apellido: string | null } | null;
  horario: { nombre: string; hora_entrada: string; tolerancia_minutos: number } | null;
  siguienteTipo: "ENTRADA" | "SALIDA";
  sinPersonaVinculada: boolean;
};

// El usuario que ficha tiene que estar vinculado a una Persona en
// Organización (usuarios.id_persona) — si no, no hay a quién asociarle la
// marcación ni contra qué horario compararla.
export async function obtenerEstadoFicha(): Promise<EstadoFicha> {
  const persona = await personaActual();
  if (!persona) return { persona: null, horario: null, siguienteTipo: "ENTRADA", sinPersonaVinculada: true };

  const supabase = getSupabaseServerClient();
  let horario: { nombre: string; hora_entrada: string; tolerancia_minutos: number } | null = null;
  if (persona.id_horario) {
    const { data } = await supabase
      .from("horarios_trabajo")
      .select("nombre, hora_entrada, tolerancia_minutos")
      .eq("id_horario", persona.id_horario as string)
      .maybeSingle();
    horario = data as typeof horario;
  }

  // Se trae el último fichaje sin importar cuándo, y se compara la fecha en
  // JS (no con un rango gte/lte en la consulta) — más simple y sin
  // ambigüedad de con qué huso horario Postgres interpreta un string de
  // fecha sin "Z".
  const { data: ultimoFichaje } = await supabase
    .from("fichajes")
    .select("tipo, fecha_hora")
    .eq("id_persona", persona.id_persona as string)
    .order("fecha_hora", { ascending: false })
    .limit(1)
    .maybeSingle();

  const hoy = new Date().toISOString().slice(0, 10);
  const esDeHoy = !!ultimoFichaje && (ultimoFichaje.fecha_hora as string).slice(0, 10) === hoy;

  return {
    persona: { nombre: persona.nombre as string, apellido: persona.apellido as string | null },
    horario,
    siguienteTipo: esDeHoy && ultimoFichaje!.tipo === "ENTRADA" ? "SALIDA" : "ENTRADA",
    sinPersonaVinculada: false,
  };
}

export type ResultadoFichaje = {
  error: string | null;
  nombre?: string;
  tipo?: "ENTRADA" | "SALIDA";
  estado?: "A_TIEMPO" | "TARDE" | "ANTICIPADA" | "SIN_HORARIO";
  minutos?: number;
  turnoAbiertoLocal?: string | null;
};

// El fichaje se registra siempre con la hora del servidor (nunca la del
// dispositivo) — es lo que lo vuelve inalterable: nadie puede "atrasar" el
// reloj de la tablet para marcar que llegó a tiempo.
export async function fichar(tipo: "ENTRADA" | "SALIDA"): Promise<ResultadoFichaje> {
  const persona = await personaActual();
  if (!persona) return { error: "Tu usuario no está vinculado a ninguna persona — avisale a administración." };

  const supabase = getSupabaseServerClient();
  const ahora = new Date();

  let horario: { hora_entrada: string; hora_salida: string | null; tolerancia_minutos: number } | null = null;
  if (persona.id_horario) {
    const { data } = await supabase
      .from("horarios_trabajo")
      .select("hora_entrada, hora_salida, tolerancia_minutos")
      .eq("id_horario", persona.id_horario as string)
      .maybeSingle();
    horario = data as typeof horario;
  }

  let estado: "A_TIEMPO" | "TARDE" | "ANTICIPADA" | "SIN_HORARIO" = "SIN_HORARIO";
  let minutos = 0;

  const horaReferencia = horario ? (tipo === "ENTRADA" ? horario.hora_entrada : horario.hora_salida) : null;
  if (horario && horaReferencia) {
    const [h, m] = horaReferencia.split(":").map(Number);
    const referencia = new Date(ahora);
    referencia.setHours(h, m, 0, 0);
    const diffMin = Math.round((ahora.getTime() - referencia.getTime()) / 60000);
    if (tipo === "ENTRADA") {
      estado = diffMin > horario.tolerancia_minutos ? "TARDE" : "A_TIEMPO";
      minutos = estado === "TARDE" ? diffMin : 0;
    } else {
      estado = diffMin < -horario.tolerancia_minutos ? "ANTICIPADA" : "A_TIEMPO";
      minutos = estado === "ANTICIPADA" ? Math.abs(diffMin) : 0;
    }
  }

  const { error } = await supabase.from("fichajes").insert({
    id_persona: persona.id_persona,
    tipo,
    fecha_hora: ahora.toISOString(),
    minutos_diferencia: minutos || null,
    estado,
  });
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

  return { error: null, nombre: persona.nombre as string, tipo, estado, minutos, turnoAbiertoLocal };
}
