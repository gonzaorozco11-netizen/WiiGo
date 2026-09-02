"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { fechaHoraArgentina, minutosDeHora } from "@/lib/horarios";

async function requireAcceso() {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return "No tenés permiso para hacer esto.";
  return null;
}

const PARAMETROS_PRESENTISMO = [
  "PRESENTISMO_MAX_TARDANZAS",
  "PRESENTISMO_MAX_FALTAS",
  "PRESENTISMO_MAX_SALIDAS_ANTICIPADAS",
  "PRESENTISMO_TARDANZAS_PARA_PARCIAL",
  "PRESENTISMO_PORCENTAJE_INCENTIVO",
] as const;

export type ParametrosPresentismo = Record<(typeof PARAMETROS_PRESENTISMO)[number], number>;

export async function obtenerParametrosPresentismo(): Promise<ParametrosPresentismo> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase.from("configuracion").select("parametro, valor").in("parametro", [...PARAMETROS_PRESENTISMO]);
  const mapa = new Map((data ?? []).map((r) => [r.parametro as string, Number(r.valor)]));
  return {
    PRESENTISMO_MAX_TARDANZAS: mapa.get("PRESENTISMO_MAX_TARDANZAS") ?? 2,
    PRESENTISMO_MAX_FALTAS: mapa.get("PRESENTISMO_MAX_FALTAS") ?? 1,
    PRESENTISMO_MAX_SALIDAS_ANTICIPADAS: mapa.get("PRESENTISMO_MAX_SALIDAS_ANTICIPADAS") ?? 1,
    PRESENTISMO_TARDANZAS_PARA_PARCIAL: mapa.get("PRESENTISMO_TARDANZAS_PARA_PARCIAL") ?? 1,
    PRESENTISMO_PORCENTAJE_INCENTIVO: mapa.get("PRESENTISMO_PORCENTAJE_INCENTIVO") ?? 10,
  };
}

export async function actualizarParametrosPresentismo(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  try {
    const supabase = getSupabaseServerClient();
    for (const parametro of PARAMETROS_PRESENTISMO) {
      const valor = formData.get(parametro);
      if (valor === null) continue;
      const { data: existente } = await supabase.from("configuracion").select("parametro").eq("parametro", parametro).maybeSingle();
      const { error } = existente
        ? await supabase.from("configuracion").update({ valor: String(valor) }).eq("parametro", parametro)
        : await supabase.from("configuracion").insert({ parametro, valor: String(valor) });
      if (error) return { error: friendlyDbError(error) };
    }
    revalidatePath("/rrhh");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo guardar" };
  }
}

export type PresentismoFila = {
  idPersona: string;
  nombre: string;
  tardanzas: number;
  faltas: number;
  salidasAnticipadas: number;
  licenciaParticularSinGoce: boolean;
  resultado: "COMPLETO" | "PARCIAL" | "PERDIDO";
};

function diasDelPeriodo(periodo: string) {
  const [anio, mes] = periodo.split("-").map(Number);
  const desde = new Date(anio, mes - 1, 1);
  const hastaReal = new Date(anio, mes, 0);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const hasta = hastaReal < hoy ? hastaReal : hoy;
  return { desde, hasta };
}

// Devuelve, por persona, el set de fechas (YYYY-MM-DD) cubiertas por
// cualquier licencia que se superponga con el período — esos días no
// cuentan como falta, estén o no con goce de sueldo.
async function diasConLicenciaPorPersona(supabase: ReturnType<typeof getSupabaseServerClient>, idsPersona: string[], desdeStr: string, hastaStr: string) {
  const { data: licencias } = await supabase
    .from("licencias")
    .select("id_persona, tipo, fecha_desde, fecha_hasta, con_goce_sueldo")
    .in("id_persona", idsPersona.length > 0 ? idsPersona : ["00000000-0000-0000-0000-000000000000"])
    .lte("fecha_desde", hastaStr)
    .gte("fecha_hasta", desdeStr);

  const diasPorPersona = new Map<string, Set<string>>();
  const sinGocePorPersona = new Map<string, boolean>();
  for (const l of licencias ?? []) {
    const desdeClamp = (l.fecha_desde as string) < desdeStr ? desdeStr : (l.fecha_desde as string);
    const hastaClamp = (l.fecha_hasta as string) > hastaStr ? hastaStr : (l.fecha_hasta as string);
    const set = diasPorPersona.get(l.id_persona as string) ?? new Set<string>();
    const cursor = new Date(`${desdeClamp}T00:00:00`);
    const fin = new Date(`${hastaClamp}T00:00:00`);
    while (cursor <= fin) {
      set.add(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    diasPorPersona.set(l.id_persona as string, set);
    if (l.tipo === "PARTICULAR" && l.con_goce_sueldo === false) sinGocePorPersona.set(l.id_persona as string, true);
  }
  return { diasPorPersona, sinGocePorPersona };
}

export async function calcularPresentismoMes(periodo: string): Promise<PresentismoFila[]> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const params = await obtenerParametrosPresentismo();

  const { data: personas } = await supabase
    .from("personas")
    .select("id_persona, nombre, apellido, id_horario")
    .eq("estado", "ACTIVO")
    .not("id_horario", "is", null);

  const idsHorario = [...new Set((personas ?? []).map((p) => p.id_horario as string))];
  const { data: horarios } = await supabase
    .from("horarios_trabajo")
    .select("id_horario, dias_semana")
    .in("id_horario", idsHorario.length > 0 ? idsHorario : ["00000000-0000-0000-0000-000000000000"]);
  const horarioPorId = new Map((horarios ?? []).map((h) => [h.id_horario as string, h.dias_semana as number[]]));

  const { desde, hasta } = diasDelPeriodo(periodo);
  const desdeStr = desde.toISOString().slice(0, 10);
  const hastaStr = hasta.toISOString().slice(0, 10);

  // Se pide un día de margen a cada lado y se filtra por fecha-Argentina en
  // JS después — el rango en la consulta es solo para no traer de más, no
  // hace falta que sea exacto (fecha_hora guarda el instante en UTC).
  const idsPersona = (personas ?? []).map((p) => p.id_persona as string);
  const { data: fichajesCrudos } = await supabase
    .from("fichajes")
    .select("id_persona, tipo, fecha_hora, estado, justificado")
    .in("id_persona", idsPersona.length > 0 ? idsPersona : ["00000000-0000-0000-0000-000000000000"])
    .gte("fecha_hora", `${desdeStr}T00:00:00Z`)
    .lte("fecha_hora", `${hastaStr}T23:59:59Z`);

  const fichajes = (fichajesCrudos ?? [])
    .map((f) => ({ ...f, fechaArg: fechaHoraArgentina(f.fecha_hora as string).fecha }))
    .filter((f) => f.fechaArg >= desdeStr && f.fechaArg <= hastaStr);

  const { diasPorPersona: diasConLicencia, sinGocePorPersona } = await diasConLicenciaPorPersona(supabase, idsPersona, desdeStr, hastaStr);

  const resultado: PresentismoFila[] = [];
  for (const p of personas ?? []) {
    const diasSemana = horarioPorId.get(p.id_horario as string);
    if (!diasSemana) continue;
    const fichajesPersona = fichajes.filter((f) => f.id_persona === p.id_persona);
    const diasLicenciaPersona = diasConLicencia.get(p.id_persona as string) ?? new Set<string>();

    const tardanzas = fichajesPersona.filter((f) => f.tipo === "ENTRADA" && f.estado === "TARDE" && !f.justificado).length;
    const salidasAnticipadas = fichajesPersona.filter((f) => f.tipo === "SALIDA" && f.estado === "ANTICIPADA" && !f.justificado).length;

    const diasEsperados: string[] = [];
    const cursor = new Date(desde);
    while (cursor <= hasta) {
      const isoDow = cursor.getDay() === 0 ? 7 : cursor.getDay();
      const fechaCursor = cursor.toISOString().slice(0, 10);
      if (diasSemana.includes(isoDow) && !diasLicenciaPersona.has(fechaCursor)) diasEsperados.push(fechaCursor);
      cursor.setDate(cursor.getDate() + 1);
    }
    const diasConEntrada = new Set(fichajesPersona.filter((f) => f.tipo === "ENTRADA").map((f) => f.fechaArg));
    const faltas = diasEsperados.filter((d) => !diasConEntrada.has(d)).length;
    const licenciaParticularSinGoce = sinGocePorPersona.get(p.id_persona as string) ?? false;

    let resultadoPresentismo: PresentismoFila["resultado"] = "COMPLETO";
    if (faltas >= params.PRESENTISMO_MAX_FALTAS || tardanzas > params.PRESENTISMO_MAX_TARDANZAS || salidasAnticipadas > params.PRESENTISMO_MAX_SALIDAS_ANTICIPADAS) {
      resultadoPresentismo = "PERDIDO";
    } else if (tardanzas >= params.PRESENTISMO_TARDANZAS_PARA_PARCIAL || licenciaParticularSinGoce) {
      resultadoPresentismo = "PARCIAL";
    }

    resultado.push({
      idPersona: p.id_persona as string,
      nombre: `${p.nombre as string} ${(p.apellido as string | null) ?? ""}`.trim(),
      tardanzas,
      faltas,
      salidasAnticipadas,
      licenciaParticularSinGoce,
      resultado: resultadoPresentismo,
    });
  }
  return resultado.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export type FilaPlanilla = {
  fecha: string;
  horaEntrada: string | null;
  horaSalida: string | null;
  horasTrabajadas: number | null;
  tardanza: boolean;
  salidaAnticipada: boolean;
};

// Detalle día por día de un empleado en el mes — a diferencia de
// calcularPresentismoMes (que solo cuenta), esto muestra la hora concreta
// de entrada/salida y las horas trabajadas por día.
export async function listarPlanillaHoraria(idPersona: string, periodo: string): Promise<FilaPlanilla[]> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const [anio, mes] = periodo.split("-").map(Number);
  const desdeStr = `${periodo}-01`;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hastaStr = `${periodo}-${String(ultimoDia).padStart(2, "0")}`;

  const { data: fichajes } = await supabase
    .from("fichajes")
    .select("tipo, fecha_hora, estado")
    .eq("id_persona", idPersona)
    .gte("fecha_hora", `${desdeStr}T00:00:00Z`)
    .lte("fecha_hora", `${hastaStr}T23:59:59Z`)
    .order("fecha_hora", { ascending: true });

  const porDia = new Map<string, { entrada?: string; salida?: string; estadoEntrada?: string; estadoSalida?: string }>();
  for (const f of fichajes ?? []) {
    const enArgentina = fechaHoraArgentina(f.fecha_hora as string);
    const fecha = enArgentina.fecha;
    if (fecha < desdeStr || fecha > hastaStr) continue;
    const hora = enArgentina.hora;
    const fila = porDia.get(fecha) ?? {};
    if (f.tipo === "ENTRADA" && !fila.entrada) {
      fila.entrada = hora;
      fila.estadoEntrada = f.estado as string;
    }
    if (f.tipo === "SALIDA") {
      fila.salida = hora;
      fila.estadoSalida = f.estado as string;
    }
    porDia.set(fecha, fila);
  }

  return [...porDia.entries()]
    .map(([fecha, v]) => {
      let horasTrabajadas: number | null = null;
      if (v.entrada && v.salida) {
        const [eh, em] = v.entrada.split(":").map(Number);
        const [sh, sm] = v.salida.split(":").map(Number);
        horasTrabajadas = Math.round(((sh * 60 + sm - (eh * 60 + em)) / 60) * 100) / 100;
      }
      return {
        fecha,
        horaEntrada: v.entrada ?? null,
        horaSalida: v.salida ?? null,
        horasTrabajadas,
        tardanza: v.estadoEntrada === "TARDE",
        salidaAnticipada: v.estadoSalida === "ANTICIPADA",
      };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

export type FichajePendiente = {
  idPersona: string;
  nombre: string;
  fecha: string;
  horaEntrada: string;
};

// Días de los últimos 30 en los que hay ENTRADA pero nunca se fichó la
// SALIDA — el día de hoy queda afuera a propósito porque todavía puede
// ficharla más tarde.
export async function listarFichajesPendientesSalida(): Promise<FichajePendiente[]> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const desde = new Date();
  desde.setDate(desde.getDate() - 30);

  const { data: fichajes } = await supabase
    .from("fichajes")
    .select("id_persona, tipo, fecha_hora")
    .gte("fecha_hora", desde.toISOString())
    .order("fecha_hora", { ascending: true });

  const porPersonaDia = new Map<string, { entrada?: string; salida?: string }>();
  for (const f of fichajes ?? []) {
    const enArgentina = fechaHoraArgentina(f.fecha_hora as string);
    const clave = `${f.id_persona}|${enArgentina.fecha}`;
    const actual = porPersonaDia.get(clave) ?? {};
    if (f.tipo === "ENTRADA" && !actual.entrada) actual.entrada = enArgentina.hora;
    if (f.tipo === "SALIDA") actual.salida = enArgentina.hora;
    porPersonaDia.set(clave, actual);
  }

  const hoy = fechaHoraArgentina().fecha;
  const pendientes: { idPersona: string; fecha: string; horaEntrada: string }[] = [];
  for (const [clave, v] of porPersonaDia) {
    const [idPersona, fecha] = clave.split("|");
    if (v.entrada && !v.salida && fecha !== hoy) pendientes.push({ idPersona, fecha, horaEntrada: v.entrada });
  }
  if (pendientes.length === 0) return [];

  const idsPersona = [...new Set(pendientes.map((p) => p.idPersona))];
  const { data: personas } = await supabase.from("personas").select("id_persona, nombre, apellido").in("id_persona", idsPersona);
  const nombrePorId = new Map((personas ?? []).map((p) => [p.id_persona as string, `${p.nombre as string} ${(p.apellido as string | null) ?? ""}`.trim()]));

  return pendientes
    .map((p) => ({ idPersona: p.idPersona, nombre: nombrePorId.get(p.idPersona) ?? "—", fecha: p.fecha, horaEntrada: p.horaEntrada }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

// Carga a mano la salida real de un día que quedó sin fichar — queda
// marcada como "justificado" y con quién la completó, para que se note en
// una auditoría que no fue un fichaje automático de la tablet.
export async function completarSalidaManual(idPersona: string, fecha: string, horaSalida: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  try {
    const supabase = getSupabaseServerClient();
    const sesion = await obtenerSesionConPermisos();

    const { data: persona } = await supabase.from("personas").select("id_horario").eq("id_persona", idPersona).maybeSingle();
    let estado = "SIN_HORARIO";
    if (persona?.id_horario) {
      const { data: horario } = await supabase
        .from("horarios_trabajo")
        .select("hora_salida, tolerancia_minutos")
        .eq("id_horario", persona.id_horario as string)
        .maybeSingle();
      if (horario?.hora_salida) {
        const diffMin = minutosDeHora(horaSalida) - minutosDeHora(horario.hora_salida as string);
        estado = diffMin < -(horario.tolerancia_minutos as number) ? "ANTICIPADA" : "A_TIEMPO";
      }
    }

    // Se guarda como si fuera las horaSalida:00 en Argentina — como acá no
    // se puede usar Intl para "armar" una fecha (solo para leerla), se resta
    // el offset fijo de Argentina (UTC-3) a mano para obtener el instante UTC correcto.
    const fechaHoraUTC = new Date(`${fecha}T${horaSalida}:00.000-03:00`);

    const { error } = await supabase.from("fichajes").insert({
      id_persona: idPersona,
      tipo: "SALIDA",
      fecha_hora: fechaHoraUTC.toISOString(),
      estado,
      justificado: true,
      usuario: `${sesion?.nombre ?? "Admin"} (completado manual)`,
    });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/rrhh");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo completar el fichaje" };
  }
}

// ===================== VACACIONES Y LICENCIAS (RR.HH. — Fase 3) =====================
// Vos (RR.HH.) las cargás directamente ya "aprobadas" — no hay pantalla de
// solicitud para el empleado ni bandeja de aprobación todavía (no existe el
// rol "Encargado" para eso); si hace falta más adelante, se suma aparte.

// Mínimo legal según antigüedad (Art. 150/151 LCT) — no contempla días
// extra que algún convenio colectivo específico pudiera sumar por encima
// del mínimo, porque esos términos varían por convenio y no están cargados
// en el sistema. Ajustá a mano si tu convenio da más días que el legal.
function calcularDiasVacacionesLegales(fechaIngresoStr: string, anio: number): number {
  const fechaIngreso = new Date(`${fechaIngresoStr}T00:00:00`);
  const inicioAnio = new Date(anio, 0, 1);
  const finAnio = new Date(anio, 11, 31);
  if (fechaIngreso > finAnio) return 0;

  const desde = fechaIngreso > inicioAnio ? fechaIngreso : inicioAnio;
  const diasTrabajadosEnAnio = Math.floor((finAnio.getTime() - desde.getTime()) / 86400000) + 1;

  // Si no llegó a trabajar al menos medio año, la licencia es proporcional:
  // 1 día cada 20 trabajados (Art. 153 LCT) — típico en el año de ingreso.
  if (diasTrabajadosEnAnio < 183) return Math.floor(diasTrabajadosEnAnio / 20);

  let antiguedad = anio - fechaIngreso.getFullYear();
  const aniversarioEsteAnio = new Date(anio, fechaIngreso.getMonth(), fechaIngreso.getDate());
  if (aniversarioEsteAnio > finAnio) antiguedad -= 1;

  if (antiguedad <= 5) return 14;
  if (antiguedad <= 10) return 21;
  if (antiguedad <= 20) return 28;
  return 35;
}

function diasEntre(desdeStr: string, hastaStr: string) {
  const desde = new Date(`${desdeStr}T00:00:00`);
  const hasta = new Date(`${hastaStr}T00:00:00`);
  return Math.max(0, Math.floor((hasta.getTime() - desde.getTime()) / 86400000) + 1);
}

export type SaldoVacaciones = {
  idPersona: string;
  nombre: string;
  fechaIngreso: string;
  diasLegales: number;
  diasTomados: number;
  diasDisponibles: number;
};

export async function listarSaldosVacaciones(anio: number): Promise<SaldoVacaciones[]> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const { data: personas } = await supabase
    .from("personas")
    .select("id_persona, nombre, apellido, fecha_ingreso")
    .eq("estado", "ACTIVO")
    .not("fecha_ingreso", "is", null);

  const idsPersona = (personas ?? []).map((p) => p.id_persona as string);
  const { data: licenciasVac } = await supabase
    .from("licencias")
    .select("id_persona, fecha_desde, fecha_hasta")
    .eq("tipo", "VACACIONES")
    .in("id_persona", idsPersona.length > 0 ? idsPersona : ["00000000-0000-0000-0000-000000000000"]);

  const inicioAnio = `${anio}-01-01`;
  const finAnio = `${anio}-12-31`;
  const tomadosPorPersona = new Map<string, number>();
  for (const l of licenciasVac ?? []) {
    const desdeClamp = (l.fecha_desde as string) < inicioAnio ? inicioAnio : (l.fecha_desde as string);
    const hastaClamp = (l.fecha_hasta as string) > finAnio ? finAnio : (l.fecha_hasta as string);
    if (desdeClamp > hastaClamp) continue;
    const dias = diasEntre(desdeClamp, hastaClamp);
    tomadosPorPersona.set(l.id_persona as string, (tomadosPorPersona.get(l.id_persona as string) ?? 0) + dias);
  }

  return (personas ?? [])
    .map((p) => {
      const diasLegales = calcularDiasVacacionesLegales(p.fecha_ingreso as string, anio);
      const diasTomados = tomadosPorPersona.get(p.id_persona as string) ?? 0;
      return {
        idPersona: p.id_persona as string,
        nombre: `${p.nombre as string} ${(p.apellido as string | null) ?? ""}`.trim(),
        fechaIngreso: p.fecha_ingreso as string,
        diasLegales,
        diasTomados,
        diasDisponibles: diasLegales - diasTomados,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export type Licencia = {
  id_licencia: string;
  id_persona: string;
  tipo: string;
  fecha_desde: string;
  fecha_hasta: string;
  con_goce_sueldo: boolean;
  motivo: string | null;
  usuario: string | null;
  fecha_carga: string;
};

export async function listarLicencias(idPersona: string): Promise<Licencia[]> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("licencias").select("*").eq("id_persona", idPersona).order("fecha_desde", { ascending: false });
  if (error) throw new Error(friendlyDbError(error));
  return (data ?? []) as Licencia[];
}

export async function crearLicencia(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const idPersona = String(formData.get("id_persona") ?? "");
  const tipo = String(formData.get("tipo") ?? "");
  const fechaDesde = String(formData.get("fecha_desde") ?? "");
  const fechaHasta = String(formData.get("fecha_hasta") ?? "");
  if (!idPersona || !tipo || !fechaDesde || !fechaHasta) return { error: "Completá todos los campos obligatorios" };
  if (fechaHasta < fechaDesde) return { error: "La fecha hasta no puede ser anterior a la fecha desde" };

  try {
    const supabase = getSupabaseServerClient();
    const sesion = await obtenerSesionConPermisos();
    const { error } = await supabase.from("licencias").insert({
      id_persona: idPersona,
      tipo,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      con_goce_sueldo: formData.get("con_goce_sueldo") === "on",
      motivo: String(formData.get("motivo") ?? "").trim() || null,
      usuario: sesion?.nombre ?? null,
    });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/rrhh");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cargar la licencia" };
  }
}

export async function eliminarLicencia(idLicencia: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("licencias").delete().eq("id_licencia", idLicencia);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/rrhh");
  return { error: null };
}

// ===================== CIERRE DE NÓMINA (RR.HH. — Fase 5) =====================
// Devengado: al cerrar, el gasto entra al Estado de Resultados en el
// momento del cierre (no cuando se paga) — mismo criterio que el resto del
// sistema. El pasivo "pendiente de pago" es simplemente el cierre en estado
// PENDIENTE_PAGO; no hace falta una tabla de pasivos genérica aparte.

function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

function rangoDelPeriodoStr(periodo: string) {
  const [anio, mes] = periodo.split("-").map(Number);
  const desde = `${periodo}-01`;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = `${periodo}-${String(ultimoDia).padStart(2, "0")}`;
  return { desde, hasta };
}

function normalizarNombreCategoria(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

// A qué categoría de gasto van los sueldos que genera el cierre de nómina.
//
// Busca entre las categorías ACTIVAS la que empiece con "sueldo", así
// respeta cómo la haya llamado cada uno ("Sueldos", "Sueldos y cargas
// sociales", etc.) y no rompe si se desactiva una y se deja otra. Antes
// buscaba el nombre exacto "Sueldos" e ignoraba si estaba desactivada: los
// gastos terminaban cayendo en una categoría que ya no se usaba.
async function resolveCategoriaSueldos(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const { data: categorias } = await supabase
    .from("categorias_gasto")
    .select("id_categoria, nombre")
    .eq("estado", "ACTIVA");

  const activas = categorias ?? [];
  // Preferencia: el nombre exacto "sueldos"; si no, cualquiera que arranque
  // con "sueldo" (la más corta, para no agarrar una subcategoría rara).
  const exacta = activas.find((c) => normalizarNombreCategoria(c.nombre as string) === "sueldos");
  if (exacta) return exacta.id_categoria as string;

  const parecidas = activas
    .filter((c) => normalizarNombreCategoria(c.nombre as string).startsWith("sueldo"))
    .sort((a, b) => (a.nombre as string).length - (b.nombre as string).length);
  if (parecidas.length > 0) return parecidas[0].id_categoria as string;

  const { data, error } = await supabase
    .from("categorias_gasto")
    .insert({ nombre: "Sueldos", tipo_default: "FIJO", estado: "ACTIVA" })
    .select("id_categoria")
    .single();
  if (error) throw new Error(friendlyDbError(error));
  return data.id_categoria as string;
}

// id_subcategoria es obligatorio en "gastos" — cada categoría auto-generada
// necesita al menos una subcategoría "General" para poder insertar.
async function resolveSubcategoriaSueldos(supabase: ReturnType<typeof getSupabaseServerClient>, idCategoria: string) {
  const { data: subcategorias } = await supabase.from("subcategorias_gasto").select("id_subcategoria, nombre").eq("id_categoria", idCategoria);
  const existente = (subcategorias ?? []).find((s) => normalizarNombreCategoria(s.nombre as string) === "general");
  if (existente) return existente.id_subcategoria as string;
  const { data, error } = await supabase
    .from("subcategorias_gasto")
    .insert({ id_categoria: idCategoria, nombre: "General", estado: "ACTIVA" })
    .select("id_subcategoria")
    .single();
  if (error) throw new Error(friendlyDbError(error));
  return data.id_subcategoria as string;
}

export type CierreNomina = {
  id_cierre: string;
  id_persona: string;
  periodo: string;
  sueldo_base: number;
  presentismo_resultado: "COMPLETO" | "PARCIAL" | "PERDIDO";
  incentivo_presentismo: number;
  horas_extra_monto: number;
  horas_extra_detalle: string | null;
  premios_monto: number;
  premios_detalle: string | null;
  adelantos: number;
  neto_a_pagar: number;
  id_gasto: string | null;
  estado: "PENDIENTE_PAGO" | "PAGADO";
  es_estimado: boolean;
  es_formal: boolean;
  aportes_empleado: number;
  contribuciones_patronales: number;
  fecha_cierre: string;
  usuario_cierre: string | null;
  fecha_pago: string | null;
  cuenta_pago: string | null;
  comprobante_path: string | null;
  usuario_pago: string | null;
};

export type NovedadNomina = {
  idPersona: string;
  idUsuario: string;
  nombre: string;
  modalidad: "FIJO" | "POR_HORA";
  sueldoBase: number;
  valorHora: number | null;
  horasTrabajadasMes: number | null;
  horasFeriadoMes: number | null;
  montoBase: number;
  presentismoResultado: "COMPLETO" | "PARCIAL" | "PERDIDO";
  incentivoPresentismoPreview: number;
  adelantos: number;
  cierre: CierreNomina | null;
};

export type Feriado = { fecha: string; nombre: string };

export async function listarFeriados(): Promise<Feriado[]> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase.from("feriados").select("fecha, nombre").order("fecha");
  return (data ?? []) as Feriado[];
}

export async function crearFeriado(fecha: string, nombre: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };
  if (!fecha || !nombre.trim()) return { error: "Completá la fecha y el nombre" };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("feriados").upsert({ fecha, nombre: nombre.trim() });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/rrhh");
  return { error: null };
}

export async function eliminarFeriado(fecha: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("feriados").delete().eq("fecha", fecha);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/rrhh");
  return { error: null };
}

// Para los que cobran por hora: si trabajaron un día que está en la lista
// de feriados, esas horas se pagan doble (Art. 166 LCT). Solo cuenta si
// hay horas fichadas ese día — un feriado no trabajado no genera pago para
// alguien por hora (no tiene sueldo garantizado sin trabajar).
async function calcularPagoPorHoraMes(idPersona: string, periodo: string, valorHora: number) {
  const supabase = getSupabaseServerClient();
  const [filas, { data: feriadosData }] = await Promise.all([
    listarPlanillaHoraria(idPersona, periodo),
    supabase.from("feriados").select("fecha"),
  ]);
  const feriadosSet = new Set((feriadosData ?? []).map((f) => f.fecha as string));

  let horasTotales = 0;
  let horasFeriado = 0;
  let montoBase = 0;
  for (const f of filas) {
    const horas = f.horasTrabajadas ?? 0;
    if (horas <= 0) continue;
    horasTotales += horas;
    const esFeriado = feriadosSet.has(f.fecha);
    if (esFeriado) horasFeriado += horas;
    montoBase += horas * valorHora * (esFeriado ? 2 : 1);
  }
  return { horasTotales: redondear2(horasTotales), horasFeriado: redondear2(horasFeriado), montoBase: redondear2(montoBase) };
}

// Consolida, por cada persona con sueldo cargado (fijo o por hora), lo
// necesario para cerrar su nómina del mes: monto base, resultado de
// presentismo (ya calculado), adelantos del período, y si ya tiene un
// cierre (y en qué estado).
export async function obtenerNovedadesMes(periodo: string): Promise<NovedadNomina[]> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const params = await obtenerParametrosPresentismo();

  const { data: usuariosConSueldo } = await supabase
    .from("usuarios")
    .select("id_usuario, nombre, sueldo_base, valor_hora, id_persona")
    .eq("estado", "ACTIVO")
    .not("id_persona", "is", null)
    .or("sueldo_base.gt.0,valor_hora.gt.0");
  if (!usuariosConSueldo || usuariosConSueldo.length === 0) return [];

  const presentismoFilas = await calcularPresentismoMes(periodo);
  const presentismoPorPersona = new Map(presentismoFilas.map((f) => [f.idPersona, f.resultado]));

  const { desde, hasta } = rangoDelPeriodoStr(periodo);
  const idsUsuario = usuariosConSueldo.map((u) => u.id_usuario as string);
  const { data: adelantosData } = await supabase
    .from("gastos")
    .select("id_usuario_adelanto, monto")
    .eq("anulado", false)
    .in("id_usuario_adelanto", idsUsuario)
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  const adelantoPorUsuario = new Map<string, number>();
  for (const a of adelantosData ?? []) {
    const id = a.id_usuario_adelanto as string;
    adelantoPorUsuario.set(id, redondear2((adelantoPorUsuario.get(id) ?? 0) + ((a.monto as number) ?? 0)));
  }

  const idsPersona = usuariosConSueldo.map((u) => u.id_persona as string);
  const { data: cierresExistentes } = await supabase.from("nomina_cierres").select("*").eq("periodo", periodo).in("id_persona", idsPersona);
  const cierrePorPersona = new Map((cierresExistentes ?? []).map((c) => [c.id_persona as string, c as CierreNomina]));

  const filas = await Promise.all(
    usuariosConSueldo.map(async (u) => {
      const idPersona = u.id_persona as string;
      const valorHora = (u.valor_hora as number) || null;
      const esPorHora = !!valorHora && valorHora > 0;
      const sueldoBase = (u.sueldo_base as number) || 0;
      const pagoPorHora = esPorHora ? await calcularPagoPorHoraMes(idPersona, periodo, valorHora as number) : null;
      const horasTrabajadasMes = pagoPorHora?.horasTotales ?? null;
      const horasFeriadoMes = pagoPorHora?.horasFeriado ?? null;
      const montoBase = esPorHora ? (pagoPorHora?.montoBase ?? 0) : sueldoBase;
      const presentismoResultado = presentismoPorPersona.get(idPersona) ?? "COMPLETO";
      const factor = presentismoResultado === "COMPLETO" ? 1 : presentismoResultado === "PARCIAL" ? 0.5 : 0;
      return {
        idPersona,
        idUsuario: u.id_usuario as string,
        nombre: u.nombre as string,
        modalidad: esPorHora ? ("POR_HORA" as const) : ("FIJO" as const),
        sueldoBase,
        valorHora,
        horasTrabajadasMes,
        horasFeriadoMes,
        montoBase,
        presentismoResultado,
        incentivoPresentismoPreview: redondear2(montoBase * (params.PRESENTISMO_PORCENTAJE_INCENTIVO / 100) * factor),
        adelantos: adelantoPorUsuario.get(u.id_usuario as string) ?? 0,
        cierre: cierrePorPersona.get(idPersona) ?? null,
      };
    })
  );

  return filas.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// Cierra la nómina de una persona para el período: calcula el incentivo de
// presentismo, suma horas extra/premios cargados a mano, resta los
// adelantos ya pagados, y genera el gasto "Sueldos" en el Estado de
// Resultados (devengado, en el momento del cierre) — reemplaza la carga
// manual que se venía haciendo antes.
export async function cerrarNomina(idPersona: string, idUsuario: string, periodo: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  try {
    const supabase = getSupabaseServerClient();
    const sesion = await obtenerSesionConPermisos();

    // Si lo único que hay cargado es un estimado (ver estimarNomina), el
    // cierre real lo reemplaza automáticamente: anula el gasto estimado y
    // sigue de largo con el cálculo real — no hace falta que el usuario
    // borre nada a mano.
    const { data: existente } = await supabase
      .from("nomina_cierres")
      .select("id_cierre, id_gasto, es_estimado")
      .eq("id_persona", idPersona)
      .eq("periodo", periodo)
      .maybeSingle();
    if (existente) {
      if (!existente.es_estimado) return { error: "Ya cerraste la nómina de esta persona en este período." };
      if (existente.id_gasto) {
        await supabase
          .from("gastos")
          .update({ anulado: true, motivo_anulacion: "Reemplazado por cierre real de nómina", anulado_en: new Date().toISOString() })
          .eq("id_gasto", existente.id_gasto as string);
      }
      await supabase.from("nomina_cierres").delete().eq("id_cierre", existente.id_cierre as string);
    }

    const { data: usuario } = await supabase.from("usuarios").select("sueldo_base, valor_hora, nombre").eq("id_usuario", idUsuario).maybeSingle();
    const valorHora = (usuario?.valor_hora as number) || 0;
    const esPorHora = valorHora > 0;
    if (!usuario || (!usuario.sueldo_base && !esPorHora)) return { error: "Esta persona no tiene sueldo base ni valor hora cargado." };
    // El monto real siempre sale de horas fichadas hasta hoy × valor hora
    // (doble en feriados trabajados) — no se puede tipear a mano acá (para
    // eso está "Estimar").
    const montoBase = esPorHora ? (await calcularPagoPorHoraMes(idPersona, periodo, valorHora)).montoBase : (usuario.sueldo_base as number);

    const params = await obtenerParametrosPresentismo();
    const presentismoFilas = await calcularPresentismoMes(periodo);
    const presentismoResultado = presentismoFilas.find((f) => f.idPersona === idPersona)?.resultado ?? "COMPLETO";
    const factor = presentismoResultado === "COMPLETO" ? 1 : presentismoResultado === "PARCIAL" ? 0.5 : 0;
    // Se puede sacar el incentivo puntualmente en este cierre (tilde en el
    // modal) aunque lo haya ganado por presentismo — queda a criterio de
    // quien cierra, cierre a cierre.
    const incluirIncentivo = formData.get("incluir_incentivo") === "on";
    const incentivoPresentismo = incluirIncentivo ? redondear2(montoBase * (params.PRESENTISMO_PORCENTAJE_INCENTIVO / 100) * factor) : 0;

    const { desde, hasta } = rangoDelPeriodoStr(periodo);
    const { data: adelantosData } = await supabase
      .from("gastos")
      .select("monto")
      .eq("anulado", false)
      .eq("id_usuario_adelanto", idUsuario)
      .gte("fecha", `${desde}T00:00:00`)
      .lte("fecha", `${hasta}T23:59:59`);
    const adelantos = redondear2((adelantosData ?? []).reduce((acc, a) => acc + ((a.monto as number) ?? 0), 0));

    const horasExtraMonto = redondear2(Number(formData.get("horas_extra_monto") ?? 0) || 0);
    const horasExtraDetalle = String(formData.get("horas_extra_detalle") ?? "").trim() || null;
    const premiosMonto = redondear2(Number(formData.get("premios_monto") ?? 0) || 0);
    const premiosDetalle = String(formData.get("premios_detalle") ?? "").trim() || null;

    // Empleo formal: los aportes del empleado se descuentan del neto que
    // recibe, las contribuciones patronales no se le descuentan a él pero sí
    // son costo real de la empresa (van al gasto devengado). Los % son un
    // punto de partida editable a mano — varían según convenio/categoría,
    // por eso no se calculan fijos ni se valida contra nada.
    const esFormal = formData.get("es_formal") === "on";
    const aportesEmpleado = esFormal ? redondear2(Number(formData.get("aportes_empleado") ?? 0) || 0) : 0;
    const contribucionesPatronales = esFormal ? redondear2(Number(formData.get("contribuciones_patronales") ?? 0) || 0) : 0;

    const brutoDevengado = redondear2(montoBase + incentivoPresentismo + horasExtraMonto + premiosMonto);
    const gastoDevengado = redondear2(brutoDevengado + contribucionesPatronales);
    const netoAPagar = redondear2(brutoDevengado - aportesEmpleado - adelantos);

    const idCategoriaSueldos = await resolveCategoriaSueldos(supabase);
    const idSubcategoriaSueldos = await resolveSubcategoriaSueldos(supabase, idCategoriaSueldos);
    const { data: gastoCreado, error: errorGasto } = await supabase
      .from("gastos")
      .insert({
        id_categoria: idCategoriaSueldos,
        id_subcategoria: idSubcategoriaSueldos,
        tipo: "FIJO",
        medio_pago: "TRANSFERENCIA",
        monto: gastoDevengado,
        neto: gastoDevengado,
        descripcion: `Sueldo devengado — ${usuario.nombre} — ${periodo}`,
        usuario: sesion?.nombre ?? null,
      })
      .select("id_gasto")
      .single();
    if (errorGasto) return { error: friendlyDbError(errorGasto) };

    const { error } = await supabase.from("nomina_cierres").insert({
      id_persona: idPersona,
      periodo,
      sueldo_base: montoBase,
      presentismo_resultado: presentismoResultado,
      incentivo_presentismo: incentivoPresentismo,
      horas_extra_monto: horasExtraMonto,
      horas_extra_detalle: horasExtraDetalle,
      premios_monto: premiosMonto,
      premios_detalle: premiosDetalle,
      adelantos,
      neto_a_pagar: netoAPagar,
      id_gasto: gastoCreado.id_gasto,
      es_estimado: false,
      es_formal: esFormal,
      aportes_empleado: aportesEmpleado,
      contribuciones_patronales: contribucionesPatronales,
      usuario_cierre: sesion?.nombre ?? null,
    });
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/rrhh");
    revalidatePath("/resultado-mes");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cerrar la nómina" };
  }
}

// Carga un monto estimado (a mano) para verlo reflejado ya en el Estado de
// Resultados durante el mes, antes de tener el real — pensado sobre todo
// para empleados por hora, donde las horas fichadas todavía no están
// completas. cerrarNomina() lo reemplaza solo por el cálculo real cuando
// corresponda; también se puede reemplazar por otro estimado (re-estimar)
// o deshacer con eliminarCierreNomina.
export async function estimarNomina(idPersona: string, idUsuario: string, periodo: string, montoEstimado: number): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };
  if (!montoEstimado || montoEstimado <= 0) return { error: "Ingresá un monto estimado mayor a 0" };

  try {
    const supabase = getSupabaseServerClient();
    const sesion = await obtenerSesionConPermisos();

    const { data: existente } = await supabase
      .from("nomina_cierres")
      .select("id_cierre, id_gasto, es_estimado")
      .eq("id_persona", idPersona)
      .eq("periodo", periodo)
      .maybeSingle();
    if (existente && !existente.es_estimado) return { error: "Esta nómina ya está cerrada de forma definitiva." };
    if (existente) {
      if (existente.id_gasto) {
        await supabase
          .from("gastos")
          .update({ anulado: true, motivo_anulacion: "Estimado de nómina reemplazado", anulado_en: new Date().toISOString() })
          .eq("id_gasto", existente.id_gasto as string);
      }
      await supabase.from("nomina_cierres").delete().eq("id_cierre", existente.id_cierre as string);
    }

    const { data: usuario } = await supabase.from("usuarios").select("nombre").eq("id_usuario", idUsuario).maybeSingle();

    const { desde, hasta } = rangoDelPeriodoStr(periodo);
    const { data: adelantosData } = await supabase
      .from("gastos")
      .select("monto")
      .eq("anulado", false)
      .eq("id_usuario_adelanto", idUsuario)
      .gte("fecha", `${desde}T00:00:00`)
      .lte("fecha", `${hasta}T23:59:59`);
    const adelantos = redondear2((adelantosData ?? []).reduce((acc, a) => acc + ((a.monto as number) ?? 0), 0));

    const montoEstimadoRedondeado = redondear2(montoEstimado);
    const idCategoriaSueldos = await resolveCategoriaSueldos(supabase);
    const idSubcategoriaSueldos = await resolveSubcategoriaSueldos(supabase, idCategoriaSueldos);
    const { data: gastoCreado, error: errorGasto } = await supabase
      .from("gastos")
      .insert({
        id_categoria: idCategoriaSueldos,
        id_subcategoria: idSubcategoriaSueldos,
        tipo: "FIJO",
        medio_pago: "TRANSFERENCIA",
        monto: montoEstimadoRedondeado,
        neto: montoEstimadoRedondeado,
        descripcion: `Sueldo estimado — ${usuario?.nombre ?? ""} — ${periodo}`,
        usuario: sesion?.nombre ?? null,
      })
      .select("id_gasto")
      .single();
    if (errorGasto) return { error: friendlyDbError(errorGasto) };

    const { error } = await supabase.from("nomina_cierres").insert({
      id_persona: idPersona,
      periodo,
      sueldo_base: montoEstimadoRedondeado,
      presentismo_resultado: "COMPLETO",
      incentivo_presentismo: 0,
      horas_extra_monto: 0,
      premios_monto: 0,
      adelantos,
      neto_a_pagar: redondear2(montoEstimadoRedondeado - adelantos),
      id_gasto: gastoCreado.id_gasto,
      estado: "PENDIENTE_PAGO",
      es_estimado: true,
      usuario_cierre: sesion?.nombre ?? null,
    });
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/rrhh");
    revalidatePath("/resultado-mes");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cargar el estimado" };
  }
}

// Deshace un cierre que todavía no se pagó (por si se cargó algo mal) —
// anula el gasto que había generado, para no dejarlo suelto en el Estado
// de Resultados.
export async function eliminarCierreNomina(idCierre: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();
  const { data: cierre } = await supabase.from("nomina_cierres").select("estado, id_gasto").eq("id_cierre", idCierre).maybeSingle();
  if (!cierre) return { error: "No se encontró el cierre" };
  if (cierre.estado === "PAGADO") return { error: "Este sueldo ya está pagado — no se puede deshacer el cierre." };

  if (cierre.id_gasto) {
    await supabase
      .from("gastos")
      .update({ anulado: true, motivo_anulacion: "Cierre de nómina deshecho", anulado_en: new Date().toISOString() })
      .eq("id_gasto", cierre.id_gasto as string);
  }
  const { error } = await supabase.from("nomina_cierres").delete().eq("id_cierre", idCierre);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/rrhh");
  revalidatePath("/resultado-mes");
  return { error: null };
}

// Al pagar: se exige comprobante siempre. Si sale de Caja Administración,
// además descuenta el efectivo real; si es Transferencia, solo queda
// registrado como pagado (no hay cuentas bancarias con saldo propio en el
// sistema todavía).
export async function pagarNomina(idCierre: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const cuentaPago = String(formData.get("cuenta_pago") ?? "");
  if (!["CAJA_ADMIN", "TRANSFERENCIA"].includes(cuentaPago)) return { error: "Elegí de dónde sale la plata" };
  const archivo = formData.get("comprobante") as File | null;
  if (!archivo || archivo.size === 0) return { error: "El comprobante es obligatorio para registrar el pago." };

  try {
    const supabase = getSupabaseServerClient();
    const sesion = await obtenerSesionConPermisos();

    const { data: cierre } = await supabase.from("nomina_cierres").select("*").eq("id_cierre", idCierre).maybeSingle();
    if (!cierre) return { error: "No se encontró el cierre" };
    if (cierre.estado === "PAGADO") return { error: "Este sueldo ya está pagado." };

    const extension = archivo.name.split(".").pop() ?? "pdf";
    const path = `${idCierre}.${extension}`;
    const { error: errorUpload } = await supabase.storage
      .from("recibos-sueldo")
      .upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
    if (errorUpload) return { error: errorUpload.message };

    if (cuentaPago === "CAJA_ADMIN") {
      await supabase.from("movimientos_caja_admin").insert({
        tipo: "EGRESO_GASTO",
        monto: -(cierre.neto_a_pagar as number),
        id_gasto: cierre.id_gasto,
        descripcion: `Pago de sueldo — período ${cierre.periodo as string}`,
        usuario: sesion?.nombre ?? null,
      });
    }

    const { error } = await supabase
      .from("nomina_cierres")
      .update({
        estado: "PAGADO",
        fecha_pago: new Date().toISOString(),
        cuenta_pago: cuentaPago,
        comprobante_path: path,
        usuario_pago: sesion?.nombre ?? null,
      })
      .eq("id_cierre", idCierre);
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/rrhh");
    revalidatePath("/tesoreria");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar el pago" };
  }
}

export async function obtenerUrlReciboSueldo(path: string): Promise<string> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.storage.from("recibos-sueldo").createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
