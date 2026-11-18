import type { SupabaseClient } from "@supabase/supabase-js";
import { cargarMarcasFabrica } from "@/lib/marcaFabrica";
import { cargarGondola, nombreCortoZona, type ModuloGondola } from "@/lib/gondola";
import type { FichaProducto as FichaAprender } from "@/lib/aprender";

// Aprender (Gonzalo, 2026-11-16): «Las 5 de hoy» y la evaluación de la semana.
// Las preguntas salen SOLAS de los datos reales del local, sin la IA:
//   (a) [SACADA el 18/11, ver abajo],        (b) en qué variedades viene,
//   (c) qué producto es (con la foto),       (d) las preguntas aprobadas de la ficha,
//   (e) verdadero o falso (sin TACC / sin lactosa / sin azúcar),
//   (f) en qué mueble va en la góndola.
// Solo productos activos que están en el local (con stock o puestos en la
// góndola). Cada persona tiene las suyas: el orden sale de una semilla con su
// usuario y el día, así recargar no las cambia y no se las pasan entre ellos.
//
// Regla de oro: si un dato no es seguro, esa pregunta no se hace. Una
// pregunta con la respuesta mal enseña mal.

export type TipoPregunta = "una" | "multi" | "num" | "vf" | "foto";

/** Como se guarda en aprender_rondas (con la correcta: nunca viaja al navegador antes de contestar). */
export type PreguntaRonda = {
  tipo: TipoPregunta;
  etiqueta: string;
  pregunta: string;
  opciones: string[];
  correctas: number[];
  explicacion: string;
  idProducto: string | null;
  producto: string | null;
  imagen: string | null;
  mostradaEn?: string | null;
};

// ---------------- Azar con semilla ----------------

function hash32(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function azarCon(semilla: string) {
  let a = hash32(semilla) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mezclar<T>(lista: T[], r: () => number): T[] {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------- Nombres y marcas ----------------

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const tituloPalabra = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** «PLATINUM WHEY PROTEIN 3kg» → «Platinum Whey Protein 3kg». Lo que ya viene en minúsculas queda igual. */
function lindo(s: string) {
  const letras = s.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  const mayus = letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length;
  if (letras.length === 0 || mayus / letras.length < 0.6) return s.trim();
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (/\d/.test(w) ? w.toLowerCase() : tituloPalabra(w)))
    .join(" ");
}

/** Marcas que vienen escritas en el nombre sin el « - MARCA» del final (revisadas a mano el 2026-11-16). */
const MARCAS_EN_EL_NOMBRE = ["Optimum Nutrition", "Everlast"];

function sufijoMarca(nombre: string): string | null {
  const m = nombre.match(/\s-\s([^-]{2,32})$/);
  if (!m) return null;
  const s = m[1].trim();
  return /\d/.test(s) ? null : lindo(s);
}
function sinSufijo(nombre: string) {
  return nombre.replace(/\s-\s([^-]{2,32})$/, "").trim();
}

// ---------------- El banco: lo que se carga una vez por ronda ----------------

export type ProductoBanco = {
  id: string;
  nombre: string; // lindo, sin la marca del final
  marca: string | null; // la marca real (de fábrica, del nombre o la del sistema); null si no es segura
  tema: string;
  imagen: string | null;
  variantes: string[];
  filtros: string[]; // «sin tacc», «sin lactosa», «sin azucar»
  alergenos: string;
  zona: string | null; // «Mueble 3», «Isla 1»… si está puesto en la góndola
  ficha: FichaAprender | null;
};
export type Banco = { productos: ProductoBanco[]; zonas: string[] };

const NOMBRE_SISTEMA = (n: string) => (n === "WiiGo Dietética" ? "WiiGo" : n);

export async function cargarBanco(supabase: SupabaseClient): Promise<Banco> {
  const { data: local } = await supabase.from("locales").select("id_local").eq("estado", "ACTIVO").order("nombre").limit(1).maybeSingle();
  const [prods, vars, stock, marcas, subs, filtrosG, filtrosP, fichas, fichasProd, marcasFab, gondola] = await Promise.all([
    supabase.from("productos").select("id_producto, nombre, id_marca, id_subcategoria, imagen, alergenos").eq("estado", "ACTIVO").range(0, 4999),
    supabase.from("variantes_producto").select("id_variante, id_producto, nombre").eq("estado", "ACTIVO").range(0, 9999),
    local ? supabase.from("stock").select("id_variante, cantidad").eq("id_local", local.id_local).range(0, 9999) : Promise.resolve({ data: [] as { id_variante: string; cantidad: number }[] }),
    supabase.from("marcas").select("id_marca, nombre"),
    supabase.from("subcategorias").select("id_subcategoria, nombre"),
    supabase.from("filtros_producto").select("id_filtro, nombre").eq("estado", "ACTIVO"),
    supabase.from("producto_filtros").select("id_producto, id_filtro"),
    supabase.from("aprender_fichas").select("id_producto, aprobado").eq("tipo", "PRODUCTO").not("aprobado", "is", null),
    supabase.from("ficha_producto").select("id_producto, ingredientes"),
    cargarMarcasFabrica(supabase).catch(() => new Map<string, string>()),
    local ? cargarGondola(supabase, local.id_local as string).catch(() => null) : Promise.resolve(null),
  ]);

  const nombreMarca = new Map((marcas.data ?? []).map((m) => [m.id_marca as string, NOMBRE_SISTEMA(m.nombre as string)]));
  const nombreSub = new Map((subs.data ?? []).map((s) => [s.id_subcategoria as string, (s.nombre as string).trim()]));
  const nombreFiltro = new Map((filtrosG.data ?? []).map((f) => [f.id_filtro as string, plano(f.nombre as string)]));
  const filtrosDe = new Map<string, string[]>();
  for (const r of filtrosP.data ?? []) {
    const n = nombreFiltro.get(r.id_filtro as string);
    if (n) filtrosDe.set(r.id_producto as string, [...(filtrosDe.get(r.id_producto as string) ?? []), n]);
  }
  const fichaDe = new Map((fichas.data ?? []).map((f) => [f.id_producto as string, f.aprobado as FichaAprender]));
  const ingredientesDe = new Map((fichasProd.data ?? []).map((f) => [f.id_producto as string, ((f.ingredientes as string | null) ?? "").toString()]));

  const varDe = new Map<string, { id: string; nombre: string }[]>();
  for (const v of vars.data ?? []) varDe.set(v.id_producto as string, [...(varDe.get(v.id_producto as string) ?? []), { id: v.id_variante as string, nombre: (v.nombre as string).trim() }]);
  const stockVar = new Map<string, number>();
  for (const s of stock.data ?? []) stockVar.set(s.id_variante as string, (stockVar.get(s.id_variante as string) ?? 0) + Math.max(0, Number(s.cantidad) || 0));

  // Dónde está puesto cada producto (solo lo que está de verdad en la góndola).
  const zonaDe = new Map<string, string>();
  const zonas = new Set<string>();
  for (const m of (gondola ?? []) as ModuloGondola[]) {
    const nombre = nombreCortoZona(gondola as ModuloGondola[], m);
    for (const l of m.lugares) {
      if (!l.puesto) continue;
      zonas.add(nombre);
      if (!zonaDe.has(l.idProducto)) zonaDe.set(l.idProducto, nombre);
    }
  }

  // Marcas que revenden de varias marcas (Animalfit): la marca real va en el nombre.
  const todos = prods.data ?? [];
  const porMarca = new Map<string, { total: number; conSufijo: number }>();
  for (const p of todos) {
    const c = porMarca.get(p.id_marca as string) ?? { total: 0, conSufijo: 0 };
    c.total++;
    if (sufijoMarca(p.nombre as string)) c.conSufijo++;
    porMarca.set(p.id_marca as string, c);
  }
  const conocidas = new Set<string>(MARCAS_EN_EL_NOMBRE);
  for (const p of todos) {
    const s = sufijoMarca(p.nombre as string);
    if (s) conocidas.add(s);
  }

  const productos: ProductoBanco[] = [];
  for (const p of todos) {
    const id = p.id_producto as string;
    const variantes = varDe.get(id) ?? [];
    const enStock = variantes.reduce((a, v) => a + (stockVar.get(v.id) ?? 0), 0) > 0;
    if (!enStock && !zonaDe.has(id)) continue; // no está en el local
    const nombreCrudo = p.nombre as string;
    const c = porMarca.get(p.id_marca as string);
    const revende = Boolean(c && c.conSufijo / c.total >= 0.5);
    let marca: string | null = marcasFab.get(id) ?? sufijoMarca(nombreCrudo);
    if (!marca && revende) marca = [...conocidas].find((k) => plano(nombreCrudo).includes(plano(k))) ?? null;
    if (!marca && !revende) marca = nombreMarca.get(p.id_marca as string) ?? null;
    productos.push({
      id,
      nombre: lindo(sinSufijo(nombreCrudo)),
      marca,
      tema: nombreSub.get(p.id_subcategoria as string) ?? "",
      imagen: (p.imagen as string | null) || null,
      variantes: variantes.map((v) => v.nombre).filter((n) => n && n !== "Único"),
      filtros: filtrosDe.get(id) ?? [],
      alergenos: plano(`${(p.alergenos as string | null) ?? ""} ${ingredientesDe.get(id) ?? ""}`),
      zona: zonaDe.get(id) ?? null,
      ficha: fichaDe.get(id) ?? null,
    });
  }
  return { productos, zonas: [...zonas] };
}

// ---------------- Los 6 tipos ----------------

const conMarcaTexto = (p: ProductoBanco) => (p.marca && !plano(p.nombre).includes(plano(p.marca)) ? `${p.nombre} de ${p.marca}` : p.nombre);
const unirY = (l: string[]) => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} y ${l[l.length - 1]}`);
const NO_SON_SABORES = /\b(\d+\s*(ml|g|gr|kg|lb|lbs|cc|un|u)\b|talle|gris|negro|blanco|azul|rojo|verde|rosa|color)\b/i;

// (a) «¿Cuántas marcas de {tema} tenemos?» se SACÓ el 18/11: Gonzalo vio que
// daba mal en el local. El «tema» es la subcategoría, y las subcategorías son de
// cada marca: las barritas de WiiGo (Muecas, Entre Nuts, Vancouver) están en
// «Barritas» y las de Animalfit (Gentech, Crudda, Ena) en «Barras proteicas»,
// así que «marcas de barritas» decía 3 cuando en el local hay más. Además deja
// afuera lo que está sin stock. No hay forma segura de saberlo: regla de oro.

/** (b) ¿En qué variedades viene X? Las suyas, más otras del mismo tema que no tiene. */
function variedades(b: Banco, r: () => number): PreguntaRonda[] {
  const out: PreguntaRonda[] = [];
  for (const p of b.productos) {
    const suyas = [...new Set(p.variantes)];
    if (suyas.length < 2 || suyas.length > 4 || suyas.some((v) => NO_SON_SABORES.test(v))) continue;
    const planas = suyas.map(plano);
    // Sin distractores que se confundan con una correcta («Limón» al lado de «Limón (Citrus Slush)»).
    const parecida = (v: string) => planas.some((c) => c.includes(plano(v)) || plano(v).includes(c));
    const otras = [...new Set(b.productos.filter((x) => x.tema === p.tema && x.id !== p.id).flatMap((x) => x.variantes))].filter(
      (v) => !parecida(v) && !NO_SON_SABORES.test(v) && v !== "Único"
    );
    const distractores = mezclar(otras, r).slice(0, Math.max(1, 5 - suyas.length));
    if (distractores.length === 0) continue;
    const opciones = mezclar([...suyas, ...distractores], r);
    out.push({
      tipo: "multi",
      etiqueta: "Elegí todas las que van",
      pregunta: `¿En qué sabores o variedades viene ${conMarcaTexto(p)}?`,
      opciones,
      correctas: opciones.map((o, i) => (suyas.includes(o) ? i : -1)).filter((i) => i >= 0),
      explicacion: `Viene en ${unirY(suyas.map((s) => s.toLowerCase()))}.`,
      idProducto: p.id,
      producto: p.nombre,
      imagen: null,
    });
  }
  return out;
}

/** (c) ¿Qué producto es este? Con la foto y tres del mismo tema. */
function queProducto(b: Banco, r: () => number): PreguntaRonda[] {
  const out: PreguntaRonda[] = [];
  for (const p of b.productos) {
    if (!p.imagen) continue;
    const otros = [...new Map(b.productos.filter((x) => x.tema === p.tema && x.id !== p.id && plano(x.nombre) !== plano(p.nombre)).map((x) => [plano(conMarcaTexto(x)), x])).values()];
    if (otros.length < 3) continue;
    const opciones = mezclar([p, ...mezclar(otros, r).slice(0, 3)], r).map(conMarcaTexto);
    out.push({
      tipo: "foto",
      etiqueta: "¿Qué producto es?",
      pregunta: "Un cliente te muestra esta foto. ¿Qué es?",
      opciones,
      correctas: [opciones.indexOf(conMarcaTexto(p))],
      explicacion: `Es ${conMarcaTexto(p)}.`,
      idProducto: p.id,
      producto: p.nombre,
      imagen: p.imagen,
    });
  }
  return out;
}

/** (d) Las preguntas que Gonzalo ya aprobó en la ficha de cada producto. */
function deLaFicha(b: Banco, r: () => number): PreguntaRonda[] {
  const out: PreguntaRonda[] = [];
  for (const p of b.productos) {
    for (const q of p.ficha?.preguntas ?? []) {
      if (!q.pregunta || (q.opciones ?? []).length < 2 || q.opciones[q.correcta] == null) continue;
      const orden = mezclar(q.opciones.map((_, i) => i), r);
      out.push({
        tipo: "una",
        etiqueta: "Elegí una",
        pregunta: q.pregunta,
        opciones: orden.map((i) => q.opciones[i]),
        correctas: [orden.indexOf(q.correcta)],
        explicacion: q.explicacion || "",
        idProducto: p.id,
        producto: conMarcaTexto(p),
        imagen: null,
      });
    }
  }
  return out;
}

/** (e) Verdadero o falso. Verdadero solo con el sello cargado; falso solo si los alérgenos lo contradicen. */
function verdaderoFalso(b: Banco): PreguntaRonda[] {
  const out: PreguntaRonda[] = [];
  const vf = (p: ProductoBanco, afirmacion: string, verdad: boolean, explicacion: string): PreguntaRonda => ({
    tipo: "vf",
    etiqueta: "¿Verdadero o falso?",
    pregunta: afirmacion,
    opciones: ["Verdadero", "Falso"],
    correctas: [verdad ? 0 : 1],
    explicacion,
    idProducto: p.id,
    producto: p.nombre,
    imagen: null,
  });
  for (const p of b.productos) {
    const n = conMarcaTexto(p);
    const sinTacc = p.filtros.includes("sin tacc");
    const sinLactosa = p.filtros.includes("sin lactosa");
    const sinAzucar = p.filtros.includes("sin azucar");
    const a = p.alergenos;
    if (sinTacc) out.push(vf(p, `${n} es apto para celíacos (sin TACC).`, true, "Verdadero: tiene el sello sin TACC."));
    else if (/\b(gluten|trigo|cebada|centeno)\b/.test(a) && !/(sin|libre de|no contiene) gluten|sin tacc/.test(a))
      out.push(vf(p, `${n} es apto para celíacos (sin TACC).`, false, "Falso: tiene gluten (trigo, cebada o centeno). No se lo ofrezcas a un celíaco."));
    if (sinLactosa) out.push(vf(p, `${n} es sin lactosa.`, true, "Verdadero: está marcado sin lactosa. Sirve para quien le cae mal la leche."));
    else if (/\b(leche|lacteo|lacteos|lactosa)\b/.test(a) && !/(sin|libre de|no contiene) lactosa|deslactosad/.test(a))
      out.push(vf(p, `${n} es sin lactosa.`, false, "Falso: tiene leche o derivados."));
    if (sinAzucar) out.push(vf(p, `${n} es sin azúcar agregada.`, true, "Verdadero: tiene el sello sin azúcar."));
  }
  return out;
}

/** (f) ¿En qué mueble va X? Con lo que está puesto en la góndola. */
function dondeVa(b: Banco, r: () => number): PreguntaRonda[] {
  if (b.zonas.length < 4) return [];
  const out: PreguntaRonda[] = [];
  for (const p of b.productos) {
    if (!p.zona) continue;
    const opciones = mezclar([p.zona, ...mezclar(b.zonas.filter((z) => z !== p.zona), r).slice(0, 3)], r);
    out.push({
      tipo: "una",
      etiqueta: "Góndola",
      pregunta: `¿Dónde va ${conMarcaTexto(p)}?`,
      opciones,
      correctas: [opciones.indexOf(p.zona)],
      explicacion: `Va en ${p.zona}. Si un cliente lo busca, lo llevás directo.`,
      idProducto: p.id,
      producto: p.nombre,
      imagen: null,
    });
  }
  return out;
}

/**
 * Arma `cuantas` preguntas mezclando los tipos (uno de cada uno, en vueltas)
 * y sin repetir producto. Devuelve menos si no alcanzan los datos.
 */
export function armarPreguntas(b: Banco, semilla: string, cuantas: number): PreguntaRonda[] {
  const r = azarCon(semilla);
  const pozos = mezclar(
    [variedades(b, r), queProducto(b, r), deLaFicha(b, r), verdaderoFalso(b), dondeVa(b, r)].map((l) => mezclar(l, r)).filter((l) => l.length > 0),
    r
  );
  const elegidas: PreguntaRonda[] = [];
  const usados = new Set<string>();
  const textos = new Set<string>();
  let vuelta = true;
  while (elegidas.length < cuantas && vuelta) {
    vuelta = false;
    for (const pozo of pozos) {
      if (elegidas.length >= cuantas) break;
      const i = pozo.findIndex((q) => !textos.has(q.pregunta) && (!q.idProducto || !usados.has(q.idProducto)));
      if (i < 0) continue;
      const [q] = pozo.splice(i, 1);
      elegidas.push(q);
      textos.add(q.pregunta);
      if (q.idProducto) usados.add(q.idProducto);
      vuelta = true;
    }
  }
  return elegidas;
}
