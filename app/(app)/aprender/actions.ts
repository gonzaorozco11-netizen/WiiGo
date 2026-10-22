"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { hayClaveIA } from "@/lib/ia";
import { actualizarFichaProducto, actualizarFichaTema, type FichaProducto, type FichaTema } from "@/lib/aprender";

// Aprender: el equipo estudia los productos (pantalla "aprender") y el Dueño
// revisa y aprueba lo que escribe la IA (pantalla "aprender-revisar", o admin).

const FALTA_SQL = "Falta correr sql/aprender.sql en Supabase.";
const faltaTabla = (m: string) => /aprender_|schema cache|does not exist/i.test(m);

async function sesionQueVe() {
  const s = await obtenerSesionConPantallas();
  return s && (puedeVerPantalla(s, "aprender") || puedeVerPantalla(s, "aprender-revisar")) ? s : null;
}
async function sesionQueRevisa() {
  const s = await obtenerSesionConPantallas();
  return s && (s.rol === "admin" || puedeVerPantalla(s, "aprender-revisar")) ? s : null;
}

export type ProductoAprender = {
  idProducto: string;
  nombre: string;
  marca: string;
  imagen: string | null;
  precio: number | null;
  ficha: FichaProducto;
  repasado: boolean;
};
export type TemaAprender = { clave: string; nombre: string; ficha: FichaTema | null; productos: ProductoAprender[] };
export type DatosAprender = { temas: TemaAprender[]; marcas: string[]; total: number; repasados: number; faltaSql: boolean };

/** Lo que estudia el equipo: solo lo aprobado, por tema. */
export async function obtenerAprender(): Promise<DatosAprender> {
  const sesion = await sesionQueVe();
  if (!sesion) throw new Error("No tenés esta pantalla habilitada.");
  const supabase = getSupabaseServerClient();
  const { data: fichas, error } = await supabase.from("aprender_fichas").select("tipo, id_producto, id_subcategoria, aprobado").not("aprobado", "is", null);
  if (error) {
    if (faltaTabla(error.message)) return { temas: [], marcas: [], total: 0, repasados: 0, faltaSql: true };
    throw new Error(error.message);
  }
  const idsProducto = (fichas ?? []).filter((f) => f.tipo === "PRODUCTO").map((f) => f.id_producto as string);
  const [{ data: prods }, { data: subs }, { data: marcas }, { data: progreso }] = await Promise.all([
    idsProducto.length
      ? supabase.from("productos").select("id_producto, nombre, id_marca, id_subcategoria, imagen, precio_venta, estado").in("id_producto", idsProducto)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase.from("subcategorias").select("id_subcategoria, nombre"),
    supabase.from("marcas").select("id_marca, nombre"),
    supabase.from("aprender_progreso").select("id_producto").eq("id_usuario", sesion.idUsuario),
  ]);
  const fichaProducto = new Map((fichas ?? []).filter((f) => f.tipo === "PRODUCTO").map((f) => [f.id_producto as string, f.aprobado as FichaProducto]));
  const fichaTema = new Map((fichas ?? []).filter((f) => f.tipo === "TEMA").map((f) => [f.id_subcategoria as string, f.aprobado as FichaTema]));
  const nombreSub = new Map((subs ?? []).map((s) => [s.id_subcategoria as string, s.nombre as string]));
  const nombreMarca = new Map((marcas ?? []).map((m) => [m.id_marca as string, m.nombre as string]));
  const repasados = new Set((progreso ?? []).map((p) => p.id_producto as string));

  const temas = new Map<string, TemaAprender>();
  for (const p of prods ?? []) {
    if (p.estado !== "ACTIVO") continue;
    const clave = (p.id_subcategoria as string | null) ?? "otros";
    const tema = temas.get(clave) ?? { clave, nombre: nombreSub.get(clave) ?? "Otros productos", ficha: fichaTema.get(clave) ?? null, productos: [] };
    tema.productos.push({
      idProducto: p.id_producto as string,
      nombre: p.nombre as string,
      marca: nombreMarca.get(p.id_marca as string) ?? "",
      imagen: (p.imagen as string | null) ?? null,
      precio: (p.precio_venta as number | null) ?? null,
      ficha: fichaProducto.get(p.id_producto as string)!,
      repasado: repasados.has(p.id_producto as string),
    });
    temas.set(clave, tema);
  }
  const lista = [...temas.values()].sort((a, b) => b.productos.length - a.productos.length || a.nombre.localeCompare(b.nombre, "es"));
  for (const t of lista) t.productos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const todos = lista.flatMap((t) => t.productos);
  return {
    temas: lista,
    marcas: [...new Set(todos.map((p) => p.marca))].sort((a, b) => a.localeCompare(b, "es")),
    total: todos.length,
    repasados: todos.filter((p) => p.repasado).length,
    faltaSql: false,
  };
}

export async function marcarRepasado(idProducto: string, repasado: boolean): Promise<{ error: string | null }> {
  const sesion = await sesionQueVe();
  if (!sesion) return { error: "No tenés esta pantalla habilitada." };
  const supabase = getSupabaseServerClient();
  const { error } = repasado
    ? await supabase.from("aprender_progreso").upsert({ id_usuario: sesion.idUsuario, id_producto: idProducto, repasado_en: new Date().toISOString() })
    : await supabase.from("aprender_progreso").delete().eq("id_usuario", sesion.idUsuario).eq("id_producto", idProducto);
  return { error: error ? (faltaTabla(error.message) ? FALTA_SQL : error.message) : null };
}

export type PreguntaPrueba = {
  idProducto: string;
  producto: string;
  marca: string;
  imagen: string | null;
  pregunta: string;
  opciones: string[];
  correcta: number;
  explicacion: string;
};

/** 10 preguntas al azar de lo aprobado; primero de lo que ya repasó. */
export async function preguntasDePrueba(): Promise<PreguntaPrueba[]> {
  const datos = await obtenerAprender();
  const todas: (PreguntaPrueba & { repasado: boolean })[] = [];
  for (const t of datos.temas)
    for (const p of t.productos)
      for (const q of p.ficha.preguntas ?? [])
        todas.push({ idProducto: p.idProducto, producto: p.nombre, marca: p.marca, imagen: p.imagen, ...q, repasado: p.repasado });
  const mezclar = <T,>(a: T[]) => a.map((x) => [Math.random(), x] as const).sort((x, y) => x[0] - y[0]).map(([, x]) => x);
  const elegidas = [...mezclar(todas.filter((q) => q.repasado)), ...mezclar(todas.filter((q) => !q.repasado))].slice(0, 10);
  return mezclar(elegidas).map(({ repasado: _r, ...q }) => q);
}

export async function registrarRespuesta(idProducto: string, correcta: boolean): Promise<void> {
  const sesion = await sesionQueVe();
  if (!sesion) return;
  await getSupabaseServerClient().from("aprender_respuestas").insert({ id_usuario: sesion.idUsuario, id_producto: idProducto, correcta });
}

// ---------------- Revisión (el Dueño) ----------------

export type FichaParaRevisar = {
  idFicha: string;
  tipo: "PRODUCTO" | "TEMA";
  id: string;
  titulo: string;
  subtitulo: string;
  /** El tema al que pertenece, para agruparlas en la revisión. */
  grupo: string;
  borrador: FichaProducto | FichaTema | null;
  aprobado: boolean;
  error: string | null;
};
export type EstadoRevision = {
  hayClave: boolean;
  faltaSql: boolean;
  pendientes: FichaParaRevisar[];
  conError: FichaParaRevisar[];
  sinEscribir: { tipo: "PRODUCTO" | "TEMA"; id: string; nombre: string }[];
  aprobadas: number;
};

export async function estadoRevision(): Promise<EstadoRevision> {
  if (!(await sesionQueRevisa())) throw new Error("Solo administración revisa Aprender.");
  const supabase = getSupabaseServerClient();
  const base = { hayClave: hayClaveIA(), pendientes: [], conError: [], sinEscribir: [], aprobadas: 0 };
  const { data: fichas, error } = await supabase.from("aprender_fichas").select("id_ficha, tipo, id_producto, id_subcategoria, aprobado, borrador, error");
  if (error) {
    if (faltaTabla(error.message)) return { ...base, faltaSql: true };
    throw new Error(error.message);
  }
  const [{ data: prods }, { data: subs }, { data: marcas }] = await Promise.all([
    supabase.from("productos").select("id_producto, nombre, id_marca, id_subcategoria").eq("estado", "ACTIVO").order("nombre"),
    supabase.from("subcategorias").select("id_subcategoria, nombre"),
    supabase.from("marcas").select("id_marca, nombre"),
  ]);
  const nombreSub = new Map((subs ?? []).map((s) => [s.id_subcategoria as string, s.nombre as string]));
  const nombreMarca = new Map((marcas ?? []).map((m) => [m.id_marca as string, m.nombre as string]));
  const prodPor = new Map((prods ?? []).map((p) => [p.id_producto as string, p]));

  const armar = (f: Record<string, unknown>): FichaParaRevisar => {
    const esProducto = f.tipo === "PRODUCTO";
    const p = esProducto ? prodPor.get(f.id_producto as string) : undefined;
    return {
      idFicha: f.id_ficha as string,
      tipo: f.tipo as "PRODUCTO" | "TEMA",
      id: (esProducto ? f.id_producto : f.id_subcategoria) as string,
      titulo: esProducto ? ((p?.nombre as string) ?? "Producto") : `Tema: ${nombreSub.get(f.id_subcategoria as string) ?? "Tema"}`,
      subtitulo: esProducto ? `${nombreMarca.get(p?.id_marca as string) ?? ""} · ${nombreSub.get(p?.id_subcategoria as string) ?? "sin tema"}` : "Introducción del tema",
      grupo: (esProducto ? nombreSub.get(p?.id_subcategoria as string) : nombreSub.get(f.id_subcategoria as string)) ?? "Otros productos",
      borrador: (f.borrador as FichaProducto | FichaTema | null) ?? null,
      aprobado: Boolean(f.aprobado),
      error: (f.error as string | null) ?? null,
    };
  };
  const filas = (fichas ?? []).filter((f) => f.tipo === "TEMA" || prodPor.has(f.id_producto as string));
  const conFichaProducto = new Set(filas.filter((f) => f.tipo === "PRODUCTO" && (f.aprobado || f.borrador)).map((f) => f.id_producto as string));
  const conFichaTema = new Set(filas.filter((f) => f.tipo === "TEMA" && (f.aprobado || f.borrador)).map((f) => f.id_subcategoria as string));
  const temasUsados = [...new Set((prods ?? []).map((p) => p.id_subcategoria as string | null).filter(Boolean))] as string[];

  return {
    ...base,
    faltaSql: false,
    pendientes: filas.filter((f) => f.borrador).map(armar).sort((a, b) => (a.tipo === b.tipo ? a.titulo.localeCompare(b.titulo, "es") : a.tipo === "TEMA" ? -1 : 1)),
    conError: filas.filter((f) => f.error && !f.borrador && !f.aprobado).map(armar),
    sinEscribir: [
      ...temasUsados.filter((id) => !conFichaTema.has(id)).map((id) => ({ tipo: "TEMA" as const, id, nombre: `Tema: ${nombreSub.get(id) ?? "Tema"}` })),
      ...(prods ?? []).filter((p) => !conFichaProducto.has(p.id_producto as string)).map((p) => ({ tipo: "PRODUCTO" as const, id: p.id_producto as string, nombre: p.nombre as string })),
    ],
    aprobadas: filas.filter((f) => f.aprobado).length,
  };
}

/** Escribe una explicación con la IA (una por llamada: la pantalla va de a una y muestra el avance). */
export async function escribirExplicacion(tipo: "PRODUCTO" | "TEMA", id: string, deNuevo = false): Promise<{ error: string | null }> {
  if (!(await sesionQueRevisa())) return { error: "Solo administración revisa Aprender." };
  const supabase = getSupabaseServerClient();
  try {
    if (tipo === "PRODUCTO") await actualizarFichaProducto(supabase, id, deNuevo);
    else await actualizarFichaTema(supabase, id, deNuevo);
    revalidatePath("/aprender");
    return { error: null };
  } catch (e) {
    const m = e instanceof Error ? e.message : "No se pudo escribir.";
    return { error: faltaTabla(m) ? FALTA_SQL : m };
  }
}

/** Aprueba el borrador (con las correcciones que haya hecho el Dueño): pasa a verlo el equipo. */
export async function aprobarExplicacion(idFicha: string, contenido: FichaProducto | FichaTema): Promise<{ error: string | null }> {
  const sesion = await sesionQueRevisa();
  if (!sesion) return { error: "Solo administración revisa Aprender." };
  const { error } = await getSupabaseServerClient()
    .from("aprender_fichas")
    .update({ aprobado: contenido, borrador: null, aprobado_por: sesion.nombre, aprobado_en: new Date().toISOString(), error: null })
    .eq("id_ficha", idFicha);
  if (error) return { error: error.message };
  revalidatePath("/aprender");
  return { error: null };
}

/** Aprueba varias de una (por ejemplo todo un tema), tal como las escribió la IA. */
export async function aprobarVarias(idsFicha: string[]): Promise<{ error: string | null; aprobadas: number }> {
  const sesion = await sesionQueRevisa();
  if (!sesion) return { error: "Solo administración revisa Aprender.", aprobadas: 0 };
  const supabase = getSupabaseServerClient();
  const { data: filas, error } = await supabase.from("aprender_fichas").select("id_ficha, borrador").in("id_ficha", idsFicha).not("borrador", "is", null);
  if (error) return { error: error.message, aprobadas: 0 };
  let aprobadas = 0;
  for (const f of filas ?? []) {
    const r = await supabase
      .from("aprender_fichas")
      .update({ aprobado: f.borrador, borrador: null, aprobado_por: sesion.nombre, aprobado_en: new Date().toISOString(), error: null })
      .eq("id_ficha", f.id_ficha as string);
    if (!r.error) aprobadas++;
  }
  revalidatePath("/aprender");
  return { error: null, aprobadas };
}

export async function descartarBorrador(idFicha: string): Promise<{ error: string | null }> {
  if (!(await sesionQueRevisa())) return { error: "Solo administración revisa Aprender." };
  const { error } = await getSupabaseServerClient().from("aprender_fichas").update({ borrador: null }).eq("id_ficha", idFicha);
  return { error: error ? error.message : null };
}

/** Para el legajo: cuánto repasó y cómo le va en las preguntas. */
export async function progresoAprender(idPersona: string): Promise<{ repasados: number; total: number; preguntas: number; bien: number } | null> {
  const s = await obtenerSesionConPantallas();
  if (!s || s.rol === "marca") return null;
  const supabase = getSupabaseServerClient();
  const { data: u } = await supabase.from("usuarios").select("id_usuario").eq("id_persona", idPersona).maybeSingle();
  if (!u) return null;
  const [rep, tot, resp] = await Promise.all([
    supabase.from("aprender_progreso").select("id_producto", { count: "exact", head: true }).eq("id_usuario", u.id_usuario as string),
    supabase.from("aprender_fichas").select("id_ficha", { count: "exact", head: true }).eq("tipo", "PRODUCTO").not("aprobado", "is", null),
    supabase.from("aprender_respuestas").select("correcta").eq("id_usuario", u.id_usuario as string).limit(500),
  ]);
  if (rep.error || tot.error) return null;
  return { repasados: rep.count ?? 0, total: tot.count ?? 0, preguntas: (resp.data ?? []).length, bien: (resp.data ?? []).filter((r) => r.correcta).length };
}
