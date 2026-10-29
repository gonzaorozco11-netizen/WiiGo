import type { SupabaseClient } from "@supabase/supabase-js";
import type { Granel } from "@/lib/calculoPrecio";
import type { UnidadLista } from "@/lib/listaAlifrut";

// El catálogo de Alifrut con los precios exclusivos de WiiGo (tabla
// catalogo_proveedor, sql/precios-alifrut.sql), y su estado: de qué fecha es
// la lista, cuándo se trajo y cuándo avisó Alifrut que cambió algo.

export const CLAVES_ALIFRUT = {
  /** Fecha que dice la lista ("Última actualización: 28 de octubre de 2026"). */
  listaDel: "ALIFRUT_LISTA_DEL",
  /** Cuándo la pegó Gonzalo. */
  traidaEl: "ALIFRUT_LISTA_TRAIDA_EL",
  /** La "huella" pública de su catálogo: cambia cuando Alifrut cambia algo. */
  huella: "ALIFRUT_HUELLA",
  huellaCambioEl: "ALIFRUT_HUELLA_CAMBIO_EL",
} as const;

export type ItemCatalogo = {
  id: string;
  categoria: string | null;
  nombre: string;
  marca: string | null;
  presentacion: string | null;
  unidad: UnidadLista;
  cantidad: number;
  revisada: boolean;
  costo: number;
  costoAnterior: number | null;
  cambioEl: string | null;
  vistoEl: string;
};

export type EstadoAlifrut = {
  idProveedor: string | null;
  listaDel: string | null;
  traidaEl: string | null;
  huellaCambioEl: string | null;
};

/** Cómo lo usa el cálculo de precios: KG → por kg, BOLSA → bulto de tantos kg, CAJA y UNIDAD → caja de tantas unidades. */
export function granelDesdeItem(item: { costo_neto: unknown; unidad: unknown; cantidad: unknown; nombre?: unknown }): Omit<Granel, "id"> {
  const cantidad = Number(item.cantidad ?? 1) || 1;
  const costo = Number(item.costo_neto);
  const nombre = String(item.nombre ?? "");
  if (item.unidad === "BOLSA") return { nombre, costo, unidad: "BULTO", kgBulto: cantidad };
  if (item.unidad === "CAJA" || item.unidad === "UNIDAD") return { nombre, costo, unidad: "CAJA", kgBulto: item.unidad === "UNIDAD" ? 1 : cantidad };
  return { nombre, costo, unidad: "KG", kgBulto: null };
}

/** null si todavía no se corrió sql/precios-alifrut.sql. */
export async function cargarCatalogoAlifrut(supabase: SupabaseClient): Promise<{ items: ItemCatalogo[]; estado: EstadoAlifrut } | null> {
  const { data: prov } = await supabase.from("proveedores").select("id_proveedor").ilike("nombre", "%alifrut%").limit(1).maybeSingle();
  const idProveedor = (prov?.id_proveedor as string | undefined) ?? null;
  const items: ItemCatalogo[] = [];
  if (idProveedor) {
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supabase
        .from("catalogo_proveedor")
        .select("id_item, categoria, nombre, marca, presentacion, unidad, cantidad, unidad_revisada, costo_neto, costo_anterior, costo_cambio_el, visto_el")
        .eq("id_proveedor", idProveedor)
        .order("categoria")
        .order("nombre")
        .range(desde, desde + 999);
      if (error) return null;
      items.push(
        ...data.map((i) => ({
          id: i.id_item as string,
          categoria: (i.categoria as string | null) ?? null,
          nombre: i.nombre as string,
          marca: (i.marca as string | null) ?? null,
          presentacion: (i.presentacion as string | null) ?? null,
          unidad: i.unidad as UnidadLista,
          cantidad: Number(i.cantidad ?? 1) || 1,
          revisada: Boolean(i.unidad_revisada),
          costo: Number(i.costo_neto),
          costoAnterior: i.costo_anterior == null ? null : Number(i.costo_anterior),
          cambioEl: (i.costo_cambio_el as string | null) ?? null,
          vistoEl: i.visto_el as string,
        }))
      );
      if (data.length < 1000) break;
    }
  } else {
    const { error } = await supabase.from("catalogo_proveedor").select("id_item", { head: true, count: "exact" });
    if (error) return null;
  }
  const { data: cfg } = await supabase.from("configuracion").select("parametro, valor").in("parametro", Object.values(CLAVES_ALIFRUT));
  const v = new Map((cfg ?? []).map((f) => [f.parametro as string, (f.valor as string | null) ?? null]));
  return {
    items,
    estado: {
      idProveedor,
      listaDel: v.get(CLAVES_ALIFRUT.listaDel) ?? null,
      traidaEl: v.get(CLAVES_ALIFRUT.traidaEl) ?? null,
      huellaCambioEl: v.get(CLAVES_ALIFRUT.huellaCambioEl) ?? null,
    },
  };
}
