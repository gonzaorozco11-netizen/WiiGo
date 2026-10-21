"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { fechaHoraArgentina, minutosDeHora } from "@/lib/horarios";
import { calcularPresentismoMes } from "@/app/(app)/rrhh/actions";

// Asistencia: la grilla del mes, persona por día.
//
// Cada empleado tiene uno de tres horarios:
//   - FIJO: un horario de trabajo (días y horas). Se le controlan
//     tardanzas, faltas y salidas antes de hora.
//   - LIBRE: no tiene días ni horario fijos (personas.horario_libre). Si
//     ficha, se le cuentan las horas; no hay tardanzas ni faltas.
//   - SIN: todavía no se eligió. Es un pendiente, no una decisión.
//
// Solo empleados: los externos (tercerizados) y los socios no fichan.

async function requireAcceso() {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return "No tenés permiso para hacer esto.";
  return null;
}

export type EstadoCelda = "ok" | "tarde" | "falta" | "sin_salida" | "en_curso" | "lic" | "feriado" | "no_trabaja" | "flex" | "vacio" | "futuro";

export type CeldaAsistencia = {
  estado: EstadoCelda;
  horas: number | null;
  entrada: string | null;
  salida: string | null;
};

export type HorarioPersona = { tipo: "FIJO" | "LIBRE" | "SIN"; idHorario: string | null; texto: string };

export type FilaAsistencia = {
  idPersona: string;
  nombre: string;
  cobra: "POR_HORA" | "FIJO" | "SIN";
  horario: HorarioPersona;
  celdas: CeldaAsistencia[];
  horas: number;
  tardanzas: number | null;
  faltas: number | null;
  presentismo: { texto: string; tono: "bien" | "ojo" | "mal" | "gris" };
};

export type AsistenciaMes = {
  periodo: string;
  diasDelMes: number;
  /** Día de hoy si el mes es el actual; null para meses pasados. */
  hoy: number | null;
  /** Día de la semana ISO (1 lunes … 7 domingo) de cada día del mes. */
  diaSemana: number[];
  feriados: Record<number, string>;
  filas: FilaAsistencia[];
  sinSalida: { idPersona: string; nombre: string; fecha: string; horaEntrada: string; horaSalidaEsperada: string | null }[];
  hoyNoFicho: string[];
  sinDefinir: string[];
  ahora: { turno: string | null; trabajando: { nombre: string; desde: string }[] } | null;
  horarios: { idHorario: string; nombre: string; texto: string }[];
  faltaSql: boolean;
};

const hhmm = (t: string | null | undefined) => (t ?? "").slice(0, 5);
const corto = (t: string | null | undefined) => hhmm(t).replace(/^0/, "");
const DIAS = ["", "L", "M", "M", "J", "V", "S", "D"];

function textoDias(dias: number[] | null) {
  const d = [...(dias ?? [])].sort();
  if (d.join() === "1,2,3,4,5,6") return "L a S";
  if (d.join() === "1,2,3,4,5") return "L a V";
  if (d.join() === "1,2,3,4,5,6,7") return "todos los días";
  return d.map((x) => DIAS[x]).join(" ");
}

export async function armarAsistenciaMes(periodoPedido?: string): Promise<AsistenciaMes> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const ahora = fechaHoraArgentina();
  const periodoActual = ahora.fecha.slice(0, 7);
  const periodo = periodoPedido && /^\d{4}-\d{2}$/.test(periodoPedido) ? periodoPedido : periodoActual;
  const [anio, mes] = periodo.split("-").map(Number);
  const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const esActual = periodo === periodoActual;
  const esFuturo = periodo > periodoActual;
  const hoyDia = esActual ? Number(ahora.fecha.slice(8, 10)) : null;
  const desde = `${periodo}-01`;
  const hasta = `${periodo}-${String(diasDelMes).padStart(2, "0")}`;
  const fechaDe = (d: number) => `${periodo}-${String(d).padStart(2, "0")}`;
  const diaSemana = Array.from({ length: diasDelMes }, (_, i) => {
    const dow = new Date(Date.UTC(anio, mes - 1, i + 1)).getUTCDay();
    return dow === 0 ? 7 : dow;
  });

  const [personasRes, usuariosRes, horariosRes, fichajesRes, licenciasRes, feriadosRes, presentismo] = await Promise.all([
    supabase.from("personas").select("*").eq("estado", "ACTIVO").eq("tipo", "EMPLEADO").order("nombre", { ascending: true }),
    supabase.from("usuarios").select("id_persona, sueldo_base, valor_hora").eq("estado", "ACTIVO"),
    supabase.from("horarios_trabajo").select("id_horario, nombre, hora_entrada, hora_salida, dias_semana, tolerancia_minutos").eq("estado", "ACTIVO"),
    supabase
      .from("fichajes")
      .select("id_persona, tipo, fecha_hora, estado, justificado")
      .gte("fecha_hora", `${desde}T00:00:00-03:00`)
      .lte("fecha_hora", `${hasta}T23:59:59-03:00`)
      .order("fecha_hora", { ascending: true }),
    supabase.from("licencias").select("id_persona, fecha_desde, fecha_hasta").lte("fecha_desde", hasta).gte("fecha_hasta", desde),
    supabase.from("feriados").select("fecha, nombre").gte("fecha", desde).lte("fecha", hasta),
    esFuturo ? Promise.resolve([]) : calcularPresentismoMes(periodo),
  ]);
  if (personasRes.error) throw new Error(friendlyDbError(personasRes.error));

  const personas = personasRes.data ?? [];
  const faltaSql = personas.length > 0 && !("horario_libre" in personas[0]);
  const usuarioPorPersona = new Map((usuariosRes.data ?? []).filter((u) => u.id_persona).map((u) => [u.id_persona as string, u]));
  const horarios = horariosRes.data ?? [];
  const horarioPorId = new Map(horarios.map((h) => [h.id_horario as string, h]));
  const feriados: Record<number, string> = {};
  for (const f of feriadosRes.data ?? []) feriados[Number((f.fecha as string).slice(8, 10))] = f.nombre as string;
  const presentismoPorPersona = new Map(presentismo.map((p) => [p.idPersona, p]));

  // Fichajes por persona y día (hora argentina): la primera entrada y la
  // última salida del día.
  type Dia = { entrada?: string; salida?: string; tarde?: boolean };
  const fichajesPor = new Map<string, Map<number, Dia>>();
  for (const f of fichajesRes.data ?? []) {
    const arg = fechaHoraArgentina(f.fecha_hora as string);
    if (arg.fecha.slice(0, 7) !== periodo) continue;
    const d = Number(arg.fecha.slice(8, 10));
    const porDia = fichajesPor.get(f.id_persona as string) ?? new Map<number, Dia>();
    const dia = porDia.get(d) ?? {};
    if (f.tipo === "ENTRADA" && !dia.entrada) {
      dia.entrada = arg.hora;
      dia.tarde = f.estado === "TARDE" && !f.justificado;
    }
    if (f.tipo === "SALIDA") dia.salida = arg.hora;
    porDia.set(d, dia);
    fichajesPor.set(f.id_persona as string, porDia);
  }

  const licenciaPor = new Map<string, Set<number>>();
  for (const l of licenciasRes.data ?? []) {
    const set = licenciaPor.get(l.id_persona as string) ?? new Set<number>();
    for (let d = 1; d <= diasDelMes; d++) {
      const f = fechaDe(d);
      if (f >= (l.fecha_desde as string) && f <= (l.fecha_hasta as string)) set.add(d);
    }
    licenciaPor.set(l.id_persona as string, set);
  }

  const sinSalida: AsistenciaMes["sinSalida"] = [];
  const hoyNoFicho: string[] = [];
  const sinDefinir: string[] = [];
  const trabajandoAhora: { nombre: string; desde: string }[] = [];

  const filas: FilaAsistencia[] = personas.map((p) => {
    const idPersona = p.id_persona as string;
    const nombre = [p.nombre, p.apellido].filter(Boolean).join(" ");
    const u = usuarioPorPersona.get(idPersona);
    const cobra: FilaAsistencia["cobra"] = (u?.valor_hora as number) > 0 ? "POR_HORA" : (u?.sueldo_base as number) > 0 ? "FIJO" : "SIN";
    const h = p.id_horario ? horarioPorId.get(p.id_horario as string) : undefined;
    const horario: HorarioPersona = h
      ? { tipo: "FIJO", idHorario: h.id_horario as string, texto: `${h.nombre} · ${corto(h.hora_entrada as string)} a ${corto(h.hora_salida as string)} · ${textoDias(h.dias_semana as number[])}` }
      : (p as Record<string, unknown>).horario_libre === true
        ? { tipo: "LIBRE", idHorario: null, texto: "Horario libre" }
        : { tipo: "SIN", idHorario: null, texto: "Horario sin definir" };
    if (horario.tipo === "SIN") sinDefinir.push(nombre);

    const porDia = fichajesPor.get(idPersona) ?? new Map<number, Dia>();
    const licencia = licenciaPor.get(idPersona) ?? new Set<number>();
    let horas = 0;
    let tardanzas = 0;
    let faltas = 0;

    const celdas: CeldaAsistencia[] = diaSemana.map((dow, i) => {
      const d = i + 1;
      const fichaje = porDia.get(d);
      const pasado = esFuturo ? false : hoyDia === null || d < hoyDia;
      const esHoy = hoyDia === d;
      if (esFuturo || (hoyDia !== null && d > hoyDia)) return { estado: "futuro", horas: null, entrada: null, salida: null };
      if (licencia.has(d)) return { estado: "lic", horas: null, entrada: fichaje?.entrada ?? null, salida: fichaje?.salida ?? null };
      if (fichaje?.entrada) {
        let horasDia: number | null = null;
        if (fichaje.salida) {
          horasDia = Math.max(0, Math.round(((minutosDeHora(fichaje.salida) - minutosDeHora(fichaje.entrada)) / 60) * 10) / 10);
          horas += horasDia;
        }
        if (!fichaje.salida) {
          if (pasado) {
            sinSalida.push({ idPersona, nombre, fecha: fechaDe(d), horaEntrada: fichaje.entrada, horaSalidaEsperada: h ? hhmm(h.hora_salida as string) : null });
            return { estado: "sin_salida", horas: null, entrada: fichaje.entrada, salida: null };
          }
          if (esHoy) trabajandoAhora.push({ nombre, desde: fichaje.entrada });
          return { estado: "en_curso", horas: null, entrada: fichaje.entrada, salida: null };
        }
        if (horario.tipo !== "FIJO") return { estado: "flex", horas: horasDia, entrada: fichaje.entrada, salida: fichaje.salida ?? null };
        if (fichaje.tarde) tardanzas += 1;
        return { estado: fichaje.tarde ? "tarde" : "ok", horas: horasDia, entrada: fichaje.entrada, salida: fichaje.salida ?? null };
      }
      if (horario.tipo !== "FIJO" || !h) return { estado: "vacio", horas: null, entrada: null, salida: null };
      const trabaja = ((h.dias_semana as number[] | null) ?? []).includes(dow);
      if (!trabaja) return { estado: "no_trabaja", horas: null, entrada: null, salida: null };
      if (feriados[d]) return { estado: "feriado", horas: null, entrada: null, salida: null };
      if (esHoy) {
        // Hoy: si ya pasó la hora de entrada más la tolerancia, no fichó.
        const limite = minutosDeHora(h.hora_entrada as string) + ((h.tolerancia_minutos as number) ?? 0);
        if (ahora.minutosDelDia > limite) hoyNoFicho.push(nombre);
        return { estado: "vacio", horas: null, entrada: null, salida: null };
      }
      faltas += 1;
      return { estado: "falta", horas: null, entrada: null, salida: null };
    });

    const cobraPresentismo = cobra !== "SIN";
    let presentismoTexto: FilaAsistencia["presentismo"];
    if (horario.tipo === "SIN") presentismoTexto = { texto: "Sin definir", tono: "ojo" };
    else if (!cobraPresentismo) presentismoTexto = { texto: "No cobra", tono: "gris" };
    else if (horario.tipo === "LIBRE") presentismoTexto = { texto: "Completo · libre", tono: "bien" };
    else {
      const r = presentismoPorPersona.get(idPersona)?.resultado ?? "COMPLETO";
      presentismoTexto =
        r === "COMPLETO" ? { texto: "Completo", tono: "bien" } : r === "PARCIAL" ? { texto: "Parcial", tono: "ojo" } : { texto: "Perdido", tono: "mal" };
    }

    return {
      idPersona,
      nombre,
      cobra,
      horario,
      celdas,
      horas: Math.round(horas * 10) / 10,
      tardanzas: horario.tipo === "FIJO" ? tardanzas : null,
      faltas: horario.tipo === "FIJO" ? faltas : null,
      presentismo: presentismoTexto,
    };
  });

  const turnoAhora = esActual
    ? horarios.find(
        (h) =>
          ((h.dias_semana as number[] | null) ?? []).includes(ahora.diaSemanaISO) &&
          ahora.minutosDelDia >= minutosDeHora(h.hora_entrada as string) &&
          ahora.minutosDelDia < minutosDeHora(h.hora_salida as string)
      )
    : undefined;

  return {
    periodo,
    diasDelMes,
    hoy: hoyDia,
    diaSemana,
    feriados,
    filas,
    sinSalida: sinSalida.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    hoyNoFicho,
    sinDefinir,
    ahora: esActual
      ? { turno: turnoAhora ? `${turnoAhora.nombre} · ${corto(turnoAhora.hora_entrada as string)} a ${corto(turnoAhora.hora_salida as string)}` : null, trabajando: trabajandoAhora }
      : null,
    horarios: [...horarios]
      .sort((a, b) => minutosDeHora(a.hora_entrada as string) - minutosDeHora(b.hora_entrada as string))
      .map((h) => ({
        idHorario: h.id_horario as string,
        nombre: h.nombre as string,
        texto: `${corto(h.hora_entrada as string)} a ${corto(h.hora_salida as string)} · ${textoDias(h.dias_semana as number[])}`,
      })),
    faltaSql,
  };
}

export type SueldoSinPagar = { idPersona: string; nombre: string; periodo: string; etiquetaMes: string; neto: number };

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Sueldos de meses anteriores que ya se cerraron pero todavía no se pagaron. */
export async function sueldosSinPagarAnteriores(periodo: string): Promise<SueldoSinPagar[]> {
  const permisoError = await requireAcceso();
  if (permisoError) return [];
  const supabase = getSupabaseServerClient();
  const { data: cierres } = await supabase
    .from("nomina_cierres")
    .select("id_persona, periodo, neto_a_pagar")
    .eq("estado", "PENDIENTE_PAGO")
    .eq("es_estimado", false)
    .lt("periodo", periodo)
    .order("periodo", { ascending: true });
  if (!cierres || cierres.length === 0) return [];
  const ids = [...new Set(cierres.map((c) => c.id_persona as string))];
  const { data: personas } = await supabase.from("personas").select("id_persona, nombre, apellido").in("id_persona", ids);
  const nombrePor = new Map((personas ?? []).map((p) => [p.id_persona as string, [p.nombre, p.apellido].filter(Boolean).join(" ")]));
  return cierres.map((c) => {
    const [a, m] = (c.periodo as string).split("-").map(Number);
    return {
      idPersona: c.id_persona as string,
      nombre: nombrePor.get(c.id_persona as string) ?? "—",
      periodo: c.periodo as string,
      etiquetaMes: `${MESES[m - 1] ?? ""} ${a}`,
      neto: Number(c.neto_a_pagar ?? 0),
    };
  });
}

/**
 * Elige el horario de una persona: un horario fijo (su id), "LIBRE" o ""
 * (sin definir). Se usa desde Asistencia → Reglas y desde la ficha.
 */
export async function asignarHorarioPersona(idPersona: string, valor: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const libre = valor === "LIBRE";
  const idHorario = libre || !valor ? null : valor;
  const { error } = await supabase.from("personas").update({ id_horario: idHorario, horario_libre: libre }).eq("id_persona", idPersona);
  if (error) {
    if (/horario_libre/.test(error.message)) {
      if (libre) return { error: "Falta correr sql/personas-horario-libre.sql en Supabase para poder elegir horario libre." };
      // Sin la columna nueva, un horario fijo o "sin definir" se puede guardar igual.
      const { error: e2 } = await supabase.from("personas").update({ id_horario: idHorario }).eq("id_persona", idPersona);
      if (e2) return { error: friendlyDbError(e2) };
    } else return { error: friendlyDbError(error) };
  }
  revalidatePath("/rrhh");
  return { error: null };
}
