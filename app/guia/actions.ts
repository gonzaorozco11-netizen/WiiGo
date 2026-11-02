"use server";

import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { esRolInterno } from "@/lib/rolesInternos";
import { obtenerSesionConPantallas, puedeVerPantalla, type SesionConPantallas } from "@/lib/roles";
import { obtenerSesionMarca } from "@/lib/marcaSesion";
import { obtenerSesionProfesional } from "@/lib/profesionalSesion";
import { mesesVinculo } from "@/lib/pacientesProfesional";
import { reglasPuntos } from "@/lib/puntosProfesionales";
import { fechaHoraArgentina } from "@/lib/horarios";
import { GUIAS, GLOSARIO, NOVEDADES } from "@/lib/guia/contenido";
import type { Audiencia, DatosGuia, Guia, GuiaLista, PreguntaPendiente } from "@/lib/guia/tipos";
import type { SupabaseClient } from "@supabase/supabase-js";

// Guía WiiGo: arma lo que ve cada persona en "¿Alguna duda?" y recibe las
// preguntas que no encontraron respuesta.
//
// Quién es sale siempre de la sesión, nunca del navegador: la `audiencia`
// que manda el panel solo dice desde qué parte del sistema pregunta, y se
// comprueba contra la sesión de esa parte (equipo, portal o su espacio).

type Quien = {
  audiencia: Audiencia;
  idUsuario: string;
  nombre: string;
  esAdmin: boolean;
  puedePreguntar: boolean;
  pantallas: SesionConPantallas | null;
  idMarca: string | null;
  nombreMarca: string | null;
};

async function quienEs(audiencia: Audiencia): Promise<Quien | null> {
  if (audiencia === "interno") {
    const sesion = await obtenerSesionConPantallas();
    if (!sesion || !esRolInterno(sesion.rol)) return null;
    return {
      audiencia,
      idUsuario: sesion.idUsuario,
      nombre: sesion.nombre,
      esAdmin: sesion.rol === "admin",
      puedePreguntar: true,
      pantallas: sesion,
      idMarca: null,
      nombreMarca: null,
    };
  }
  if (audiencia === "marca") {
    const sesion = await obtenerSesionMarca();
    if (!sesion) return null;
    return {
      audiencia,
      idUsuario: sesion.idUsuario,
      nombre: `${sesion.nombreUsuario} (${sesion.nombreMarca})`,
      esAdmin: false,
      puedePreguntar: true,
      pantallas: null,
      idMarca: sesion.idMarca,
      nombreMarca: sesion.nombreMarca,
    };
  }
  const sesion = await obtenerSesionProfesional();
  if (!sesion) return null;
  return {
    audiencia,
    idUsuario: sesion.idUsuario,
    nombre: [sesion.nombre, sesion.apellido].filter(Boolean).join(" "),
    // Gonzalo mirando su espacio ve la guía de ella, sin su bandeja.
    esAdmin: false,
    puedePreguntar: !sesion.soloLectura,
    pantallas: null,
    idMarca: null,
    nombreMarca: null,
  };
}

const pct = (n: number) => `${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })} %`;
const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const lista = (nombres: string[]) =>
  nombres.length <= 1 ? nombres.join("") : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;

/** Los números reales que van adentro de los textos ({pctCliente}, {meses}…). */
async function valoresReales(supabase: SupabaseClient, quien: Quien) {
  const hoy = fechaHoraArgentina().fecha;
  const [confRes, marcasRes, cfgRes, meses, ptsProf] = await Promise.all([
    supabase
      .from("config_profesionales_marca")
      .select("id_marca, porcentaje_cliente, porcentaje_profesional, fecha_desde")
      .eq("estado", "ACTIVA")
      .eq("participa", true)
      .lte("fecha_desde", hoy)
      .or(`fecha_hasta.is.null,fecha_hasta.gte.${hoy}`)
      .order("fecha_desde", { ascending: false }),
    supabase.from("marcas").select("id_marca, nombre, tipo_comercializacion").eq("estado", "ACTIVA"),
    supabase
      .from("configuracion")
      .select("parametro, valor")
      .in("parametro", ["PUNTOS_CADA_MONTO", "PUNTOS_OTORGADOS", "PUNTOS_OTORGADOS_PROPIOS", "PUNTOS_VALOR_PESOS", "PUNTOS_TOPE_CANJE_PORCENTAJE"]),
    mesesVinculo(supabase).catch(() => 6),
    reglasPuntos(supabase).catch(() => null),
  ]);

  // La configuración vigente de cada marca (la más nueva).
  const vigente = new Map<string, { cliente: number; profesional: number }>();
  for (const c of confRes.data ?? []) {
    if (vigente.has(c.id_marca as string)) continue;
    vigente.set(c.id_marca as string, { cliente: Number(c.porcentaje_cliente ?? 0), profesional: Number(c.porcentaje_profesional ?? 0) });
  }
  const marcas = (marcasRes.data ?? []) as { id_marca: string; nombre: string; tipo_comercializacion: string }[];
  const participan = marcas.filter((m) => vigente.has(m.id_marca));
  const nombresPrograma = participan.map((m) => m.nombre).sort((a, b) => a.localeCompare(b, "es"));

  // Para la marca, sus %; para las demás, el de todas si es el mismo, o el rango.
  let cliente: number;
  let profesional: number;
  let sinPrograma = false;
  if (quien.audiencia === "marca") {
    const suya = quien.idMarca ? vigente.get(quien.idMarca) : undefined;
    cliente = suya?.cliente ?? 0;
    profesional = suya?.profesional ?? 0;
    sinPrograma = !suya;
  } else {
    const todos = [...vigente.values()];
    cliente = todos.length ? Math.max(...todos.map((v) => v.cliente)) : 0;
    profesional = todos.length ? Math.max(...todos.map((v) => v.profesional)) : 0;
  }
  const rango = (campo: "cliente" | "profesional") => {
    const valores = [...vigente.values()].map((v) => v[campo]);
    if (valores.length === 0) return pct(0);
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    return min === max ? pct(max) : `entre ${pct(min)} y ${pct(max)}`;
  };

  const cfg = Object.fromEntries((cfgRes.data ?? []).map((r) => [r.parametro as string, Number(r.valor ?? 0)]));
  // El ejemplo de la tabla: una marca de verdad que participe, que no sea la propia.
  const ejemplo = quien.nombreMarca ?? participan.find((m) => m.tipo_comercializacion !== "PROPIA")?.nombre ?? participan[0]?.nombre ?? "una marca";
  const compra = 10000;

  return {
    sinPrograma,
    valores: {
      marca: quien.nombreMarca ?? "la marca",
      marcasPrograma: nombresPrograma.length ? lista(nombresPrograma) : "ninguna por ahora",
      pctCliente: quien.audiencia === "marca" ? pct(cliente) : rango("cliente"),
      pctProfesional: quien.audiencia === "marca" ? pct(profesional) : rango("profesional"),
      meses: String(meses),
      ejemploMarca: ejemplo,
      ejCompra: pesos(compra),
      ejPagaPrimera: pesos(compra * (1 - cliente / 100)),
      ejSuma: `+${pesos((compra * profesional) / 100)}`,
      ejMarcaPrimera: pesos((compra * (cliente + profesional)) / 100),
      ejMarcaOtra: pesos((compra * profesional) / 100),
      cadaMonto: pesos(cfg.PUNTOS_CADA_MONTO || 1000),
      ptsMarcas: String(cfg.PUNTOS_OTORGADOS ?? 0),
      ptsPropios: String(cfg.PUNTOS_OTORGADOS_PROPIOS ?? cfg.PUNTOS_OTORGADOS ?? 0),
      valorPunto: pesos(cfg.PUNTOS_VALOR_PESOS ?? 0),
      topeCanje: pct(cfg.PUNTOS_TOPE_CANJE_PORCENTAJE ?? 0),
      ptsPaciente: String(ptsProf?.ptsPaciente ?? 10),
      ptsHistoria: String(ptsProf?.ptsHistoria ?? 5),
      historiasSemana: String(ptsProf?.historiasSemana ?? 2),
      ptsReel: String(ptsProf?.ptsReel ?? 15),
      reelCadaDias: String(ptsProf?.reelCadaDias ?? 15),
    } as Record<string, string>,
  };
}

// Los textos de la guía llevan negritas (<b>) y se muestran como HTML. Los
// valores que se meten adentro (nombres de marcas, números) se escapan: un
// nombre con "<" no puede romper ni inyectar nada.
const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function completar(texto: string, valores: Record<string, string>) {
  return texto.replace(/\{(\w+)\}/g, (todo, clave: string) => (clave in valores ? escapar(valores[clave]) : todo));
}

function laVe(quien: Quien, item: { audiencias: Audiencia[]; soloAdmin?: boolean; pantalla?: string }) {
  if (!item.audiencias.includes(quien.audiencia)) return false;
  if (quien.audiencia !== "interno") return true;
  if (item.soloAdmin && !quien.esAdmin) return false;
  if (item.pantalla && !puedeVerPantalla(quien.pantallas, item.pantalla)) return false;
  return true;
}

const DIA_MS = 86400000;
const esReciente = (fecha: string | undefined, dias: number) => !!fecha && Date.now() - new Date(`${fecha}T12:00:00-03:00`).getTime() < dias * DIA_MS;

export async function datosDeGuia(audiencia: Audiencia): Promise<DatosGuia | null> {
  const quien = await quienEs(audiencia);
  if (!quien) return null;
  const supabase = getSupabaseServerClient();
  const { valores, sinPrograma } = await valoresReales(supabase, quien);

  const visibles = GUIAS.filter((g) => laVe(quien, g));
  const ids = new Set(visibles.map((g) => g.id));
  const guias: GuiaLista[] = visibles.map((g: Guia) => ({
    id: g.id,
    tema: g.tema,
    titulo: completar(g.titulo, valores),
    donde: completar(g.donde, valores),
    pasos: g.pasos?.map((p) => completar(p, valores)),
    puntos: g.puntos?.map((p) => completar(p, valores)),
    tip: g.tip ? completar(g.tip, valores) : undefined,
    // La marca que no participa del programa no ve el ejemplo con plata.
    tabla:
      g.tabla && !sinPrograma
        ? { titulo: completar(g.tabla.titulo, valores), cab: g.tabla.cab.map((c) => completar(c, valores)), filas: g.tabla.filas.map((f) => f.map((c) => completar(c, valores))) }
        : undefined,
    rel: g.rel?.filter((r) => ids.has(r)),
    rutas: g.rutas,
    esNueva: esReciente(g.nueva, 30),
  }));

  // Preguntas: las frecuentes de su parte, las suyas y, para el Dueño, la bandeja.
  const [frecRes, mias, pend] = await Promise.all([
    supabase
      .from("preguntas_guia")
      .select("id_pregunta, pregunta, respuesta")
      .eq("audiencia", audiencia)
      .eq("estado", "RESPONDIDA")
      .eq("publica", true)
      .order("respondida_el", { ascending: false })
      .limit(40),
    supabase
      .from("preguntas_guia")
      .select("id_pregunta, pregunta, respuesta, creada_el, estado")
      .eq("id_usuario", quien.idUsuario)
      .neq("estado", "DESCARTADA")
      .order("creada_el", { ascending: false })
      .limit(10),
    quien.esAdmin
      ? supabase.from("preguntas_guia").select("id_pregunta, pregunta, quien, audiencia, pantalla, creada_el").eq("estado", "PENDIENTE").order("creada_el")
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
  ]);

  return {
    audiencia,
    quien: quien.nombre,
    esAdmin: quien.esAdmin,
    guias,
    glosario: GLOSARIO.filter((t) => laVe(quien, t)).map((t) => ({ termino: t.termino, definicion: completar(t.definicion, valores) })),
    novedades: NOVEDADES.filter((n) => laVe(quien, n) && esReciente(n.fecha, 90))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .map((n) => ({ fecha: n.fecha, titulo: n.titulo, detalle: completar(n.detalle, valores) })),
    frecuentes: (frecRes.data ?? []).map((p) => ({ id: p.id_pregunta as string, pregunta: p.pregunta as string, respuesta: (p.respuesta as string) ?? "" })),
    misPreguntas: (mias.data ?? []).map((p) => ({
      id: p.id_pregunta as string,
      pregunta: p.pregunta as string,
      respuesta: (p.respuesta as string | null) ?? null,
      fecha: p.creada_el as string,
    })),
    pendientes: ((pend.data ?? []) as Record<string, unknown>[]).map(
      (p): PreguntaPendiente => ({
        id: p.id_pregunta as string,
        pregunta: p.pregunta as string,
        quien: (p.quien as string) ?? "Alguien",
        audiencia: p.audiencia as Audiencia,
        pantalla: (p.pantalla as string | null) ?? null,
        fecha: p.creada_el as string,
      })
    ),
    // Sin el SQL corrido la tabla no existe: el panel no ofrece preguntar.
    preguntasDisponibles: !frecRes.error && quien.puedePreguntar,
  };
}

const SIN_SQL = "Todavía no se pueden mandar preguntas: WiiGo lo está terminando de preparar.";

export async function preguntarEnGuia(audiencia: Audiencia, pregunta: string, pantalla: string): Promise<{ error: string | null }> {
  const quien = await quienEs(audiencia);
  if (!quien) return { error: "Tu sesión se cerró. Volvé a entrar." };
  if (!quien.puedePreguntar) return { error: "Estás mirando su espacio: desde acá no se manda nada." };
  const texto = pregunta.trim().slice(0, 600);
  if (texto.length < 5) return { error: "Escribí tu pregunta con un poco más de detalle." };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("preguntas_guia").insert({
    audiencia,
    id_usuario: quien.idUsuario,
    quien: quien.nombre,
    pregunta: texto,
    pantalla: pantalla.slice(0, 120) || null,
  });
  if (error) return { error: SIN_SQL };
  return { error: null };
}

async function exigirAdmin() {
  const cookieStore = await cookies();
  const sesion = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  return sesion?.rol === "admin";
}

/** Gonzalo responde. Con `publica`, queda en Preguntas frecuentes para todos los de esa parte. */
export async function responderPreguntaGuia(idPregunta: string, respuesta: string, publica: boolean): Promise<{ error: string | null }> {
  if (!(await exigirAdmin())) return { error: "Las preguntas las responde el Dueño." };
  const texto = respuesta.trim().slice(0, 1500);
  if (!texto) return { error: "Escribí la respuesta." };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("preguntas_guia")
    .update({ respuesta: texto, publica, estado: "RESPONDIDA", respondida_el: new Date().toISOString() })
    .eq("id_pregunta", idPregunta);
  if (error) return { error: SIN_SQL };
  return { error: null };
}

export async function descartarPreguntaGuia(idPregunta: string): Promise<{ error: string | null }> {
  if (!(await exigirAdmin())) return { error: "Las preguntas las maneja el Dueño." };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("preguntas_guia").update({ estado: "DESCARTADA" }).eq("id_pregunta", idPregunta);
  if (error) return { error: SIN_SQL };
  return { error: null };
}
