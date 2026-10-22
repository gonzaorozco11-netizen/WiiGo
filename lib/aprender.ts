import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pedirJson } from "@/lib/ia";

// Aprender: las explicaciones de cada producto y de cada tema (subcategoría)
// para que el equipo sepa asesorar. Las escribe la IA a partir de lo cargado
// del producto (nombre, marca, tema, descripción, objetivos, variantes) y
// quedan como BORRADOR hasta que Gonzalo las aprueba.
//
// Cuando un producto cambia (otro nombre, otra descripción...), cambia su
// "huella" y se escribe un borrador nuevo; lo aprobado sigue visible hasta
// que se apruebe el nuevo.

export type FichaProducto = {
  paraQueSirve: string;
  paraQuien: string;
  comoSeUsa: string;
  loDistinto: string;
  consejo: string;
  preguntas: { pregunta: string; opciones: string[]; correcta: number; explicacion: string }[];
};

export type FichaTema = {
  icono: string;
  queEs: string;
  paraQuien: string;
  comoSeUsa: string;
  consejo: string;
};

const SISTEMA = `Sos quien capacita al equipo de WiiGo, un local de Mendoza (Argentina) que vende productos de dietética y suplementos deportivos de varias marcas.
Escribís para vendedoras y vendedores de mostrador: español rioplatense (vos), frases cortas y simples, sin tecnicismos.
Reglas:
- Nada de promesas de salud ni de efectos médicos ("cura", "previene", "adelgaza"). Hablá de usos habituales y de para qué lo elige la gente.
- Si no sabés algo con certeza del producto puntual, explicá lo general del tipo de producto, sin inventar datos (dosis exactas, ingredientes, certificaciones).
- Para dosis, decí lo habitual y agregá "según indica el envase".
- Respondé SOLO con el JSON pedido, sin texto antes ni después.`;

export type DatosProducto = {
  nombre: string;
  marca: string;
  tema: string | null;
  descripcion: string | null;
  objetivos: string[];
  variantes: string[];
};

export async function datosDeProducto(supabase: SupabaseClient, idProducto: string): Promise<DatosProducto | null> {
  const { data: p } = await supabase.from("productos").select("nombre, descripcion, id_marca, id_subcategoria").eq("id_producto", idProducto).maybeSingle();
  if (!p) return null;
  const [{ data: marca }, { data: sub }, { data: rel }, { data: vars }] = await Promise.all([
    supabase.from("marcas").select("nombre").eq("id_marca", p.id_marca as string).maybeSingle(),
    p.id_subcategoria ? supabase.from("subcategorias").select("nombre").eq("id_subcategoria", p.id_subcategoria as string).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("producto_objetivos").select("id_objetivo").eq("id_producto", idProducto),
    supabase.from("variantes_producto").select("nombre").eq("id_producto", idProducto).eq("estado", "ACTIVO"),
  ]);
  const ids = (rel ?? []).map((r) => r.id_objetivo as string);
  const { data: objs } = ids.length ? await supabase.from("objetivos").select("nombre").in("id_objetivo", ids) : { data: [] as { nombre: string }[] };
  return {
    nombre: p.nombre as string,
    marca: (marca?.nombre as string) ?? "",
    tema: (sub?.nombre as string | undefined) ?? null,
    descripcion: (p.descripcion as string | null) ?? null,
    objetivos: (objs ?? []).map((o) => o.nombre as string),
    variantes: (vars ?? []).map((v) => v.nombre as string).filter((n) => n && n !== "Único"),
  };
}

/** Una huella de los datos: si cambia, la explicación quedó vieja. */
export function huellaDe(d: DatosProducto) {
  return createHash("sha1").update(JSON.stringify(d)).digest("hex").slice(0, 16);
}

function texto(v: unknown, max = 400) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function validarProducto(x: unknown): FichaProducto {
  const o = (x ?? {}) as Record<string, unknown>;
  const preguntas = Array.isArray(o.preguntas) ? o.preguntas : [];
  const ficha: FichaProducto = {
    paraQueSirve: texto(o.paraQueSirve),
    paraQuien: texto(o.paraQuien),
    comoSeUsa: texto(o.comoSeUsa),
    loDistinto: texto(o.loDistinto),
    consejo: texto(o.consejo),
    preguntas: preguntas
      .map((p) => {
        const q = (p ?? {}) as Record<string, unknown>;
        const opciones = Array.isArray(q.opciones) ? q.opciones.map((op) => texto(op, 160)).filter(Boolean).slice(0, 3) : [];
        const correcta = Number(q.correcta);
        return { pregunta: texto(q.pregunta, 200), opciones, correcta, explicacion: texto(q.explicacion, 300) };
      })
      .filter((q) => q.pregunta && q.opciones.length === 3 && Number.isInteger(q.correcta) && q.correcta >= 0 && q.correcta <= 2)
      .slice(0, 3),
  };
  if (!ficha.paraQueSirve || !ficha.paraQuien) throw new Error("La explicación vino incompleta.");
  return ficha;
}

export async function escribirFichaProducto(d: DatosProducto): Promise<FichaProducto> {
  const pedido = `Producto:
- Nombre: ${d.nombre}
- Marca: ${d.marca}
- Tema: ${d.tema ?? "sin tema"}
- Variantes: ${d.variantes.join(", ") || "una sola"}
- Objetivos que le asignamos: ${d.objetivos.join(", ") || "ninguno"}
- Descripción cargada: ${d.descripcion ?? "ninguna"}

Escribí la ficha de estudio de este producto como este JSON:
{
  "paraQueSirve": "1 o 2 oraciones: qué es y para qué lo usa la gente",
  "paraQuien": "1 oración: a qué cliente recomendárselo",
  "comoSeUsa": "1 oración: uso habitual, según indica el envase",
  "loDistinto": "1 oración: qué lo diferencia de productos parecidos del mismo tipo",
  "consejo": "1 oración: un consejo práctico para asesorar en el mostrador",
  "preguntas": [
    { "pregunta": "pregunta corta de repaso", "opciones": ["opción", "opción", "opción"], "correcta": 0, "explicacion": "1 oración que explica la respuesta" },
    { "pregunta": "...", "opciones": ["...", "...", "..."], "correcta": 2, "explicacion": "..." }
  ]
}
Hacé 2 preguntas. Variá la posición de la respuesta correcta.`;
  return validarProducto(await pedirJson(SISTEMA, pedido, 1500));
}

export async function escribirFichaTema(tema: string, productos: { nombre: string; marca: string }[]): Promise<FichaTema> {
  const pedido = `Tema: ${tema}
Productos de este tema que vendemos: ${productos.map((p) => `${p.nombre} (${p.marca})`).join("; ") || "todavía ninguno"}

Escribí la introducción al tema como este JSON:
{
  "icono": "un solo emoji que represente el tema",
  "queEs": "1 o 2 oraciones: qué es este tipo de producto",
  "paraQuien": "1 oración: qué clientes lo buscan",
  "comoSeUsa": "1 oración: uso habitual",
  "consejo": "1 oración: qué preguntarle al cliente para recomendarle bien"
}`;
  const o = ((await pedirJson(SISTEMA, pedido, 800)) ?? {}) as Record<string, unknown>;
  const ficha: FichaTema = {
    icono: texto(o.icono, 8) || "📦",
    queEs: texto(o.queEs),
    paraQuien: texto(o.paraQuien),
    comoSeUsa: texto(o.comoSeUsa),
    consejo: texto(o.consejo),
  };
  if (!ficha.queEs) throw new Error("La explicación del tema vino incompleta.");
  return ficha;
}

/**
 * Escribe (o reescribe) el borrador de un producto si hace falta: no tiene
 * ficha, o sus datos cambiaron desde la última. Devuelve qué pasó.
 */
export async function actualizarFichaProducto(
  supabase: SupabaseClient,
  idProducto: string,
  forzar = false
): Promise<"escrita" | "al-dia" | "sin-producto"> {
  const d = await datosDeProducto(supabase, idProducto);
  if (!d) return "sin-producto";
  const huella = huellaDe(d);
  const { data: actual } = await supabase.from("aprender_fichas").select("id_ficha, huella, borrador").eq("tipo", "PRODUCTO").eq("id_producto", idProducto).maybeSingle();
  if (!forzar && actual?.huella === huella) return "al-dia";

  try {
    const ficha = await escribirFichaProducto(d);
    const fila = { borrador: ficha, huella, generado_en: new Date().toISOString(), error: null };
    if (actual) await supabase.from("aprender_fichas").update(fila).eq("id_ficha", actual.id_ficha as string);
    else await supabase.from("aprender_fichas").insert({ tipo: "PRODUCTO", id_producto: idProducto, ...fila });
    return "escrita";
  } catch (e) {
    const error = e instanceof Error ? e.message : "No se pudo escribir la explicación.";
    if (actual) await supabase.from("aprender_fichas").update({ error }).eq("id_ficha", actual.id_ficha as string);
    else await supabase.from("aprender_fichas").insert({ tipo: "PRODUCTO", id_producto: idProducto, error });
    throw e;
  }
}

/** Escribe el borrador de un tema (subcategoría) si todavía no tiene. */
export async function actualizarFichaTema(supabase: SupabaseClient, idSubcategoria: string, forzar = false): Promise<"escrita" | "al-dia"> {
  const { data: actual } = await supabase.from("aprender_fichas").select("id_ficha, aprobado, borrador").eq("tipo", "TEMA").eq("id_subcategoria", idSubcategoria).maybeSingle();
  if (!forzar && (actual?.aprobado || actual?.borrador)) return "al-dia";
  const [{ data: sub }, { data: prods }] = await Promise.all([
    supabase.from("subcategorias").select("nombre").eq("id_subcategoria", idSubcategoria).maybeSingle(),
    supabase.from("productos").select("nombre, id_marca").eq("id_subcategoria", idSubcategoria).eq("estado", "ACTIVO").limit(20),
  ]);
  const idsMarca = [...new Set((prods ?? []).map((p) => p.id_marca as string))];
  const { data: marcas } = idsMarca.length ? await supabase.from("marcas").select("id_marca, nombre").in("id_marca", idsMarca) : { data: [] };
  const nombreMarca = new Map((marcas ?? []).map((m) => [m.id_marca as string, m.nombre as string]));
  const ficha = await escribirFichaTema(
    (sub?.nombre as string) ?? "Tema",
    (prods ?? []).map((p) => ({ nombre: p.nombre as string, marca: nombreMarca.get(p.id_marca as string) ?? "" }))
  );
  const fila = { borrador: ficha, generado_en: new Date().toISOString(), error: null };
  if (actual) await supabase.from("aprender_fichas").update(fila).eq("id_ficha", actual.id_ficha as string);
  else await supabase.from("aprender_fichas").insert({ tipo: "TEMA", id_subcategoria: idSubcategoria, ...fila });
  return "escrita";
}
