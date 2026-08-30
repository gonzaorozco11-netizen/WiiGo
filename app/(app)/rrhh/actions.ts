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

// Sin el módulo de Vacaciones/Licencias (todavía no armado) no hay forma de
// distinguir una ausencia autorizada de una falta real — por ahora toda
// falta cuenta como injustificada. Se retoma cuando se sume esa fase.
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

  const resultado: PresentismoFila[] = [];
  for (const p of personas ?? []) {
    const diasSemana = horarioPorId.get(p.id_horario as string);
    if (!diasSemana) continue;
    const fichajesPersona = fichajes.filter((f) => f.id_persona === p.id_persona);

    const tardanzas = fichajesPersona.filter((f) => f.tipo === "ENTRADA" && f.estado === "TARDE" && !f.justificado).length;
    const salidasAnticipadas = fichajesPersona.filter((f) => f.tipo === "SALIDA" && f.estado === "ANTICIPADA" && !f.justificado).length;

    const diasEsperados: string[] = [];
    const cursor = new Date(desde);
    while (cursor <= hasta) {
      const isoDow = cursor.getDay() === 0 ? 7 : cursor.getDay();
      if (diasSemana.includes(isoDow)) diasEsperados.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    const diasConEntrada = new Set(fichajesPersona.filter((f) => f.tipo === "ENTRADA").map((f) => f.fechaArg));
    const faltas = diasEsperados.filter((d) => !diasConEntrada.has(d)).length;

    let resultadoPresentismo: PresentismoFila["resultado"] = "COMPLETO";
    if (faltas >= params.PRESENTISMO_MAX_FALTAS || tardanzas > params.PRESENTISMO_MAX_TARDANZAS || salidasAnticipadas > params.PRESENTISMO_MAX_SALIDAS_ANTICIPADAS) {
      resultadoPresentismo = "PERDIDO";
    } else if (tardanzas >= params.PRESENTISMO_TARDANZAS_PARA_PARCIAL) {
      resultadoPresentismo = "PARCIAL";
    }

    resultado.push({
      idPersona: p.id_persona as string,
      nombre: `${p.nombre as string} ${(p.apellido as string | null) ?? ""}`.trim(),
      tardanzas,
      faltas,
      salidasAnticipadas,
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
