import type { SupabaseClient } from "@supabase/supabase-js";
import { COLUMNAS_PRODUCTO_PUBLICO, COLUMNAS_VARIANTE_PUBLICA, COLUMNAS_PROFESIONAL_PUBLICO, traerMarcasPublicas } from "@/lib/supabase";
import { fetchContenidoAsesor } from "@/lib/contenidoAsesor";
import { cargarMarcasFabrica } from "@/lib/marcaFabrica";

// El catálogo de la tienda online (public/tienda), con los nombres cortos que usa
// su app.js (viene del prototipo aprobado el 2026-11-12, que leía este mismo
// formato de un archivo). Es público: solo va lo que el cliente ve en el local.
// Nada de costos, códigos de barras, royalties ni códigos de las profesionales.
//
// Reglas de Gonzalo para la tienda:
// - Se venden todos los productos activos con precio, también los de las marcas
//   en consignación, y se muestran aunque no tengan foto (2026-11-11).
// - El stock es el del local; un producto en 0 dice «Sin stock».
// - La marca propia se ve como «WiiGo», nunca «Dietética».

// Las 8 categorías «macro» de la tienda agrupan las subcategorías (que en la base son por marca).
const CATEGORIA: Record<string, string[]> = {
  "Frutos secos y semillas": ["Frutos Secos Nacionales e importados", "Mix de Frutos Secos", "Semillas", "Frutas Deshidratadas"],
  "Desayuno y cereales": ["Cereales", "Granolas", "Avenas y derivados", "Leches vegetales", "Yerbas", "Tostadas", "Jugos"],
  "Snacks y dulces": ["Barritas", "Galletas", "Snacks saludables", "Cacaos y chocolates", "Dulces y mermeladas", "Pastas de mani"],
  "Almacén consciente": [
    "Aceite de coco", "Aceites de oliva", "Aceitunas", "Arroz y granos", "Azucares", "Escabeches, conservas y salsas", "Fideos de arroz",
    "Harinas y feculas", "Legumbres", "Mantecas ghee", "Polvos y esencias", "Premezclas", "Sales", "Stevia y edulcorantes", "Vinagres y acetos",
  ],
  "Bienestar natural": ["Adaptogenos", "Mieles y propoleos"],
};
function categoriaDe(marca: string, sub: string) {
  if (marca === "Animalfit") return "Suplementación y rendimiento";
  if (marca === "Alta") return "Viandas saludables";
  if (marca === "Crislo") return "Cuidado personal";
  for (const [c, subs] of Object.entries(CATEGORIA)) if (subs.includes(sub)) return c;
  return "Almacén consciente";
}
const nombreMarca = (n: string) => (n === "WiiGo Dietética" ? "WiiGo" : n);
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

type FilaProducto = {
  id_producto: string; id_marca: string; nombre: string; imagen: string | null;
  precio_venta: number; precio_efectivo: number | null; descuento_porcentaje: number | null;
  descripcion: string | null; fecha_alta: string | null; alergenos: string | null;
  subcategorias: { nombre: string } | null;
};

export async function armarCatalogoTienda(supabase: SupabaseClient) {
  // La estación de la tienda. Hoy hay un solo local; cuando haya más, cada pedido
  // va a elegir el suyo y esto va a mandar el stock de cada uno.
  const { data: local } = await supabase
    .from("locales")
    .select("id_local")
    .eq("estado", "ACTIVO")
    .order("nombre")
    .limit(1)
    .maybeSingle();

  const [marcasRes, productosRes, variantesRes, stockRes, contenido, marcasFabrica, profesionalesRes, profObjRes] = await Promise.all([
    traerMarcasPublicas(supabase as never),
    supabase
      .from("productos")
      .select(`${COLUMNAS_PRODUCTO_PUBLICO},descripcion,fecha_alta,alergenos,subcategorias(nombre)`)
      .eq("estado", "ACTIVO")
      .gt("precio_venta", 0)
      .range(0, 4999),
    supabase.from("variantes_producto").select(COLUMNAS_VARIANTE_PUBLICA).eq("estado", "ACTIVO").range(0, 9999),
    local ? supabase.from("stock").select("id_variante, cantidad").eq("id_local", local.id_local).range(0, 9999) : Promise.resolve({ data: [], error: null }),
    fetchContenidoAsesor(supabase),
    cargarMarcasFabrica(supabase).catch(() => new Map<string, string>()),
    supabase.from("profesionales").select(COLUMNAS_PROFESIONAL_PUBLICO).eq("estado", "ACTIVO").eq("publicado", true).order("orden", { ascending: true }),
    supabase.from("profesional_objetivos").select("id_profesional, id_objetivo"),
  ]);
  if (productosRes.error) throw new Error(`productos: ${productosRes.error.message}`);

  const marcaPorId = new Map(marcasRes.marcas.map((m) => [m.id_marca, m]));
  const objetivoNombre = new Map(contenido.objetivosGlobales.map((o) => [o.id_objetivo, o.nombre]));
  const filtroNombre = new Map(contenido.filtrosGlobales.map((f) => [f.id_filtro, f.nombre]));

  const stockVariante = new Map<string, number>();
  for (const s of (stockRes.data ?? []) as { id_variante: string; cantidad: number }[]) {
    stockVariante.set(s.id_variante, (stockVariante.get(s.id_variante) ?? 0) + Math.max(0, Number(s.cantidad) || 0));
  }
  const variantesDe = new Map<string, { nombre: string; id_variante: string; orden: number | null }[]>();
  for (const v of (variantesRes.data ?? []) as { id_variante: string; id_producto: string; nombre: string; orden: number | null }[]) {
    const lista = variantesDe.get(v.id_producto) ?? [];
    lista.push(v);
    variantesDe.set(v.id_producto, lista);
  }

  const productos: { m: string; [campo: string]: unknown }[] = [];
  for (const p of (productosRes.data ?? []) as unknown as FilaProducto[]) {
    const marca = marcaPorId.get(p.id_marca);
    if (!marca) continue; // marca dada de baja: no se vende
    const m = nombreMarca(marca.nombre);
    const sub = p.subcategorias?.nombre ?? "";
    const variantes = (variantesDe.get(p.id_producto) ?? []).sort(
      (a, b) => (a.orden ?? 9999) - (b.orden ?? 9999) || a.nombre.localeCompare(b.nombre, "es")
    );
    const f = contenido.fichaPorProducto[p.id_producto] as Record<string, unknown> | undefined;
    productos.push({
      id: p.id_producto,
      n: p.nombre,
      m,
      mf: marcasFabrica.get(p.id_producto) ?? null,
      c: categoriaDe(m, sub),
      sc: sub,
      p: Number(p.precio_venta),
      e: p.precio_efectivo ? Number(p.precio_efectivo) : null,
      dto: Number(p.descuento_porcentaje || 0) || 0,
      s: variantes.reduce((a, v) => a + (stockVariante.get(v.id_variante) ?? 0), 0),
      img: p.imagen || null,
      alta: p.fecha_alta,
      v: variantes.filter((v) => v.nombre !== "Único").map((v) => ({ n: v.nombre, s: stockVariante.get(v.id_variante) ?? 0 })),
      o: texto(f?.origen),
      po: texto(f?.porcion),
      k: num(f?.kcal_100g),
      pr: num(f?.proteinas),
      ca: num(f?.carbohidratos),
      gr: num(f?.grasas),
      fi: num(f?.fibra),
      so: num(f?.sodio),
      mi: texto(f?.micronutrientes),
      in: texto(f?.ingredientes),
      de: texto(f?.descripcion_publica) ?? texto(p.descripcion),
      cl: texto(f?.clasificacion),
      ob: (contenido.objetivosPorProducto[p.id_producto] ?? []).map((id) => objetivoNombre.get(id)).filter(Boolean),
      fl: (contenido.filtrosPorProducto[p.id_producto] ?? []).map((id) => filtroNombre.get(id)).filter(Boolean),
      al: texto(p.alergenos),
    });
  }

  const marcas = marcasRes.marcas.map((mk) => {
    const n = nombreMarca(mk.nombre);
    return { n, logo: mk.logo || null, cant: productos.filter((p) => p.m === n).length };
  }).filter((mk) => mk.cant > 0);

  const objetivosDe = new Map<string, string[]>();
  for (const r of (profObjRes.data ?? []) as { id_profesional: string; id_objetivo: string }[]) {
    const n = objetivoNombre.get(r.id_objetivo);
    if (n) objetivosDe.set(r.id_profesional, [...(objetivosDe.get(r.id_profesional) ?? []), n]);
  }
  const profesionales = ((profesionalesRes.data ?? []) as unknown as {
    id_profesional: string; nombre: string; apellido: string | null; titulo: string | null; especialidad: string | null; foto: string | null;
  }[]).map((pr) => ({
    n: `${pr.nombre}${pr.apellido ? ` ${pr.apellido}` : ""}`,
    t: pr.titulo ?? "",
    es: pr.especialidad ?? "",
    foto: pr.foto || null,
    ob: objetivosDe.get(pr.id_profesional)?.[0] ?? null,
  }));

  return {
    generado: new Date().toISOString(),
    productos,
    marcas,
    profesionales,
    objetivos: contenido.objetivosGlobales.map((o) => o.nombre),
    filtros: contenido.filtrosGlobales.map((f) => f.nombre),
  };
}
