import type { SupabaseClient } from "@supabase/supabase-js";
import { COMERCIOS, gramosDelNombre, mejorCandidato, type Comercio, type ItemCompetencia } from "@/lib/competencia";
import { nombreBase } from "@/lib/nombreProducto";

// Lee los precios de la competencia de Mendoza de sus páginas públicas y
// propone el equivalente de cada producto de WiiGo Dietética. Lo corre el cron
// de cada lunes y el botón "Actualizar ahora" de Precios. Nada se carga a mano.
//
// De dónde sale cada uno (relevado el 2026-10-29):
// - Bela Vita: /api/catalogo, el catálogo entero en JSON.
// - Regio Mendoza: la API pública de WooCommerce. El precio es el de 1 kg.
// - Mardegan: Tiendanube; los productos vienen en el ld+json de cada página.
// - Jumbo: su buscador y la "simulación" del carrito con la sucursal de
//   Mendoza (jumboargentinaj5222mendoza). Vea no vende online en Mendoza.

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "application/json, text/html;q=0.9" };
const SUCURSAL_JUMBO = "jumboargentinaj5222mendoza";

type Leido = { clave: string; nombre: string; gramos: number | null; por_kilo: boolean; precio: number; precio_antes: number | null; nota?: string | null; url?: string | null; disponible: boolean };

/** El link a la página del producto, para que Gonzalo verifique que sea el mismo. Solo https: viene de páginas ajenas. */
function link(u: unknown): string | null {
  return typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { ...UA, ...(init?.headers ?? {}) }, cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

async function leerBelaVita(): Promise<Leido[]> {
  type P = { id: number; nombre: string; precio: number; precio_antes: number | null; stock: number | null; etiqueta_vencimiento?: string | null; oferta_hasta?: string | null };
  const j = await json<{ productos: P[] }>("https://dieteticaonlinebelavita.com.ar/api/catalogo");
  return j.productos
    .map((p) => {
      const antes = p.precio_antes && Number(p.precio_antes) > Number(p.precio) ? Number(p.precio_antes) : null;
      // El motivo de la oferta: "VENCE 4 NOV" (mercadería por vencer) o hasta cuándo dura.
      const nota = antes ? p.etiqueta_vencimiento || (p.oferta_hasta ? `oferta hasta ${new Date(p.oferta_hasta).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}` : null) : null;
      // El botón "compartir" de su tienda arma este mismo link.
      const url = `https://dieteticaonlinebelavita.com.ar/?producto=${encodeURIComponent(String(p.id))}`;
      return { clave: String(p.id), nombre: p.nombre, gramos: gramosDelNombre(p.nombre), por_kilo: false, precio: Number(p.precio), precio_antes: antes, nota, url, disponible: (p.stock ?? 1) > 0 };
    })
    .filter((p) => p.gramos && p.precio > 0);
}

/** Mega Nuts (WooCommerce): cada tamaño (500 g, 1 kg…) es una "variación" con su precio. */
async function leerMegaNuts(): Promise<Leido[]> {
  type P = { id: number; name: string; type?: string; variation?: string; permalink?: string; is_in_stock?: boolean; prices: { price: string; regular_price: string; sale_price?: string; currency_minor_unit: number } };
  const salida: Leido[] = [];
  const pasar = (p: P, gramos: number | null, nombre: string) => {
    const div = 10 ** (p.prices.currency_minor_unit ?? 2);
    const precio = Number(p.prices.price) / div;
    const lista = Number(p.prices.regular_price) / div;
    // El link de una variación ya abre el producto con ese tamaño elegido.
    if (gramos && precio > 0) salida.push({ clave: String(p.id), nombre, gramos, por_kilo: false, precio, precio_antes: lista > precio ? lista : null, nota: null, url: link(p.permalink), disponible: p.is_in_stock !== false });
  };
  for (const tipo of ["variation", "simple"]) {
    for (let page = 1; page <= 20; page++) {
      const lote = await json<P[]>(`https://meganuts.com.ar/wp-json/wc/store/v1/products?type=${tipo}&per_page=100&page=${page}`);
      for (const p of lote) {
        // La variación dice "Gramos: 500gr"; el producto simple lo trae en el nombre.
        const gramos = tipo === "variation" ? gramosDelNombre(` ${p.variation ?? ""}`) : gramosDelNombre(p.name);
        pasar(p, gramos, tipo === "variation" && gramos ? `${p.name} x ${gramos >= 1000 ? `${gramos / 1000} kg` : `${gramos} g`}` : p.name);
      }
      if (lote.length < 100) break;
    }
  }
  return salida;
}

async function leerRegio(): Promise<Leido[]> {
  type P = { id: number; name: string; permalink?: string; is_in_stock?: boolean; prices: { price: string; regular_price: string; currency_minor_unit: number } };
  const todos: P[] = [];
  for (let page = 1; page <= 10; page++) {
    const lote = await json<P[]>(`https://regiomendoza.com/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    todos.push(...lote);
    if (lote.length < 100) break;
  }
  return todos
    .map((p) => {
      const div = 10 ** (p.prices.currency_minor_unit ?? 2);
      const precio = Number(p.prices.price) / div;
      const lista = Number(p.prices.regular_price) / div;
      // Venden por kilo: el precio publicado es el de 1 kg.
      return { clave: String(p.id), nombre: p.name, gramos: 1000, por_kilo: true, precio, precio_antes: lista > precio ? lista : null, url: link(p.permalink), disponible: p.is_in_stock !== false };
    })
    .filter((p) => p.precio > 0);
}

async function leerMardegan(): Promise<Leido[]> {
  const vistos = new Map<string, Leido>();
  for (let page = 1; page <= 30; page++) {
    const r = await fetch(`https://www.productosmardegan.com/productos/?page=${page}`, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!r.ok) break;
    const html = await r.text();
    const antes = vistos.size;
    for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      try {
        const d = JSON.parse(m[1]) as { "@type"?: string; name?: string; sku?: string; mainEntityOfPage?: { "@id"?: string }; offers?: { price?: string | number; availability?: string; url?: string } };
        if (d["@type"] !== "Product" || !d.name || !d.offers?.price) continue;
        const clave = String(d.sku ?? d.name);
        const url = link(d.mainEntityOfPage?.["@id"]) ?? link(d.offers.url);
        vistos.set(clave, { clave, nombre: d.name, gramos: gramosDelNombre(d.name), por_kilo: false, precio: Number(d.offers.price), precio_antes: null, url, disponible: !/OutOfStock/i.test(d.offers.availability ?? "") });
      } catch {
        // Un bloque roto no frena el resto.
      }
    }
    if (vistos.size === antes) break;
  }
  return [...vistos.values()].filter((p) => p.gramos && p.precio > 0);
}

/** Jumbo tiene miles de productos: se busca solo lo parecido a cada producto de WiiGo. */
async function leerJumbo(busquedas: string[]): Promise<Leido[]> {
  type P = { productName: string; link?: string; items: { itemId: string; unitMultiplier: number; measurementUnit: string }[] };
  const salida = new Map<string, Leido>();
  for (const q of busquedas) {
    const lista = await json<P[]>(`https://www.jumbo.com.ar/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}&_from=0&_to=7&sc=32`).catch(() => [] as P[]);
    const items = lista.map((p) => ({ p, it: p.items[0] })).filter((x) => x.it && !salida.has(x.it.itemId));
    if (!items.length) continue;
    const sim = await json<{ items?: { id: string; sellingPrice?: number; price?: number; listPrice?: number; availability?: string }[] }>(
      "https://www.jumbo.com.ar/api/checkout/pub/orderForms/simulation?sc=32",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: items.map((x) => ({ id: x.it.itemId, quantity: 1, seller: SUCURSAL_JUMBO })), country: "ARG", postalCode: "5500" }) }
    ).catch(() => ({ items: [] }));
    const porId = new Map((sim.items ?? []).map((i) => [i.id, i]));
    for (const { p, it } of items) {
      const s = porId.get(it.itemId);
      const precio = (s?.sellingPrice || s?.price || 0) / 100;
      if (!s || precio <= 0) continue;
      // Lo que se vende por peso viene de a 100 g (unitMultiplier 0.1 kg).
      const porPeso = it.measurementUnit === "kg" && it.unitMultiplier < 1;
      // Su "listPrice" viene roto (es el precio sin IVA × 100: $152.893 por
      // una avena de $1.850). El precio normal de la sucursal es "price"; si
      // está en oferta, "sellingPrice" es más bajo.
      const lista = (s.price ?? 0) / 100;
      salida.set(it.itemId, {
        clave: it.itemId,
        nombre: p.productName,
        gramos: porPeso ? Math.round(it.unitMultiplier * 1000) : gramosDelNombre(p.productName),
        por_kilo: porPeso,
        precio,
        precio_antes: lista > precio ? lista : null,
        url: link(p.link),
        disponible: s.availability === "available",
      });
    }
  }
  return [...salida.values()].filter((p) => p.gramos);
}

export type ResultadoLectura = { comercios: Record<Comercio, { leidos: number; error: string | null }>; propuestos: number };

export async function actualizarCompetencia(supabase: SupabaseClient): Promise<ResultadoLectura> {
  const ahora = new Date().toISOString();
  const { data: marcas } = await supabase.from("marcas").select("id_marca").eq("tipo_comercializacion", "PROPIA");
  const { data: prods } = await supabase
    .from("productos")
    .select("id_producto, nombre, peso_neto_g")
    .in("id_marca", (marcas ?? []).map((m) => m.id_marca))
    .eq("estado", "ACTIVO");
  const productos = (prods ?? []).map((p) => ({ id: p.id_producto as string, nombre: p.nombre as string, gramos: Number(p.peso_neto_g) || null }));
  const busquedas = [...new Set(productos.map((p) => nombreBase(p.nombre).toLowerCase()))];

  const lectores: Record<Comercio, () => Promise<Leido[]>> = {
    BELAVITA: leerBelaVita,
    MEGANUTS: leerMegaNuts,
    REGIO: leerRegio,
    MARDEGAN: leerMardegan,
    JUMBO: () => leerJumbo(busquedas),
  };
  const comercios = {} as ResultadoLectura["comercios"];
  await Promise.all(
    COMERCIOS.map(async ({ clave }) => {
      try {
        const leidos = await lectores[clave]();
        for (let i = 0; i < leidos.length; i += 300) {
          const lote = leidos.slice(i, i + 300).map((l) => ({ ...l, nota: l.nota ?? null, url: l.url ?? null, comercio: clave, visto_el: ahora }));
          let { error } = await supabase.from("competencia_items").upsert(lote, { onConflict: "comercio,clave" });
          // Sin las columnas "nota" y "url" (falta correr el SQL nuevo) se guarda igual, sin el motivo de la oferta ni el link.
          if (error && /nota|url/.test(error.message)) {
            const sinNota = lote.map((f) => {
              const c: Partial<typeof f> = { ...f };
              delete c.nota;
              delete c.url;
              return c;
            });
            ({ error } = await supabase.from("competencia_items").upsert(sinNota, { onConflict: "comercio,clave" }));
          }
          if (error) throw new Error(/check constraint/.test(error.message) ? "falta correr el SQL de Mega Nuts" : error.message);
        }
        // Lo que ya no está en su página queda como no disponible.
        if (clave !== "JUMBO") await supabase.from("competencia_items").update({ disponible: false }).eq("comercio", clave).lt("visto_el", ahora);
        comercios[clave] = { leidos: leidos.length, error: null };
      } catch (e) {
        comercios[clave] = { leidos: 0, error: e instanceof Error ? e.message : "No se pudo leer" };
      }
    })
  );

  // Propuestas para lo que todavía no tiene equivalente confirmado.
  const { data: itemsRaw } = await supabase.from("competencia_items").select("*").eq("disponible", true);
  const items = (itemsRaw ?? []).map(filaAItem);
  const { data: vinc } = await supabase.from("competencia_vinculos").select("id_producto, comercio, estado, rechazados, id_item");
  const vincPor = new Map((vinc ?? []).map((v) => [`${v.id_producto}:${v.comercio}`, v]));
  const filas: Record<string, unknown>[] = [];
  for (const p of productos) {
    for (const { clave } of COMERCIOS) {
      const v = vincPor.get(`${p.id}:${clave}`);
      if (v?.estado === "CONFIRMADO" && v.id_item) continue;
      const rechazados = (v?.rechazados as string[] | null) ?? [];
      const cand = mejorCandidato({ nombre: nombreBase(p.nombre), gramos: p.gramos }, items.filter((i) => i.comercio === clave), rechazados);
      if ((cand?.id ?? null) === (v?.id_item ?? null) && v) continue;
      filas.push({ id_producto: p.id, comercio: clave, id_item: cand?.id ?? null, estado: "PROPUESTO", rechazados, actualizado_el: ahora });
    }
  }
  if (filas.length) await supabase.from("competencia_vinculos").upsert(filas, { onConflict: "id_producto,comercio" });
  await supabase.from("configuracion").upsert([{ parametro: "COMPETENCIA_LEIDA_EL", valor: ahora, fecha_actualizacion: ahora }], { onConflict: "parametro" });
  return { comercios, propuestos: filas.filter((f) => f.id_item).length };
}

export type VinculoCompetencia = { comercio: Comercio; estado: "PROPUESTO" | "CONFIRMADO"; item: ItemCompetencia | null };
export type DatosCompetencia = { leidaEl: string | null; vinculos: Record<string, VinculoCompetencia[]> };

/** Para la pantalla: el equivalente de cada comercio para cada producto. null si falta el SQL. */
export async function cargarCompetencia(supabase: SupabaseClient): Promise<DatosCompetencia | null> {
  const { data: vinc, error } = await supabase.from("competencia_vinculos").select("id_producto, comercio, estado, competencia_items(*)");
  if (error) return null;
  const { data: cfg } = await supabase.from("configuracion").select("valor").eq("parametro", "COMPETENCIA_LEIDA_EL").maybeSingle();
  const vinculos: Record<string, VinculoCompetencia[]> = {};
  for (const v of vinc ?? []) {
    const fila = v.competencia_items as unknown as Record<string, unknown> | null;
    (vinculos[v.id_producto as string] ??= []).push({ comercio: v.comercio as Comercio, estado: v.estado as VinculoCompetencia["estado"], item: fila ? filaAItem(fila) : null });
  }
  return { leidaEl: (cfg?.valor as string | null) ?? null, vinculos };
}

export function filaAItem(f: Record<string, unknown>): ItemCompetencia {
  // Un "precio antes" de más del triple no es una oferta: es un dato roto
  // (pasó con Jumbo). Se descarta también en lo ya guardado.
  const antes = f.precio_antes == null ? null : Number(f.precio_antes);
  const precioAntes = antes != null && antes > Number(f.precio) * 3 ? null : antes;
  return {
    id: f.id_item as string,
    comercio: f.comercio as Comercio,
    nombre: f.nombre as string,
    gramos: f.gramos == null ? null : Number(f.gramos),
    porKilo: Boolean(f.por_kilo),
    precio: Number(f.precio),
    precioAntes,
    nota: (f.nota as string | null | undefined) ?? null,
    url: link(f.url),
    disponible: Boolean(f.disponible),
    vistoEl: f.visto_el as string,
  };
}
