import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina } from "@/lib/horarios";

// Quién trabajó hoy en el local y quién está ahora, para el inicio del Dueño
// (Gonzalo, 2026-11-12: «no me figura que Tomás está en turno»). Sale de los
// fichajes de hoy y de las cajas abiertas.

export type PersonaHoy = {
  nombre: string;
  /** Su último fichaje de hoy es una entrada. */
  adentro: boolean;
  /** El turno con el que entró la última vez, o «Hora puntual». */
  turno: string;
  /** Hora de la última entrada (HH:MM). */
  entro: string;
  /** Hora de la última salida, si ya se fue. */
  salio: string | null;
  /** La última entrada fue tarde. */
  tarde: boolean;
  minutosTarde: number;
  /** Tiene una caja abierta a su nombre. */
  cajaAbierta: boolean;
  /** Horas trabajadas hoy, sumando cada tramo (el abierto, hasta ahora). */
  horas: number;
  /** Lo que lleva desde la última entrada (o desde que arrancó su turno, si llegó antes), si está adentro. */
  horasTramo: number;
  /** Llegó antes y todavía no arrancó su turno: las horas empiezan a correr a esta hora. */
  arrancaA: string | null;
};

export type EquipoHoy = { personas: PersonaHoy[]; cajasAbiertas: number };

export async function equipoDeHoy(supabase: SupabaseClient): Promise<EquipoHoy> {
  const hoy = fechaHoraArgentina().fecha;
  const desde = new Date(`${hoy}T00:00:00-03:00`).toISOString();
  const [{ data: fichajes }, { data: cajas }, { data: horarios }] = await Promise.all([
    supabase
      .from("fichajes")
      .select("id_persona, tipo, fecha_hora, estado, minutos_diferencia, id_horario, personas(nombre, apellido)")
      .gte("fecha_hora", desde)
      .order("fecha_hora", { ascending: true }),
    supabase.from("turnos").select("id_usuario_apertura").eq("estado", "ABIERTO"),
    supabase.from("horarios_trabajo").select("id_horario, nombre, hora_entrada"),
  ]);
  const idsUsuarioCaja = (cajas ?? []).map((c) => c.id_usuario_apertura as string | null).filter((x): x is string => Boolean(x));
  const { data: usuarios } = idsUsuarioCaja.length
    ? await supabase.from("usuarios").select("id_persona").in("id_usuario", idsUsuarioCaja)
    : { data: [] as { id_persona: string | null }[] };
  const conCaja = new Set((usuarios ?? []).map((u) => u.id_persona as string | null).filter(Boolean));
  const nombreHorario = new Map((horarios ?? []).map((h) => [h.id_horario as string, h.nombre as string]));
  const inicioHorario = new Map((horarios ?? []).map((h) => [h.id_horario as string, h.hora_entrada as string]));
  // Llegar antes del turno no suma (lib/tramos.ts): la entrada cuenta desde que arranca su turno.
  const desdeQueCuenta = (f: { fecha_hora: string; id_horario: string | null }) => {
    const real = new Date(f.fecha_hora).getTime();
    const inicio = f.id_horario ? inicioHorario.get(f.id_horario) : null;
    if (!inicio) return real;
    const [h, m] = inicio.split(":").map(Number);
    const enTurno = new Date(`${fechaHoraArgentina(f.fecha_hora).fecha}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-03:00`).getTime();
    return Math.max(real, enTurno);
  };
  const hora = (iso: string) => fechaHoraArgentina(iso).hora;

  type F = { id_persona: string; tipo: string; fecha_hora: string; estado: string | null; minutos_diferencia: number | null; id_horario: string | null; personas: { nombre: string | null; apellido: string | null } | null };
  const porPersona = new Map<string, F[]>();
  for (const f of (fichajes ?? []) as unknown as F[]) porPersona.set(f.id_persona, [...(porPersona.get(f.id_persona) ?? []), f]);

  const ahora = Date.now();
  const personas: PersonaHoy[] = [];
  for (const [idPersona, lista] of porPersona) {
    const entradas = lista.filter((f) => f.tipo === "ENTRADA");
    const ultimaEntrada = entradas[entradas.length - 1];
    if (!ultimaEntrada) continue;
    const ultimo = lista[lista.length - 1];
    const adentro = ultimo.tipo === "ENTRADA";
    // Cada entrada con su salida; si no salió, el tramo corre hasta ahora.
    let ms = 0;
    let abierta: number | null = null;
    for (const f of lista) {
      const t = new Date(f.fecha_hora).getTime();
      if (f.tipo === "ENTRADA") abierta = desdeQueCuenta(f);
      else if (f.tipo === "SALIDA" && abierta != null) {
        ms += Math.max(0, t - abierta);
        abierta = null;
      }
    }
    const tramo = abierta != null ? Math.max(0, ahora - abierta) : 0;
    ms += tramo;
    const p = ultimaEntrada.personas;
    personas.push({
      nombre: [p?.nombre, p?.apellido].filter(Boolean).join(" ") || "Sin nombre",
      adentro,
      turno: ultimaEntrada.id_horario ? (nombreHorario.get(ultimaEntrada.id_horario) ?? "Turno") : "Hora puntual",
      entro: hora(ultimaEntrada.fecha_hora),
      salio: adentro ? null : hora(ultimo.fecha_hora),
      tarde: ultimaEntrada.estado === "TARDE",
      minutosTarde: Math.max(0, Number(ultimaEntrada.minutos_diferencia ?? 0)),
      cajaAbierta: conCaja.has(idPersona),
      horas: Math.round((ms / 3_600_000) * 100) / 100,
      horasTramo: Math.round((tramo / 3_600_000) * 100) / 100,
      arrancaA: adentro && abierta != null && abierta > ahora ? hora(new Date(abierta).toISOString()) : null,
    });
  }
  // Primero los que están adentro, y dentro de cada grupo por hora de entrada.
  personas.sort((a, b) => Number(b.adentro) - Number(a.adentro) || a.entro.localeCompare(b.entro));
  return { personas, cajasAbiertas: (cajas ?? []).length };
}
