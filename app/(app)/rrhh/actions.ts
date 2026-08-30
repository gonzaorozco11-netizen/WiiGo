"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";

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

  const idsPersona = (personas ?? []).map((p) => p.id_persona as string);
  const { data: fichajes } = await supabase
    .from("fichajes")
    .select("id_persona, tipo, fecha_hora, estado, justificado")
    .in("id_persona", idsPersona.length > 0 ? idsPersona : ["00000000-0000-0000-0000-000000000000"])
    .gte("fecha_hora", `${desdeStr}T00:00:00`)
    .lte("fecha_hora", `${hastaStr}T23:59:59`);

  const resultado: PresentismoFila[] = [];
  for (const p of personas ?? []) {
    const diasSemana = horarioPorId.get(p.id_horario as string);
    if (!diasSemana) continue;
    const fichajesPersona = (fichajes ?? []).filter((f) => f.id_persona === p.id_persona);

    const tardanzas = fichajesPersona.filter((f) => f.tipo === "ENTRADA" && f.estado === "TARDE" && !f.justificado).length;
    const salidasAnticipadas = fichajesPersona.filter((f) => f.tipo === "SALIDA" && f.estado === "ANTICIPADA" && !f.justificado).length;

    const diasEsperados: string[] = [];
    const cursor = new Date(desde);
    while (cursor <= hasta) {
      const isoDow = cursor.getDay() === 0 ? 7 : cursor.getDay();
      if (diasSemana.includes(isoDow)) diasEsperados.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    const diasConEntrada = new Set(fichajesPersona.filter((f) => f.tipo === "ENTRADA").map((f) => (f.fecha_hora as string).slice(0, 10)));
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
    .gte("fecha_hora", `${desdeStr}T00:00:00`)
    .lte("fecha_hora", `${hastaStr}T23:59:59`)
    .order("fecha_hora", { ascending: true });

  const porDia = new Map<string, { entrada?: string; salida?: string; estadoEntrada?: string; estadoSalida?: string }>();
  for (const f of fichajes ?? []) {
    const fechaHora = f.fecha_hora as string;
    const fecha = fechaHora.slice(0, 10);
    const hora = fechaHora.slice(11, 16);
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
