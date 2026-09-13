import {
  getSupabaseServerClient,
  type Marca,
  type Local,
  type Producto,
  type VarianteProducto,
  type Stock,
  type OrdenReposicion,
  type DetalleReposicion,
  type OrdenCompraProveedor,
  type DetalleOrdenCompra,
} from "@/lib/supabase";
import { listarProveedores, type ProveedorConSaldo } from "@/app/(app)/proveedores/actions";

// Todo lo que las tres pantallas de Compras necesitan para abrir sus
// formularios sin mandar a nadie a otra sección.
//
// Va en un solo lugar porque los formularios son los mismos que ya usan
// Abastecimiento y Proveedores, y piden bastantes datos: el catálogo para
// elegir productos, el stock para sugerir cantidades, y las dos tablas de
// órdenes con su detalle. Repetir estas consultas en tres páginas sería
// pedirle lo mismo a la base tres veces.

export type DatosCompras = {
  marcas: Marca[];
  /**
   * A un proveedor solo se le compra mercadería de marca propia: lo de las
   * marcas en consignación te lo mandan ellas y no se compra. Sin esta lista,
   * el formulario de orden a proveedor ofrece productos de Star Nutrition,
   * que es imposible comprarle a Alifrut.
   */
  idsMarcaPropia: string[];
  proveedores: ProveedorConSaldo[];
  locales: Local[];
  productos: Producto[];
  variantes: VarianteProducto[];
  stock: Stock[];
  // `enviada_el` no está en los tipos generales porque es propio de Compras:
  // es lo que decide en qué etapa está cada pedido.
  ordenesMarca: (OrdenReposicion & { enviada_el: string | null })[];
  detalleMarca: DetalleReposicion[];
  ordenesProveedor: (OrdenCompraProveedor & { enviada_el: string | null })[];
  detalleProveedor: DetalleOrdenCompra[];
  /** Recepciones de proveedor sin costo cargado, para la etapa de Costeo. */
  recepcionesSinCostear: { id_recepcion: string; id_orden: string; id_proveedor: string; fecha: string }[];
  /**
   * Las ya costeadas que TODAVÍA no se liquidaron.
   *
   * Se muestran para poder corregir un costo mal cargado: hasta que no se
   * liquida, ese número no se le pagó a nadie y cambiarlo no reescribe nada.
   * Una vez liquidado deja de aparecer — ahí el costo ya se pagó y el ajuste
   * va en la liquidación siguiente, no borrando el pasado.
   */
  recepcionesCosteadas: { id_recepcion: string; id_orden: string; id_proveedor: string; fecha: string }[];
};

export async function datosCompras(): Promise<DatosCompras> {
  const supabase = getSupabaseServerClient();

  const [
    proveedores,
    marcasRes,
    localesRes,
    productosRes,
    variantesRes,
    stockRes,
    ordMarcaRes,
    detMarcaRes,
    ordProvRes,
    detProvRes,
    recepRes,
    costeadasRes,
    liquidadosRes,
    lotesRes,
  ] = await Promise.all([
    listarProveedores(),
    supabase.from("marcas").select("*").eq("estado", "ACTIVA").order("nombre", { ascending: true }),
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase.from("productos").select("*").eq("estado", "ACTIVO"),
    supabase.from("variantes_producto").select("*").eq("estado", "ACTIVO"),
    supabase.from("stock").select("*"),
    // Solo las de los últimos meses: el histórico completo no se usa en
    // ninguna de las tres pantallas y crece para siempre.
    supabase.from("ordenes_reposicion").select("*").order("fecha", { ascending: false }).limit(120),
    supabase.from("detalle_reposicion").select("*"),
    supabase.from("ordenes_compra_proveedor").select("*").order("fecha_alta", { ascending: false }).limit(120),
    supabase.from("detalle_orden_compra").select("*"),
    supabase
      .from("recepciones_proveedor")
      .select("id_recepcion, id_orden, id_proveedor, fecha")
      .eq("facturada", false)
      .order("fecha", { ascending: true })
      .limit(60),
    supabase
      .from("recepciones_proveedor")
      .select("id_recepcion, id_orden, id_proveedor, fecha")
      .eq("facturada", true)
      .order("fecha", { ascending: false })
      .limit(40),
    // Los lotes que ya entraron en una liquidación cerrada: esos costos ya se
    // pagaron y no se tocan más.
    supabase.from("detalle_liquidacion_proveedor").select("id_detalle_recepcion"),
    supabase.from("detalle_recepcion_proveedor").select("id_detalle, id_recepcion"),
  ]);

  const marcas = (marcasRes.data ?? []) as Marca[];

  // Una recepción se puede corregir solo si NINGUNO de sus lotes entró ya en
  // una liquidación cerrada. Con uno solo liquidado, el costo de esa
  // recepción ya se pagó y cambiarlo sería reescribir el pasado.
  const lotesLiquidados = new Set(
    (liquidadosRes.data ?? []).map((d) => d.id_detalle_recepcion as string).filter(Boolean)
  );
  const recepcionesConLoteLiquidado = new Set(
    (lotesRes.data ?? [])
      .filter((l) => lotesLiquidados.has(l.id_detalle as string))
      .map((l) => l.id_recepcion as string)
  );

  return {
    marcas,
    idsMarcaPropia: marcas
      .filter((m) => (m as Marca & { tipo_comercializacion?: string }).tipo_comercializacion === "PROPIA")
      .map((m) => m.id_marca),
    proveedores,
    locales: (localesRes.data ?? []) as Local[],
    productos: (productosRes.data ?? []) as Producto[],
    variantes: (variantesRes.data ?? []) as VarianteProducto[],
    stock: (stockRes.data ?? []) as Stock[],
    ordenesMarca: (ordMarcaRes.data ?? []) as DatosCompras["ordenesMarca"],
    detalleMarca: (detMarcaRes.data ?? []) as DetalleReposicion[],
    ordenesProveedor: (ordProvRes.data ?? []) as DatosCompras["ordenesProveedor"],
    detalleProveedor: (detProvRes.data ?? []) as DetalleOrdenCompra[],
    recepcionesSinCostear: (recepRes.data ?? []) as DatosCompras["recepcionesSinCostear"],
    recepcionesCosteadas: ((costeadasRes.data ?? []) as DatosCompras["recepcionesCosteadas"]).filter(
      (r) => !recepcionesConLoteLiquidado.has(r.id_recepcion)
    ),
  };
}
