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
  /**
   * El historial de entregas, para el bloque de abajo de Recepción.
   *
   * Son ENTREGAS, no pedidos: un pedido que llegó en dos veces aparece dos
   * veces, cada una con su fecha y sus unidades. No es un duplicado — cada
   * entrega tuvo su remito y va a tener su factura.
   */
  entregas: EntregaHistorial[];
  /** Los renglones de cada entrega, para la pantalla de Costeo. */
  lineasEntrega: LineaEntrega[];
};

export type EntregaHistorial = {
  idRecepcion: string;
  origen: "MARCA" | "PROVEEDOR";
  idOrden: string;
  /** Marca o proveedor, ya resuelto a nombre. */
  contraparte: string;
  /** El id, para poder abrir la ficha del proveedor al costear. */
  idContraparte: string;
  /** Cuándo se emitió la orden de compra. */
  fechaPedido: string | null;
  /** Cuándo entró esta entrega puntual. */
  fechaRecibida: string;
  unidades: number;
  /** 1ª, 2ª… y de cuántas en total lleva ese pedido. */
  numeroEntrega: number;
  totalEntregas: number;
  /** Estado del PEDIDO, no de la entrega. */
  estadoOrden: string;
  /** Ya tiene costo/factura cargada. Es lo que la saca de "Por costear". */
  facturada: boolean;
};

/**
 * Los renglones reales de una entrega.
 *
 * Costear la 2ª entrega tiene que mostrar lo que llegó EN ESA entrega, no
 * los renglones del pedido: si el pedido traía 4 productos y en la segunda
 * vuelta llegó uno solo, poner los cuatro es pedirle a administración que
 * ponga precio a mercadería que no tiene adelante.
 */
export type LineaEntrega = {
  idRecepcion: string;
  idVariante: string;
  /** Lo que pedía el renglón del pedido, para poder mostrar si faltó algo. */
  cantidadSolicitada: number;
  cantidadRecibida: number;
  /**
   * El costo real con el que se costeó esta línea, si ya se costeó: el del
   * papel más la parte de percepciones que le tocó.
   *
   * Hace falta para el control de que la factura cuadre cuando cubre más de
   * una entrega: sin esto no se puede saber cuánta plata aportan las otras.
   */
  costoUnitario: number | null;
  /**
   * Lo que decía el renglón de la factura, sin las percepciones repartidas.
   *
   * Los dos números, y no uno, porque el IVA se calcula sobre este y las
   * percepciones no llevan IVA. Con solo el costo real se le cobraría IVA a
   * la percepción y el total de la factura nunca cerraría exacto.
   */
  costoNetoFactura: number | null;
};

/** Cuántos meses de historial se traen. Ver el comentario en `datosCompras`. */
const MESES_HISTORIAL = 3;

export async function datosCompras(): Promise<DatosCompras> {
  const supabase = getSupabaseServerClient();

  // El historial se corta por fecha y no por cantidad de filas. Sin este
  // corte, dentro de un año la pantalla trae miles de entregas que nadie
  // mira y tarda varios segundos en abrir.
  const desde = new Date();
  desde.setMonth(desde.getMonth() - MESES_HISTORIAL);
  const desdeISO = desde.toISOString();

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
    entregasProvRes,
    entregasMarcaRes,
    lineasEntregaProvRes,
    lineasEntregaMarcaRes,
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
    // El historial de entregas de las dos tablas de recepción.
    supabase
      .from("recepciones_proveedor")
      .select("id_recepcion, id_orden, id_proveedor, fecha, facturada")
      .gte("fecha", desdeISO)
      .order("fecha", { ascending: false })
      .limit(300),
    supabase
      .from("recepciones")
      .select("id_recepcion, id_orden, id_marca, fecha")
      .gte("fecha", desdeISO)
      .order("fecha", { ascending: false })
      .limit(300),
    // Los renglones de cada entrega: sirven para sumar unidades en el
    // historial y, en Costeo, para saber qué llegó en esa entrega puntual.
    supabase
      .from("detalle_recepcion_proveedor")
      .select("id_recepcion, id_variante, cantidad_solicitada, cantidad_recibida, costo_unitario, costo_neto_factura"),
    supabase.from("detalle_recepciones").select("id_recepcion, id_variante, cantidad_solicitada, cantidad_recibida"),
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

  // ---------- Historial de entregas ----------
  const unidadesPorRecepcion = new Map<string, number>();
  for (const fila of [...(lineasEntregaProvRes.data ?? []), ...(lineasEntregaMarcaRes.data ?? [])]) {
    const id = fila.id_recepcion as string;
    unidadesPorRecepcion.set(id, (unidadesPorRecepcion.get(id) ?? 0) + ((fila.cantidad_recibida as number) ?? 0));
  }

  const nombreMarca = new Map(marcas.map((m) => [m.id_marca, m.nombre]));
  const nombreProveedor = new Map(proveedores.map((p) => [p.id_proveedor, p.nombre]));
  const ordenProv = new Map(
    ((ordProvRes.data ?? []) as DatosCompras["ordenesProveedor"]).map((o) => [o.id_orden, o])
  );
  const ordenMarca = new Map(
    ((ordMarcaRes.data ?? []) as DatosCompras["ordenesMarca"]).map((o) => [o.id_orden, o])
  );

  const crudas = [
    ...(entregasProvRes.data ?? []).map((r) => ({
      idRecepcion: r.id_recepcion as string,
      origen: "PROVEEDOR" as const,
      idOrden: r.id_orden as string,
      contraparte: nombreProveedor.get(r.id_proveedor as string) ?? "Proveedor",
      idContraparte: r.id_proveedor as string,
      fechaPedido: ordenProv.get(r.id_orden as string)?.fecha_alta ?? null,
      fechaRecibida: r.fecha as string,
      estadoOrden: ordenProv.get(r.id_orden as string)?.estado ?? "",
      facturada: Boolean(r.facturada),
    })),
    ...(entregasMarcaRes.data ?? []).map((r) => ({
      idRecepcion: r.id_recepcion as string,
      origen: "MARCA" as const,
      idOrden: r.id_orden as string,
      contraparte: nombreMarca.get(r.id_marca as string) ?? "Marca",
      idContraparte: r.id_marca as string,
      fechaPedido: ordenMarca.get(r.id_orden as string)?.fecha ?? null,
      fechaRecibida: r.fecha as string,
      estadoOrden: ordenMarca.get(r.id_orden as string)?.estado ?? "",
      // Lo de las marcas no se costea nunca: no hay factura que cargar.
      facturada: true,
    })),
  ];

  // "2ª de 3": se numeran por orden cronológico dentro de cada pedido, para
  // que se lea como una secuencia y no como filas repetidas.
  const porOrden = new Map<string, typeof crudas>();
  for (const e of crudas) {
    const lista = porOrden.get(e.idOrden);
    if (lista) lista.push(e);
    else porOrden.set(e.idOrden, [e]);
  }
  const numeroDe = new Map<string, { n: number; total: number }>();
  for (const lista of porOrden.values()) {
    const asc = [...lista].sort((a, b) => a.fechaRecibida.localeCompare(b.fechaRecibida));
    asc.forEach((e, i) => numeroDe.set(e.idRecepcion, { n: i + 1, total: asc.length }));
  }

  const entregas: EntregaHistorial[] = crudas
    .map((e) => ({
      ...e,
      unidades: unidadesPorRecepcion.get(e.idRecepcion) ?? 0,
      numeroEntrega: numeroDe.get(e.idRecepcion)?.n ?? 1,
      totalEntregas: numeroDe.get(e.idRecepcion)?.total ?? 1,
    }))
    .sort((a, b) => b.fechaRecibida.localeCompare(a.fechaRecibida));

  return {
    marcas,
    entregas,
    // Las dos tablas juntas: el historial de Recepción muestra entregas de
    // proveedor y de marca, y las dos se tienen que poder abrir.
    lineasEntrega: [
      ...(lineasEntregaProvRes.data ?? []).map((l) => ({
        idRecepcion: l.id_recepcion as string,
        idVariante: l.id_variante as string,
        cantidadSolicitada: (l.cantidad_solicitada as number) ?? 0,
        cantidadRecibida: (l.cantidad_recibida as number) ?? 0,
        costoUnitario: (l.costo_unitario as number | null) ?? null,
        costoNetoFactura: (l.costo_neto_factura as number | null) ?? null,
      })),
      ...(lineasEntregaMarcaRes.data ?? []).map((l) => ({
        idRecepcion: l.id_recepcion as string,
        idVariante: l.id_variante as string,
        cantidadSolicitada: (l.cantidad_solicitada as number) ?? 0,
        cantidadRecibida: (l.cantidad_recibida as number) ?? 0,
        // Lo de las marcas no tiene costo: no se compra.
        costoUnitario: null,
        costoNetoFactura: null,
      })),
    ],
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
