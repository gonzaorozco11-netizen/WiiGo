import type { SupabaseClient } from "@supabase/supabase-js";
import { leerConfigPrecios } from "@/lib/configPrecios";
import type { ConfigPrecios, Envase, Granel, ProductoPrecio } from "@/lib/calculoPrecio";

// Lo que necesita el módulo Precios, leído de la base. Lo usan la pantalla y
// "Pasar a la venta": ese recalcula todo desde acá, nunca con los números que
// manda el navegador.

export type ProductoDelModulo = ProductoPrecio & {
  nombre: string;
  idMarca: string;
  idSubcategoria: string | null;
  imagen: string | null;
  precioHoy: number | null;
  efectivoHoy: number | null;
  competencia: number | null;
  costoActualizadoEl: string | null;
};
export type RubroDelModulo = { id: string; nombre: string; idMarca: string; margen: number | null; descuentoEfectivo: number | null };
export type GranelDelModulo = Granel & {
  idProveedor: string | null;
  costoAnterior: number | null;
  actualizadoEl: string;
  /** El producto de la lista de Alifrut del que sale (sql/precios-alifrut.sql). */
  idItem: string | null;
};

export type DatosPrecios =
  | { disponible: false }
  | {
      disponible: true;
      config: ConfigPrecios;
      marcas: { id: string; nombre: string }[];
      rubros: RubroDelModulo[];
      productos: ProductoDelModulo[];
      granel: GranelDelModulo[];
      envases: Envase[];
      proveedores: { id: string; nombre: string }[];
    };

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export async function cargarDatosPrecios(supabase: SupabaseClient): Promise<DatosPrecios> {
  const { data: marcas } = await supabase.from("marcas").select("id_marca, nombre").eq("tipo_comercializacion", "PROPIA").order("nombre");
  const idsMarca = (marcas ?? []).map((m) => m.id_marca as string);
  const ninguna = ["00000000-0000-0000-0000-000000000000"];

  const [prodRes, subRes, granelRes, envRes, provRes, config] = await Promise.all([
    supabase
      .from("productos")
      .select(
        "id_producto, nombre, id_marca, id_subcategoria, imagen, costo_informado, costos_extra, iva_porcentaje, peso_neto_g, precio_venta, precio_efectivo, id_granel, id_envase, margen_objetivo, descuento_efectivo, precio_competencia, costo_actualizado_el"
      )
      .in("id_marca", idsMarca.length ? idsMarca : ninguna)
      .eq("estado", "ACTIVO")
      .order("nombre"),
    supabase.from("subcategorias").select("id_subcategoria, nombre, id_marca, margen_objetivo, descuento_efectivo").in("id_marca", idsMarca.length ? idsMarca : ninguna).eq("estado", "ACTIVA").order("nombre"),
    supabase.from("costos_granel").select("*").eq("estado", "ACTIVO").order("nombre"),
    supabase.from("envases").select("id_envase, nombre, costo").eq("estado", "ACTIVO").order("costo"),
    supabase.from("proveedores").select("id_proveedor, nombre").order("nombre"),
    leerConfigPrecios(supabase),
  ]);
  // Sin sql/precios.sql corrido, las columnas nuevas no existen.
  if (prodRes.error || subRes.error || granelRes.error || envRes.error) return { disponible: false };

  const rubros: RubroDelModulo[] = (subRes.data ?? []).map((s) => ({
    id: s.id_subcategoria as string,
    nombre: s.nombre as string,
    idMarca: s.id_marca as string,
    margen: num(s.margen_objetivo),
    descuentoEfectivo: num(s.descuento_efectivo),
  }));
  const rubroPorId = new Map(rubros.map((r) => [r.id, r]));

  const productos: ProductoDelModulo[] = (prodRes.data ?? []).map((p) => {
    const rubro = p.id_subcategoria ? rubroPorId.get(p.id_subcategoria as string) : undefined;
    return {
      id: p.id_producto as string,
      nombre: p.nombre as string,
      idMarca: p.id_marca as string,
      idSubcategoria: (p.id_subcategoria as string | null) ?? null,
      imagen: (p.imagen as string | null) ?? null,
      idGranel: (p.id_granel as string | null) ?? null,
      gramos: num(p.peso_neto_g),
      costoUnidad: num(p.costo_informado),
      idEnvase: (p.id_envase as string | null) ?? null,
      costoExtra: num(p.costos_extra) ?? 0,
      iva: num(p.iva_porcentaje),
      margen: num(p.margen_objetivo),
      descuentoEfectivo: num(p.descuento_efectivo),
      rubro: rubro ? { margen: rubro.margen, descuentoEfectivo: rubro.descuentoEfectivo } : null,
      precioHoy: num(p.precio_venta),
      efectivoHoy: num(p.precio_efectivo),
      competencia: num(p.precio_competencia),
      costoActualizadoEl: (p.costo_actualizado_el as string | null) ?? null,
    };
  });

  return {
    disponible: true,
    config,
    marcas: (marcas ?? []).map((m) => ({ id: m.id_marca as string, nombre: m.nombre as string })),
    rubros,
    productos,
    granel: (granelRes.data ?? []).map((g) => ({
      id: g.id_granel as string,
      nombre: g.nombre as string,
      costo: Number(g.costo_neto),
      unidad: g.unidad === "BULTO" || g.unidad === "CAJA" ? g.unidad : "KG",
      kgBulto: num(g.kg_bulto),
      idItem: (g.id_item as string | null | undefined) ?? null,
      idProveedor: (g.id_proveedor as string | null) ?? null,
      costoAnterior: num(g.costo_anterior),
      actualizadoEl: g.costo_actualizado_el as string,
    })),
    envases: (envRes.data ?? []).map((e) => ({ id: e.id_envase as string, nombre: e.nombre as string, costo: Number(e.costo) })),
    proveedores: (provRes.data ?? []).map((p) => ({ id: p.id_proveedor as string, nombre: p.nombre as string })),
  };
}
