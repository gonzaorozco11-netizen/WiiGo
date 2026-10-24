"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas } from "@/lib/roles";
import { hayClaveIA } from "@/lib/ia";
import { consultar } from "@/lib/junta";
import { ES_ENCARGADO, type DestinoJunta, type MensajeJunta } from "@/lib/juntaPersonajes";

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
  texto: f.texto,
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

  if (guarda) {
    const { data, error } = await supabase.from("junta_mensajes").insert(filas).select("id_mensaje, hilo, autor, texto, puntos, lamina, creado");
    if (!error && data) return { mensajes: (data as Fila[]).map(aMensaje).sort((a, b) => a.creado.localeCompare(b.creado)) };
  }
  // Sin la tabla: se muestra igual, solo que no queda guardado.
  return { mensajes: filas.map((f, i) => aMensaje({ ...f, id_mensaje: `local-${ahora}-${i}` } as Fila)) };
}
