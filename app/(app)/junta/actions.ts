"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas } from "@/lib/roles";
import { hayClaveIA } from "@/lib/ia";
import { consultar, datosDelNegocio, type TareaPropuesta } from "@/lib/junta";
import { generarReporte, type TipoReporte } from "@/lib/juntaReportes";
import { diaDeTexto, equipoParaTareas, resolverPara, tareasParaJunta, type TareaVista } from "@/lib/tareasEquipo";
import { ES_ENCARGADO, textoLegible, type DestinoJunta, type MensajeJunta } from "@/lib/juntaPersonajes";

// La Junta es solo del Dueño: ve todos los números del negocio.

const faltaTabla = (m: string) => /junta_mensajes|schema cache|does not exist/i.test(m);
/** Cuánto de la conversación anterior se les manda: lo último alcanza y cuesta menos. */
const MEMORIA = 12;

async function esDueno() {
  const s = await obtenerSesionConPantallas();
  return s?.rol === "admin";
}

type Fila = { id_mensaje: string; hilo: string; autor: string; texto: string; puntos: string[] | null; lamina: MensajeJunta["lamina"]; creado: string };
const aMensaje = (f: Fila): MensajeJunta => ({
  id: f.id_mensaje,
  hilo: f.hilo as DestinoJunta,
  autor: f.autor as MensajeJunta["autor"],
  texto: f.autor === "gonzalo" ? f.texto : textoLegible(f.texto),
  puntos: f.puntos ?? undefined,
  lamina: f.lamina,
  creado: f.creado,
});

/** Lo último de cada hilo, para abrir la pantalla donde quedó. */
export async function leerConversaciones(): Promise<{ mensajes: MensajeJunta[]; faltaSql: boolean }> {
  if (!(await esDueno())) return { mensajes: [], faltaSql: false };
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("junta_mensajes")
    .select("id_mensaje, hilo, autor, texto, puntos, lamina, creado")
    .order("creado", { ascending: false })
    .limit(300);
  if (error) return { mensajes: [], faltaSql: faltaTabla(error.message) };
  return { mensajes: ((data ?? []) as Fila[]).map(aMensaje).reverse(), faltaSql: false };
}

export async function preguntar(
  destino: DestinoJunta,
  texto: string,
  historialLocal: MensajeJunta[]
): Promise<{ error: string } | { mensajes: MensajeJunta[] }> {
  if (!(await esDueno())) return { error: "La Junta es solo para el Dueño." };
  if (destino !== "junta" && !ES_ENCARGADO(destino)) return { error: "No encontré a ese encargado." };
  const pregunta = texto.trim().slice(0, 2000);
  if (!pregunta) return { error: "Escribí qué querés charlar." };
  if (!hayClaveIA()) return { error: "Falta conectar la inteligencia artificial: cargá ANTHROPIC_API_KEY en Vercel." };

  const supabase = getSupabaseServerClient();
  // La memoria sale de la base si está; si no, de lo que tiene la pantalla.
  let historial = historialLocal.filter((m) => m.hilo === destino).slice(-MEMORIA);
  let guarda = true;
  const previo = await supabase
    .from("junta_mensajes")
    .select("id_mensaje, hilo, autor, texto, puntos, lamina, creado")
    .eq("hilo", destino)
    .order("creado", { ascending: false })
    .limit(MEMORIA);
  if (previo.error) guarda = false;
  else historial = ((previo.data ?? []) as Fila[]).map(aMensaje).reverse();

  let respuesta;
  try {
    respuesta = await consultar(destino, pregunta, historial);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "La junta no pudo responder. Probá de nuevo." };
  }

  const ahora = Date.now();
  const filas = [
    { hilo: destino, autor: "gonzalo", texto: pregunta, puntos: null, lamina: null },
    ...respuesta.respuestas.map((r) => ({ hilo: destino, autor: r.autor, texto: r.texto, puntos: null, lamina: r.lamina })),
    ...(respuesta.resumen ? [{ hilo: destino, autor: "resumen", texto: respuesta.resumen.texto, puntos: respuesta.resumen.puntos, lamina: respuesta.resumen.lamina }] : []),
  ].map((f, i) => ({ ...f, creado: new Date(ahora + i).toISOString() }));

  let mensajes: MensajeJunta[] = filas.map((f, i) => aMensaje({ ...f, id_mensaje: `local-${ahora}-${i}` } as Fila));
  if (guarda) {
    const { data, error } = await supabase.from("junta_mensajes").insert(filas).select("id_mensaje, hilo, autor, texto, puntos, lamina, creado");
    if (!error && data) mensajes = (data as Fila[]).map(aMensaje).sort((a, b) => a.creado.localeCompare(b.creado));
  }
  // Sin la tabla de mensajes se muestra igual, solo que no queda guardado.

  // Las tareas que propusieron quedan esperando que el Dueño las apruebe.
  const propuestas = respuesta.respuestas.flatMap((r) => r.tareas.map((t) => ({ autor: r.autor, t })));
  if (propuestas.length) {
    const equipo = await equipoParaTareas(supabase);
    const idMensaje = (autor: string) => mensajes.find((m) => m.autor === autor && !m.id.startsWith("local-"))?.id ?? null;
    const repite = (t: TareaPropuesta) => diaDeTexto(t.repite);
    await supabase.from("tareas_equipo").insert(
      propuestas.map(({ autor, t }) => ({
        titulo: t.titulo,
        motivo: t.motivo ?? null,
        propuesta_por: autor,
        id_mensaje: idMensaje(autor),
        ...resolverPara(t.para, equipo),
        repite_dia: repite(t),
        vence: repite(t) ? null : t.cuando ?? null,
        estado: "PROPUESTA",
      }))
    );
  }
  return { mensajes };
}

// ---------- Tareas del equipo ----------

export async function listarTareasJunta() {
  if (!(await esDueno())) return { tareas: [] as TareaVista[], equipo: { turnos: [], personas: [] }, faltaSql: false };
  return tareasParaJunta(getSupabaseServerClient());
}

export type CambiosTarea = {
  titulo: string;
  paraTipo: "TODOS" | "TURNO" | "PERSONA";
  idHorario: string | null;
  idPersona: string | null;
  vence: string | null;
  repiteDia: number | null;
};

function limpiarCambios(c: CambiosTarea) {
  const titulo = c.titulo.trim().slice(0, 140);
  if (!titulo) return { error: "La tarea necesita un texto." } as const;
  if (c.paraTipo === "TURNO" && !c.idHorario) return { error: "Elegí el turno." } as const;
  if (c.paraTipo === "PERSONA" && !c.idPersona) return { error: "Elegí la persona." } as const;
  const repite = c.repiteDia && c.repiteDia >= 1 && c.repiteDia <= 7 ? c.repiteDia : null;
  return {
    fila: {
      titulo,
      para_tipo: c.paraTipo,
      id_horario: c.paraTipo === "TURNO" ? c.idHorario : null,
      id_persona: c.paraTipo === "PERSONA" ? c.idPersona : null,
      repite_dia: repite,
      vence: repite ? null : c.vence && /^\d{4}-\d{2}-\d{2}$/.test(c.vence) ? c.vence : null,
    },
  } as const;
}

/** Aprobar (con los cambios que haya hecho el Dueño): desde ahí le aparece al equipo. */
export async function aprobarTarea(idTarea: string, cambios: CambiosTarea): Promise<{ error: string | null }> {
  const s = await obtenerSesionConPantallas();
  if (s?.rol !== "admin") return { error: "Solo el Dueño aprueba tareas." };
  const limpio = limpiarCambios(cambios);
  if ("error" in limpio) return { error: limpio.error ?? null };
  const { error } = await getSupabaseServerClient()
    .from("tareas_equipo")
    .update({ ...limpio.fila, estado: "ACTIVA", aprobado_en: new Date().toISOString(), aprobado_por: s.nombre })
    .eq("id_tarea", idTarea);
  if (error) return { error: error.message };
  revalidatePath("/mis-tareas");
  return { error: null };
}

/** Una tarea que carga el Dueño a mano: queda activa directamente. */
export async function crearTarea(cambios: CambiosTarea): Promise<{ error: string | null }> {
  const s = await obtenerSesionConPantallas();
  if (s?.rol !== "admin") return { error: "Solo el Dueño carga tareas." };
  const limpio = limpiarCambios(cambios);
  if ("error" in limpio) return { error: limpio.error ?? null };
  const { error } = await getSupabaseServerClient()
    .from("tareas_equipo")
    .insert({ ...limpio.fila, propuesta_por: "admin", estado: "ACTIVA", aprobado_en: new Date().toISOString(), aprobado_por: s.nombre });
  if (error) return { error: faltaTablaTareas(error.message) ? "Falta correr sql/tareas-equipo.sql en Supabase." : error.message };
  revalidatePath("/mis-tareas");
  return { error: null };
}

/** Descartar una propuesta, o sacar del equipo una tarea activa (queda en el historial). */
export async function cerrarTarea(idTarea: string, como: "DESCARTADA" | "ARCHIVADA"): Promise<{ error: string | null }> {
  if (!(await esDueno())) return { error: "Solo el Dueño puede hacer esto." };
  const { error } = await getSupabaseServerClient().from("tareas_equipo").update({ estado: como }).eq("id_tarea", idTarea);
  if (error) return { error: error.message };
  revalidatePath("/mis-tareas");
  return { error: null };
}

const faltaTablaTareas = (m: string) => /tareas_equipo|schema cache|does not exist/i.test(m);

// ---------- Reportes ----------

export type ReporteListado = { id: string; tipo: TipoReporte; fecha: string; titulo: string; titular: string | null; enviadoA: string | null; error: string | null };

export async function listarReportes(): Promise<{ reportes: ReporteListado[]; faltaSql: boolean }> {
  if (!(await esDueno())) return { reportes: [], faltaSql: false };
  const { data, error } = await getSupabaseServerClient()
    .from("junta_reportes")
    .select("id_reporte, tipo, fecha, titulo, titular, enviado_a, error")
    .order("creado", { ascending: false })
    .limit(40);
  if (error) return { reportes: [], faltaSql: /junta_reportes|schema cache|does not exist/i.test(error.message) };
  return {
    reportes: (data ?? []).map((r) => ({
      id: r.id_reporte as string,
      tipo: r.tipo as TipoReporte,
      fecha: r.fecha as string,
      titulo: r.titulo as string,
      titular: (r.titular as string | null) ?? null,
      enviadoA: (r.enviado_a as string | null) ?? null,
      error: (r.error as string | null) ?? null,
    })),
    faltaSql: false,
  };
}

/** El mail tal cual se mandó, para verlo en la Junta. */
export async function verReporte(idReporte: string): Promise<{ html: string | null }> {
  if (!(await esDueno())) return { html: null };
  const { data } = await getSupabaseServerClient().from("junta_reportes").select("html").eq("id_reporte", idReporte).maybeSingle();
  return { html: (data?.html as string | null) ?? null };
}

/** Armarlo ahora, sin esperar a mañana (lo vuelve a armar aunque ya exista el de hoy). */
export async function generarReporteAhora(tipo: TipoReporte): Promise<{ error: string | null; mensaje?: string }> {
  if (!(await esDueno())) return { error: "Solo el Dueño." };
  if (!hayClaveIA()) return { error: "Falta conectar la inteligencia artificial." };
  try {
    const r = await generarReporte(getSupabaseServerClient(), tipo, { forzar: true, contexto: await datosDelNegocio(), base: process.env.APP_URL ?? "" });
    return r.ok ? { error: null, mensaje: r.mensaje } : { error: r.mensaje };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo armar el reporte." };
  }
}
