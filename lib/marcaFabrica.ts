import type { SupabaseClient } from "@supabase/supabase-js";

// La marca de fábrica entre paréntesis después del nombre, para que el
// cliente vea de quién es: «Pasta De Mani Natural x370gr (Entre Nuts)»
// (Gonzalo, 2026-11-06). Sale sola de la lista de Alifrut (la marca del
// producto de Alifrut del que sale el costo); no se escribe en el nombre.
//
// Reglas de Gonzalo:
// - Solo lo que viene envasado de fábrica: si lleva nuestra bolsita
//   (id_envase), lo fraccionamos nosotros y no lleva marca.
// - Nunca «Alifrut»: es el proveedor, no una marca para el cliente.
// - Los cereales, nada.
// - Sin marca cargada, nada. Y si el nombre ya la dice, no se repite.

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");

/** id_producto → la marca que se muestra. Solo están los que la llevan. */
export async function cargarMarcasFabrica(supabase: SupabaseClient): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const { data, error } = await supabase
    .from("productos")
    .select("id_producto, nombre, id_envase, marcas(tipo_comercializacion), subcategorias(nombre), costos_granel(catalogo_proveedor(marca))")
    .eq("estado", "ACTIVO")
    .range(0, 4999);
  if (error || !data) return mapa;
  for (const p of data) {
    const tipo = (p.marcas as unknown as { tipo_comercializacion: string } | null)?.tipo_comercializacion;
    if (tipo !== "PROPIA" || p.id_envase) continue;
    const rubro = (p.subcategorias as unknown as { nombre: string } | null)?.nombre ?? "";
    if (/^cereales$/i.test(rubro.trim())) continue;
    const marca = (p.costos_granel as unknown as { catalogo_proveedor: { marca: string | null } | null } | null)?.catalogo_proveedor?.marca?.trim();
    if (!marca || /^alifrut$/i.test(marca)) continue;
    if (plano(p.nombre as string).includes(plano(marca))) continue;
    mapa.set(p.id_producto as string, marca);
  }
  return mapa;
}

/** «Nombre (Marca)», o el nombre tal cual si no lleva. */
export function conMarca(nombre: string, marca: string | null | undefined): string {
  return marca ? `${nombre} (${marca})` : nombre;
}

/** Le agrega la marca al nombre (y a sus traducciones) de cada producto de una lista. */
export function nombresConMarca<T extends { id_producto: string; nombre: string; nombre_en?: string | null; nombre_pt?: string | null }>(
  productos: T[],
  marcas: Map<string, string>
): T[] {
  return productos.map((p) => {
    const m = marcas.get(p.id_producto);
    if (!m) return p;
    return {
      ...p,
      nombre: conMarca(p.nombre, m),
      ...(p.nombre_en ? { nombre_en: conMarca(p.nombre_en, m) } : {}),
      ...(p.nombre_pt ? { nombre_pt: conMarca(p.nombre_pt, m) } : {}),
    };
  });
}
