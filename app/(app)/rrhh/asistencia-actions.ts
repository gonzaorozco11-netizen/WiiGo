"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { fechaHoraArgentina, minutosDeHora } from "@/lib/horarios";
import { calcularPresentismoMes, obtenerNovedadesMes } from "@/app/(app)/rrhh/actions";
import { armarTramos, horasDeTramos, quedoSinSalida, type MarcaDia, type Tramo } from "@/lib/tramos";
import { EMISOR } from "@/lib/emisor";

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
  /** Si fichó más de un turno ese día: "9:00 a 13:00", "17:00 a 21:00". */
  tramos?: string[];
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

  // Fichajes por persona y día (hora argentina), armados en tramos: cada
  // entrada con su salida. Con dos turnos el mismo día se suman los dos
  // tramos, no se cuenta de la primera entrada a la última salida.
  type Dia = { entrada?: string; salida?: string; tardes: number; horas: number | null; abierto: string | null; tramos: string[] };
  const marcasPor = new Map<string, Map<number, MarcaDia<{ tarde: boolean }>[]>>();
  for (const f of fichajesRes.data ?? []) {
    const arg = fechaHoraArgentina(f.fecha_hora as string);
    if (arg.fecha.slice(0, 7) !== periodo) continue;
    const d = Number(arg.fecha.slice(8, 10));
    const porDia = marcasPor.get(f.id_persona as string) ?? new Map<number, MarcaDia<{ tarde: boolean }>[]>();
    const marcas = porDia.get(d) ?? [];
    marcas.push({ tipo: f.tipo as string, hora: arg.hora, dato: { tarde: f.tipo === "ENTRADA" && f.estado === "TARDE" && !f.justificado } });
    porDia.set(d, marcas);
    marcasPor.set(f.id_persona as string, porDia);
  }
  const fichajesPor = new Map<string, Map<number, Dia>>();
  for (const [idPersona, porDia] of marcasPor) {
    const dias = new Map<number, Dia>();
    for (const [d, marcas] of porDia) {
      const tramos = armarTramos(marcas);
      const conEntrada = tramos.filter((t) => t.entrada);
      const ultimo = tramos[tramos.length - 1];
      dias.set(d, {
        entrada: conEntrada[0]?.entrada?.hora,
        salida: [...tramos].reverse().find((t) => t.salida)?.salida?.hora,
        tardes: conEntrada.filter((t) => t.entrada?.dato.tarde).length,
        horas: horasDeTramos(tramos),
        abierto: quedoSinSalida(tramos) ? ultimo.entrada!.hora : null,
        tramos: tramos.filter((t) => t.entrada).map((t) => `${t.entrada!.hora} a ${t.salida?.hora ?? "—"}`),
      });
    }
    fichajesPor.set(idPersona, dias);
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
        // La llegada tarde cuenta aunque después no haya fichado la salida
        // (igual que en el presentismo y en la planilla). Con dos turnos,
        // cuenta cada entrada tarde.
        if (horario.tipo === "FIJO") tardanzas += fichaje.tardes;
        const horasDia = fichaje.horas;
        if (horasDia !== null) horas += horasDia;
        const tramos = fichaje.tramos.length > 1 ? fichaje.tramos : undefined;
        if (fichaje.abierto) {
          if (pasado) {
            sinSalida.push({ idPersona, nombre, fecha: fechaDe(d), horaEntrada: fichaje.abierto, horaSalidaEsperada: h ? hhmm(h.hora_salida as string) : null });
            return { estado: "sin_salida", horas: horasDia, entrada: fichaje.entrada, salida: null, tramos };
          }
          if (esHoy) trabajandoAhora.push({ nombre, desde: fichaje.abierto });
          return { estado: "en_curso", horas: horasDia, entrada: fichaje.entrada, salida: null, tramos };
        }
        const horasRedondeadas = horasDia === null ? null : Math.round(horasDia * 10) / 10;
        if (horario.tipo !== "FIJO") return { estado: "flex", horas: horasRedondeadas, entrada: fichaje.entrada, salida: fichaje.salida ?? null, tramos };
        return { estado: fichaje.tardes > 0 ? "tarde" : "ok", horas: horasRedondeadas, entrada: fichaje.entrada, salida: fichaje.salida ?? null, tramos };
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

// ===================== PLANILLA PARA IMPRIMIR =====================
//
// La planilla de asistencia del mes, una hoja por operativo (los que tienen
// horario fijo). Día por día: entrada y salida con la firma que hizo al
// fichar, horas, y qué pasó ese día. Abajo, lo que lleva ganado, con la
// misma cuenta que Sueldos (obtenerNovedadesMes), así los números coinciden.

export type MarcaPlanilla = { hora: string; firma: string | null; manual: boolean };

export type DiaPlanilla = {
  fecha: string;
  dia: number;
  diaSemana: number;
  /** Cada turno del día: entrada y salida con su firma. Casi siempre uno; dos si hizo doble turno. */
  tramos: { entrada: MarcaPlanilla | null; salida: MarcaPlanilla | null }[];
  horas: number | null;
  tipo: "trabajo" | "tarde" | "falta" | "lic" | "feriado" | "no_trabaja" | "sin_salida" | "en_curso" | "futuro";
  obs: string;
};

export type PlanillaPersona = {
  idPersona: string;
  nombre: string;
  puesto: string | null;
  dni: string | null;
  cuil: string | null;
  fechaIngreso: string | null;
  horario: string;
  dias: string;
  filas: DiaPlanilla[];
  totales: { horas: number; diasTrabajados: number; diasEsperados: number; tardanzas: number; faltas: number; salidasAntes: number; sinFirma: number };
  presentismo: string;
  ganado: {
    porHora: boolean;
    valorHora: number;
    sueldoFijo: number;
    horas: number;
    horasFeriado: number;
    base: number;
    presentismo: number;
    cobraPresentismo: boolean;
    adelantos: number;
    aCobrar: number;
    cerrado: boolean;
  } | null;
};

export type PlanillasMes = {
  periodo: string;
  etiquetaMes: string;
  generada: string;
  empresa: { razonSocial: string; cuit: string; domicilio: string };
  planillas: PlanillaPersona[];
  faltaSqlFirma: boolean;
};

const NOMBRE_DIA = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const TIPO_LICENCIA: Record<string, string> = {
  VACACIONES: "Vacaciones",
  MATERNIDAD: "Licencia por maternidad",
  EXAMEN: "Licencia por examen",
  PARTICULAR: "Licencia particular",
  ENFERMEDAD: "Licencia por enfermedad",
  OTRO: "Licencia",
};

function textoDiasLargo(dias: number[] | null) {
  const d = [...(dias ?? [])].sort();
  if (d.join() === "1,2,3,4,5,6") return "Lunes a sábado";
  if (d.join() === "1,2,3,4,5") return "Lunes a viernes";
  if (d.join() === "1,2,3,4,5,6,7") return "Todos los días";
  return d.map((x) => NOMBRE_DIA[x]).join(", ");
}

/**
 * Las planillas del mes: de una persona (idPersona) o de todos los
 * operativos. Solo empleados con horario fijo: los de horario libre o sin
 * definir no tienen planilla por ahora.
 */
export async function armarPlanillasAsistencia(periodoPedido: string, idPersona?: string): Promise<PlanillasMes> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const ahora = fechaHoraArgentina();
  const periodoActual = ahora.fecha.slice(0, 7);
  const periodo = /^\d{4}-\d{2}$/.test(periodoPedido) ? periodoPedido : periodoActual;
  const [anio, mes] = periodo.split("-").map(Number);
  const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const hoyDia = periodo === periodoActual ? Number(ahora.fecha.slice(8, 10)) : periodo > periodoActual ? 0 : null;
  const desde = `${periodo}-01`;
  const hasta = `${periodo}-${String(diasDelMes).padStart(2, "0")}`;
  const fechaDe = (d: number) => `${periodo}-${String(d).padStart(2, "0")}`;

  let consultaPersonas = supabase
    .from("personas")
    .select("id_persona, nombre, apellido, dni, cuil, fecha_ingreso, id_horario")
    .eq("estado", "ACTIVO")
    .eq("tipo", "EMPLEADO")
    .not("id_horario", "is", null)
    .order("nombre", { ascending: true });
  if (idPersona) consultaPersonas = consultaPersonas.eq("id_persona", idPersona);
  const { data: personas, error: errorPersonas } = await consultaPersonas;
  if (errorPersonas) throw new Error(friendlyDbError(errorPersonas));

  const base: Omit<PlanillasMes, "planillas" | "faltaSqlFirma"> = {
    periodo,
    etiquetaMes: `${MESES[mes - 1]} ${anio}`,
    generada: ahora.fecha.split("-").reverse().join("/"),
    empresa: { razonSocial: EMISOR.razonSocial, cuit: EMISOR.cuit, domicilio: EMISOR.domicilioComercial },
  };
  if (!personas || personas.length === 0) return { ...base, planillas: [], faltaSqlFirma: false };

  const ids = personas.map((p) => p.id_persona as string);

  // Los fichajes del mes con la firma. Si falta sql/fichajes-firma.sql, se
  // traen sin firma y la planilla avisa.
  type Fichaje = { id_persona: string; tipo: string; fecha_hora: string; estado: string | null; minutos_diferencia: number | null; justificado: boolean | null; usuario: string | null; firma?: string | null };
  async function traerFichajes(conFirma: boolean) {
    const filas: Fichaje[] = [];
    const columnas = `id_persona, tipo, fecha_hora, estado, minutos_diferencia, justificado, usuario${conFirma ? ", firma" : ""}`;
    for (let desdeFila = 0; ; desdeFila += 1000) {
      const { data, error } = await supabase
        .from("fichajes")
        .select(columnas)
        .in("id_persona", ids)
        .gte("fecha_hora", `${desde}T00:00:00-03:00`)
        .lte("fecha_hora", `${hasta}T23:59:59-03:00`)
        .order("fecha_hora", { ascending: true })
        .range(desdeFila, desdeFila + 999);
      if (error) return { filas, error };
      filas.push(...((data ?? []) as unknown as Fichaje[]));
      if (!data || data.length < 1000) return { filas, error: null };
    }
  }

  const [fichajesConFirma, horariosRes, licenciasRes, feriadosRes, asignacionesRes, puestosRes, novedades] = await Promise.all([
    traerFichajes(true),
    supabase.from("horarios_trabajo").select("id_horario, nombre, hora_entrada, hora_salida, dias_semana"),
    supabase.from("licencias").select("id_persona, fecha_desde, fecha_hasta, tipo").in("id_persona", ids).lte("fecha_desde", hasta).gte("fecha_hasta", desde),
    supabase.from("feriados").select("fecha, nombre").gte("fecha", desde).lte("fecha", hasta),
    supabase.from("persona_puestos").select("id_persona, id_puesto, es_principal").in("id_persona", ids),
    supabase.from("puestos").select("id_puesto, nombre"),
    hoyDia === 0 ? Promise.resolve([]) : obtenerNovedadesMes(periodo),
  ]);
  let fichajes = fichajesConFirma;
  let faltaSqlFirma = false;
  if (fichajes.error) {
    faltaSqlFirma = /firma/.test(fichajes.error.message);
    fichajes = await traerFichajes(false);
    if (fichajes.error) throw new Error(friendlyDbError(fichajes.error));
  }

  const horarioPorId = new Map((horariosRes.data ?? []).map((h) => [h.id_horario as string, h]));
  const feriados = new Map((feriadosRes.data ?? []).map((f) => [f.fecha as string, f.nombre as string]));
  const nombrePuesto = new Map((puestosRes.data ?? []).map((p) => [p.id_puesto as string, p.nombre as string]));
  const puestoPor = new Map<string, string>();
  for (const a of asignacionesRes.data ?? []) {
    const nombre = nombrePuesto.get(a.id_puesto as string);
    if (nombre && (a.es_principal || !puestoPor.has(a.id_persona as string))) puestoPor.set(a.id_persona as string, nombre);
  }
  const novedadPor = new Map(novedades.map((n) => [n.idPersona, n]));

  // Las marcas de cada día, en tramos (cada entrada con su salida): con dos
  // turnos el mismo día salen las dos líneas y se suman las horas de cada una.
  type DatoMarca = MarcaPlanilla & { tarde: boolean; justificado: boolean; antes: boolean; minutos: number; puntual: boolean };
  type Dia = Tramo<DatoMarca>[];
  const crudasPor = new Map<string, Map<number, MarcaDia<DatoMarca>[]>>();
  for (const f of fichajes.filas) {
    const arg = fechaHoraArgentina(f.fecha_hora);
    if (arg.fecha.slice(0, 7) !== periodo) continue;
    const d = Number(arg.fecha.slice(8, 10));
    const porDia = crudasPor.get(f.id_persona) ?? new Map<number, MarcaDia<DatoMarca>[]>();
    const marcas = porDia.get(d) ?? [];
    marcas.push({
      tipo: f.tipo,
      hora: arg.hora,
      dato: {
        hora: arg.hora,
        firma: f.firma ?? null,
        manual: /completado manual/i.test(f.usuario ?? ""),
        tarde: f.tipo === "ENTRADA" && f.estado === "TARDE",
        justificado: Boolean(f.justificado),
        antes: f.tipo === "SALIDA" && f.estado === "ANTICIPADA",
        minutos: f.minutos_diferencia ?? 0,
        // Fichada sin turno: una hora puntual (o un día excepcional).
        puntual: f.tipo === "ENTRADA" && f.estado === "SIN_HORARIO",
      },
    });
    porDia.set(d, marcas);
    crudasPor.set(f.id_persona, porDia);
  }
  const marcasPor = new Map<string, Map<number, Dia>>();
  for (const [idP, porDia] of crudasPor) {
    marcasPor.set(idP, new Map([...porDia].map(([d, marcas]) => [d, armarTramos(marcas)])));
  }
  const soloMarca = (m: DatoMarca): MarcaPlanilla => ({ hora: m.hora, firma: m.firma, manual: m.manual });

  const planillas: PlanillaPersona[] = personas.map((p) => {
    const id = p.id_persona as string;
    const h = horarioPorId.get(p.id_horario as string);
    const diasHorario = ((h?.dias_semana as number[] | null) ?? []) as number[];
    const licencias = (licenciasRes.data ?? []).filter((l) => l.id_persona === id);
    const porDia = marcasPor.get(id) ?? new Map<number, Dia>();
    const totales = { horas: 0, diasTrabajados: 0, diasEsperados: 0, tardanzas: 0, faltas: 0, salidasAntes: 0, sinFirma: 0 };

    const filas: DiaPlanilla[] = Array.from({ length: diasDelMes }, (_, i) => {
      const d = i + 1;
      const fecha = fechaDe(d);
      const dow = new Date(Date.UTC(anio, mes - 1, d)).getUTCDay() || 7;
      const fila: DiaPlanilla = { fecha, dia: d, diaSemana: dow, tramos: [], horas: null, tipo: "trabajo", obs: "" };
      const futuro = hoyDia === 0 || (hoyDia !== null && d > hoyDia);
      const esHoy = hoyDia === d;
      const trabaja = diasHorario.includes(dow);
      const feriado = feriados.get(fecha);
      const licencia = licencias.find((l) => fecha >= (l.fecha_desde as string) && fecha <= (l.fecha_hasta as string));
      const marca = porDia.get(d);

      if (futuro) return { ...fila, tipo: "futuro" };
      if (licencia) return { ...fila, tipo: "lic", obs: TIPO_LICENCIA[(licencia.tipo as string) ?? "OTRO"] ?? "Licencia" };

      const conEntrada = (marca ?? []).filter((t) => t.entrada);
      if (conEntrada.length > 0) {
        totales.diasTrabajados += 1;
        if (trabaja && !feriado) totales.diasEsperados += 1;
        const notas: string[] = [];
        if (feriado) notas.push(`Feriado: ${feriado} (se paga doble)`);
        else if (!trabaja) notas.push("Día que no le tocaba");
        if (conEntrada.length > 1) notas.push(`${conEntrada.length} turnos`);
        for (const t of conEntrada) {
          const e = t.entrada!.dato;
          if (!e.firma && !e.manual) totales.sinFirma += 1;
          if (e.puntual) notas.push(`Hora puntual desde las ${e.hora}`);
          if (e.tarde && !e.justificado) {
            totales.tardanzas += 1;
            fila.tipo = "tarde";
            notas.push(`Llegó ${e.minutos} min tarde (${e.hora})`);
          } else if (e.tarde) notas.push("Tardanza justificada");
          if (t.salida) {
            const s = t.salida.dato;
            if (!s.firma && !s.manual) totales.sinFirma += 1;
            if (s.antes) {
              totales.salidasAntes += 1;
              notas.push(`Se fue ${s.minutos} min antes (${s.hora})`);
            }
            if (s.manual) notas.push("Salida cargada por administración");
          }
          fila.tramos.push({ entrada: soloMarca(e), salida: t.salida ? soloMarca(t.salida.dato) : null });
        }
        fila.horas = horasDeTramos(conEntrada);
        if (fila.horas !== null) totales.horas += fila.horas;
        if (quedoSinSalida(conEntrada)) {
          if (esHoy) {
            fila.tipo = "en_curso";
            notas.push("Trabajando ahora");
          } else {
            fila.tipo = "sin_salida";
            notas.push("No fichó la salida");
          }
        }
        fila.obs = notas.join(" · ");
        return fila;
      }

      if (!trabaja) return { ...fila, tipo: "no_trabaja", obs: "No trabaja" };
      if (feriado) return { ...fila, tipo: "feriado", obs: `Feriado: ${feriado}` };
      if (esHoy) return { ...fila, tipo: "en_curso", obs: "Hoy" };
      totales.diasEsperados += 1;
      totales.faltas += 1;
      return { ...fila, tipo: "falta", obs: "Faltó" };
    });
    totales.horas = Math.round(totales.horas * 100) / 100;

    const n = novedadPor.get(id);
    const presentismo = !n
      ? "—"
      : !n.cobraPresentismo
        ? "No cobra"
        : n.presentismoResultado === "COMPLETO"
          ? "Completo"
          : n.presentismoResultado === "PARCIAL"
            ? "Parcial"
            : "Perdido";
    const cierre = n?.cierre && !n.cierre.es_estimado ? n.cierre : null;
    const ganado: PlanillaPersona["ganado"] = n
      ? {
          porHora: n.modalidad === "POR_HORA",
          valorHora: n.valorHora ?? 0,
          sueldoFijo: n.sueldoBase,
          horas: n.horasTrabajadasMes ?? 0,
          horasFeriado: n.horasFeriadoMes ?? 0,
          base: cierre ? cierre.sueldo_base : n.montoBase,
          presentismo: cierre ? cierre.incentivo_presentismo : n.incentivoPresentismoPreview,
          cobraPresentismo: n.cobraPresentismo,
          adelantos: cierre ? cierre.adelantos : n.adelantos,
          aCobrar: cierre ? cierre.neto_a_pagar : n.montoBase + n.incentivoPresentismoPreview - n.adelantos,
          cerrado: Boolean(cierre),
        }
      : null;

    return {
      idPersona: id,
      nombre: [p.nombre, p.apellido].filter(Boolean).join(" "),
      puesto: puestoPor.get(id) ?? null,
      dni: (p.dni as string | null) ?? null,
      cuil: (p.cuil as string | null) ?? null,
      fechaIngreso: p.fecha_ingreso ? (p.fecha_ingreso as string).split("-").reverse().join("/") : null,
      horario: h ? `${h.nombre} · ${corto(h.hora_entrada as string)} a ${corto(h.hora_salida as string)}` : "—",
      dias: textoDiasLargo(diasHorario),
      filas,
      totales,
      presentismo,
      ganado,
    };
  });

  return { ...base, planillas, faltaSqlFirma };
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
