// Liquidación por venta (modo LIQUIDACION_VENTA en proveedores, caso
// Alifrut): se le paga el costo de lo vendido en el período, nunca de lo
// entregado — mucho más simple que lib/cuentaComercialMarca.ts o el módulo
// Liquidaciones de marcas: sin royalty, sin comisión de Mercado Pago
// trasladada, sin SIRCREB. WiiGo se queda con todo el margen entre el
// precio de venta y este costo.
//
// El costo de cada unidad vendida se calcula por FIFO (ver
// lib/fifoProveedor.ts): se descuenta del lote/remito más viejo que todavía
// tenga saldo, así se paga exactamente lo que costó cada unidad real, no un
// promedio ni el último costo cargado.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  simularConsumoFifo,
  aplicarConsumoLotes,
  lotesDeVariante,
  consumirEnMemoria,
  type ConsumoLote,
} from "./fifoProveedor";

// ===================== DETALLE PARA PANTALLA =====================
//
// Lo de abajo (calcularLiquidacionProveedor) da el número que hay que pagar.
// Esto da el detalle para mirarlo: abierto por medio de pago, por producto y
// por lote, con el IVA y el margen.
//
// Por qué en orden cronológico y no sumando cantidades por producto: si el
// mes tuvo dos recepciones a costos distintos, el lote que le tocó a cada
// venta depende de cuándo se hizo. Sumar primero y aplicar FIFO al total
// daría el mismo costo total, pero no permitiría decir qué venta salió de
// qué lote — que es justo lo que hay que mostrar.

// MERMA no es un medio de pago — es mercadería que se perdió y que igual hay
// que pagarle al proveedor. Viaja como un "medio" más porque recorre
// exactamente el mismo camino que una venta (consume lotes FIFO, suma costo,
// lleva IVA); lo único que cambia es que del otro lado no hay plata que entró.
// Meterla en un grupo propio es lo que permite verla separada en pantalla en
// vez de disfrazada de menor margen.
export type MedioLiquidacion = "ELECTRONICO" | "EFECTIVO" | "MERMA";

export type LoteDeLinea = {
  idDetalleRecepcion: string;
  fechaRecepcion: string;
  cantidad: number;
  costoUnitario: number;
};

export type LineaDetalle = {
  idVariante: string;
  nombreProducto: string;
  ivaPorcentaje: number;
  precioVenta: number;
  cantidad: number;
  costoNeto: number;
  iva: number;
  ventaNeta: number;
  ventaTotal: number;
  margen: number;
  lotes: LoteDeLinea[];
  /** Solo en las líneas de merma: por qué se perdió. "3 rotura · 1 vencimiento". */
  motivos?: string;
};

export type TotalesDetalle = {
  cantidad: number;
  costoNeto: number;
  iva: number;
  total: number;
  ventaNeta: number;
  ventaTotal: number;
  margen: number;
};

export type DetalleLiquidacion = {
  porMedio: { medio: MedioLiquidacion; lineas: LineaDetalle[]; totales: TotalesDetalle }[];
  totales: TotalesDetalle;
  estimado: boolean;
};

function totalesVacios(): TotalesDetalle {
  return { cantidad: 0, costoNeto: 0, iva: 0, total: 0, ventaNeta: 0, ventaTotal: 0, margen: 0 };
}

function redondear2(v: number) {
  return Math.round(v * 100) / 100;
}

function acumular(t: TotalesDetalle, l: LineaDetalle) {
  t.cantidad += l.cantidad;
  t.costoNeto = redondear2(t.costoNeto + l.costoNeto);
  t.iva = redondear2(t.iva + l.iva);
  t.total = redondear2(t.costoNeto + t.iva);
  t.ventaNeta = redondear2(t.ventaNeta + l.ventaNeta);
  t.ventaTotal = redondear2(t.ventaTotal + l.ventaTotal);
  t.margen = redondear2(t.margen + l.margen);
}

/** Una merma pendiente de pagarle al proveedor. */
export type MermaPendiente = {
  idMerma: string;
  idVariante: string;
  cantidad: number;
  motivo: string;
  fecha: string;
};

/**
 * La merma sin liquidar de las variantes de un proveedor, dentro del período.
 *
 * Se filtra por fecha igual que las ventas: una merma de marzo no tiene por
 * qué aparecer en la liquidación de abril sin que nadie lo haya decidido.
 */
export async function mermasSinLiquidar(
  supabase: SupabaseClient,
  varianteIds: string[],
  fechaDesde: string,
  fechaHasta: string
): Promise<MermaPendiente[]> {
  if (varianteIds.length === 0) return [];
  const { data } = await supabase
    .from("mermas")
    .select("id_merma, id_variante, cantidad, motivo, fecha")
    .in("id_variante", varianteIds)
    .is("id_liquidacion_proveedor", null)
    .gte("fecha", `${fechaDesde}T00:00:00`)
    .lte("fecha", `${fechaHasta}T23:59:59`)
    .order("fecha", { ascending: true });

  return (data ?? []).map((m) => ({
    idMerma: m.id_merma as string,
    idVariante: m.id_variante as string,
    cantidad: (m.cantidad as number) ?? 0,
    motivo: (m.motivo as string) ?? "OTRO",
    fecha: m.fecha as string,
  }));
}

/** "3 rotura · 1 vencimiento", para mostrar al lado de la línea. */
function resumirMotivos(mermas: MermaPendiente[]) {
  const porMotivo = new Map<string, number>();
  for (const m of mermas) porMotivo.set(m.motivo, (porMotivo.get(m.motivo) ?? 0) + m.cantidad);
  return [...porMotivo.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([motivo, cantidad]) => `${cantidad} ${motivo.toLowerCase()}`)
    .join(" · ");
}

export type LineaLiquidacionProveedor = {
  idVariante: string;
  nombreProducto: string;
  cantidadVendida: number;
  costoUnitario: number; // promedio ponderado entre los lotes consumidos, para mostrar un solo número
  subtotal: number;
  lotes: ConsumoLote[]; // detalle por remito, para trazabilidad
  estimado: boolean; // true si algún tramo no tenía lote/costo registrado y se estimó
};

// Se marca por LÍNEA de venta (detalle_ventas.id_liquidacion_proveedor), no
// en toda la venta — un mismo carrito puede mezclar productos de este
// proveedor con otros de otro proveedor o de una marca, y no queremos que
// liquidar a uno tape la posibilidad de liquidar al otro.
export async function calcularLiquidacionProveedor(
  supabase: SupabaseClient,
  idProveedor: string,
  fechaDesde: string,
  fechaHasta: string
): Promise<{ lineas: LineaLiquidacionProveedor[]; total: number }> {
  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre, costo_informado")
    .eq("id_proveedor_liquidacion", idProveedor);
  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto as string, p]));
  const productoIds = [...productoPorId.keys()];
  if (productoIds.length === 0) return { lineas: [], total: 0 };

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_producto", productoIds);
  const varianteIds = (variantes ?? []).map((v) => v.id_variante as string);
  if (varianteIds.length === 0) return { lineas: [], total: 0 };

  const { data: ventasDelPeriodo } = await supabase
    .from("ventas")
    .select("id_venta")
    .eq("estado", "PAGADA")
    .gte("fecha", `${fechaDesde}T00:00:00`)
    .lte("fecha", `${fechaHasta}T23:59:59`);
  const idsVenta = (ventasDelPeriodo ?? []).map((v) => v.id_venta as string);

  // La merma se paga igual que lo vendido, así que entra al mismo cálculo.
  // Se lee antes del corte por "no hay ventas": un mes sin una sola venta
  // pero con mercadería rota le debe plata a Alifrut lo mismo.
  const mermas = await mermasSinLiquidar(supabase, varianteIds, fechaDesde, fechaHasta);

  const { data: detalle } = idsVenta.length
    ? await supabase
        .from("detalle_ventas")
        .select("id_variante, cantidad")
        .in("id_venta", idsVenta)
        .in("id_variante", varianteIds)
        .is("id_liquidacion_proveedor", null)
    : { data: [] as { id_variante: string; cantidad: number }[] };

  if ((detalle ?? []).length === 0 && mermas.length === 0) return { lineas: [], total: 0 };

  const nombrePorVariante = new Map<string, string>();
  const costoReservaPorVariante = new Map<string, number>();
  for (const v of variantes ?? []) {
    const producto = productoPorId.get(v.id_producto as string);
    const nombreBase = producto?.nombre ?? "Producto";
    nombrePorVariante.set(v.id_variante as string, v.nombre !== "Único" ? `${nombreBase} — ${v.nombre}` : nombreBase);
    costoReservaPorVariante.set(v.id_variante as string, (producto?.costo_informado as number | null) ?? 0);
  }

  const cantidadPorVariante = new Map<string, number>();
  for (const d of detalle ?? []) {
    cantidadPorVariante.set(d.id_variante, (cantidadPorVariante.get(d.id_variante) ?? 0) + (d.cantidad ?? 0));
  }
  // Las unidades de merma se suman a las vendidas: para el FIFO son lo mismo,
  // mercadería que salió del lote y hay que pagar.
  for (const m of mermas) {
    cantidadPorVariante.set(m.idVariante, (cantidadPorVariante.get(m.idVariante) ?? 0) + m.cantidad);
  }

  const lineas: LineaLiquidacionProveedor[] = [];
  let total = 0;
  for (const [idVariante, cantidad] of cantidadPorVariante) {
    if (cantidad <= 0) continue;
    const resultado = await simularConsumoFifo(supabase, idProveedor, idVariante, cantidad, costoReservaPorVariante.get(idVariante) ?? null);
    const subtotal = Math.round(resultado.costoTotal);
    lineas.push({
      idVariante,
      nombreProducto: nombrePorVariante.get(idVariante) ?? "Producto",
      cantidadVendida: cantidad,
      costoUnitario: Math.round(resultado.costoTotal / cantidad),
      subtotal,
      lotes: resultado.consumos,
      estimado: resultado.estimado,
    });
    total += subtotal;
  }

  return { lineas, total };
}

/**
 * El detalle de la liquidación, para la pantalla.
 *
 * Recorre las ventas del período en orden y va consumiendo los lotes en
 * memoria, así cada línea de venta se lleva el costo del lote que realmente
 * le tocó. No escribe nada: los saldos reales de los lotes se descuentan
 * recién al confirmar (ver generarLiquidacionProveedor).
 */
export async function detalleLiquidacionProveedor(
  supabase: SupabaseClient,
  idProveedor: string,
  fechaDesde: string,
  fechaHasta: string
): Promise<DetalleLiquidacion> {
  const vacio: DetalleLiquidacion = {
    porMedio: [
      { medio: "ELECTRONICO", lineas: [], totales: totalesVacios() },
      { medio: "EFECTIVO", lineas: [], totales: totalesVacios() },
      { medio: "MERMA", lineas: [], totales: totalesVacios() },
    ],
    totales: totalesVacios(),
    estimado: false,
  };

  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre, costo_informado, iva_porcentaje")
    .eq("id_proveedor_liquidacion", idProveedor);
  if (!productos || productos.length === 0) return vacio;
  const productoPorId = new Map(productos.map((p) => [p.id_producto as string, p]));

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_producto", [...productoPorId.keys()]);
  if (!variantes || variantes.length === 0) return vacio;
  const variantePorId = new Map(variantes.map((v) => [v.id_variante as string, v]));

  // Las ventas en orden: es lo que define qué lote le toca a cada una.
  const { data: ventas } = await supabase
    .from("ventas")
    .select("id_venta, medio_pago, fecha")
    .eq("estado", "PAGADA")
    .gte("fecha", `${fechaDesde}T00:00:00`)
    .lte("fecha", `${fechaHasta}T23:59:59`)
    .order("fecha", { ascending: true });
  const ventaPorId = new Map((ventas ?? []).map((v) => [v.id_venta as string, v]));

  const mermas = await mermasSinLiquidar(supabase, [...variantePorId.keys()], fechaDesde, fechaHasta);

  const { data: detalle } = ventaPorId.size
    ? await supabase
        .from("detalle_ventas")
        .select("id_venta, id_variante, cantidad, precio_unitario, subtotal")
        .in("id_venta", [...ventaPorId.keys()])
        .in("id_variante", [...variantePorId.keys()])
        .is("id_liquidacion_proveedor", null)
    : { data: [] as Record<string, unknown>[] };

  if ((detalle ?? []).length === 0 && mermas.length === 0) return vacio;

  // Ventas y mermas en una sola línea de tiempo.
  //
  // Van mezcladas y ordenadas por fecha porque el FIFO depende del orden: si
  // el día 3 se rompió una bolsa del lote viejo y el día 10 se vendió otra,
  // la rota salió del lote viejo y la vendida del nuevo. Procesando primero
  // todas las ventas y después todas las mermas, los costos se cruzarían.
  type Evento = {
    fecha: string;
    idVariante: string;
    cantidad: number;
    medio: MedioLiquidacion;
    /** Lo que entró por esa venta. En una merma es 0: no entró nada. */
    subtotalVenta: number;
  };

  const eventos: Evento[] = [
    ...(detalle ?? []).map((d) => {
      const venta = ventaPorId.get(d.id_venta as string);
      const cantidad = (d.cantidad as number) ?? 0;
      return {
        fecha: (venta?.fecha as string) ?? "",
        idVariante: d.id_variante as string,
        cantidad,
        medio: (venta?.medio_pago === "EFECTIVO" ? "EFECTIVO" : "ELECTRONICO") as MedioLiquidacion,
        subtotalVenta: (d.subtotal as number | null) ?? ((d.precio_unitario as number) ?? 0) * cantidad,
      };
    }),
    ...mermas.map((m) => ({
      fecha: m.fecha,
      idVariante: m.idVariante,
      cantidad: m.cantidad,
      medio: "MERMA" as MedioLiquidacion,
      subtotalVenta: 0,
    })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Los lotes se cargan una vez por variante y se van gastando en memoria.
  const lotesPorVariante = new Map<string, Awaited<ReturnType<typeof lotesDeVariante>>>();
  for (const idVariante of new Set(eventos.map((e) => e.idVariante))) {
    lotesPorVariante.set(idVariante, await lotesDeVariante(supabase, idProveedor, idVariante));
  }

  // Clave: medio + variante. Adentro se acumulan los lotes por recepción.
  const acumulado = new Map<string, LineaDetalle & { _lotes: Map<string, LoteDeLinea> }>();
  let estimado = false;

  for (const ev of eventos) {
    const cantidad = ev.cantidad;
    if (cantidad <= 0) continue;

    const idVariante = ev.idVariante;
    const v = variantePorId.get(idVariante);
    const p = v ? productoPorId.get(v.id_producto as string) : undefined;
    if (!v || !p) continue;

    const medio = ev.medio;

    const r = consumirEnMemoria(
      lotesPorVariante.get(idVariante) ?? [],
      cantidad,
      (p.costo_informado as number | null) ?? 0
    );
    if (r.estimado) estimado = true;

    const clave = `${medio}|${idVariante}`;
    let linea = acumulado.get(clave);
    if (!linea) {
      const nombreBase = (p.nombre as string) ?? "Producto";
      linea = {
        idVariante,
        nombreProducto: v.nombre !== "Único" ? `${nombreBase} — ${v.nombre}` : nombreBase,
        ivaPorcentaje: (p.iva_porcentaje as number | null) ?? 21,
        precioVenta: 0,
        cantidad: 0,
        costoNeto: 0,
        iva: 0,
        ventaNeta: 0,
        ventaTotal: 0,
        margen: 0,
        lotes: [],
        _lotes: new Map(),
      };
      acumulado.set(clave, linea);
    }

    // El precio de venta se muestra como el unitario real de la línea. Si en
    // el período se vendió a distintos precios, queda el promedio ponderado
    // — el que importa para el margen. En una merma queda en 0, que es la
    // verdad: esa mercadería no se vendió a ningún precio.
    linea.cantidad += cantidad;
    linea.ventaTotal = redondear2(linea.ventaTotal + ev.subtotalVenta);
    linea.precioVenta = linea.cantidad > 0 ? redondear2(linea.ventaTotal / linea.cantidad) : 0;

    for (const c of r.consumos) {
      const k = c.idDetalleRecepcion;
      const ya = linea._lotes.get(k);
      if (ya) ya.cantidad += c.cantidad;
      else
        linea._lotes.set(k, {
          idDetalleRecepcion: k,
          fechaRecepcion: c.fechaRecepcion,
          cantidad: c.cantidad,
          costoUnitario: c.costoUnitario,
        });
      linea.costoNeto = redondear2(linea.costoNeto + c.cantidad * c.costoUnitario);
    }
  }

  // Los motivos de merma, agrupados por producto, para poder mostrar
  // "3 rotura · 1 vencimiento" al lado de la línea.
  const mermasPorVariante = new Map<string, MermaPendiente[]>();
  for (const m of mermas) {
    mermasPorVariante.set(m.idVariante, [...(mermasPorVariante.get(m.idVariante) ?? []), m]);
  }

  const porMedio = (["ELECTRONICO", "EFECTIVO", "MERMA"] as MedioLiquidacion[]).map((medio) => {
    const lineas: LineaDetalle[] = [];
    const totales = totalesVacios();

    for (const [clave, acc] of acumulado) {
      if (!clave.startsWith(`${medio}|`)) continue;
      // Se arma una línea limpia: `_lotes` es un Map de trabajo y no tiene
      // por qué viajar al navegador.
      const { _lotes, ...resto } = acc;
      const l: LineaDetalle = {
        ...resto,
        lotes: [..._lotes.values()].sort((a, b) => a.fechaRecepcion.localeCompare(b.fechaRecepcion)),
        iva: redondear2(acc.costoNeto * (acc.ivaPorcentaje / 100)),
        // El precio de góndola incluye IVA: se le saca para poder compararlo
        // contra el costo, que va neto. En merma es 0 y el margen queda en
        // menos el costo entero, que es exactamente lo que se perdió.
        ventaNeta: redondear2(acc.ventaTotal / (1 + acc.ivaPorcentaje / 100)),
        margen: 0,
      };
      l.margen = redondear2(l.ventaNeta - l.costoNeto);
      if (medio === "MERMA") {
        l.motivos = resumirMotivos(mermasPorVariante.get(acc.idVariante) ?? []);
      }
      lineas.push(l);
      acumular(totales, l);
    }

    lineas.sort((a, b) => a.nombreProducto.localeCompare(b.nombreProducto));
    return { medio, lineas, totales };
  });

  const totales = totalesVacios();
  porMedio.forEach((g) => g.lineas.forEach((l) => acumular(totales, l)));

  return { porMedio, totales, estimado };
}

// ===================== EL COMPROBANTE =====================
//
// Lo que se guardó de una liquidación ya cerrada, para poder imprimirlo y
// mostrárselo al proveedor. No recalcula nada: lee el detalle tal como quedó
// congelado al confirmar. Si el costo de un lote se corrigió después, este
// papel sigue diciendo lo que se liquidó ese día — que es el punto de tener
// un comprobante.

export type LineaComprobante = {
  producto: string;
  /** Cuándo entró el lote del que salieron estas unidades. */
  fechaRecepcion: string | null;
  cantidad: number;
  costoUnitario: number;
  subtotal: number;
};

export type LineaMermaComprobante = {
  producto: string;
  motivo: string;
  fecha: string;
  cantidad: number;
  costoUnitario: number;
  subtotal: number;
};

export type ComprobanteLiquidacionProveedor = {
  idLiquidacion: string;
  proveedor: { nombre: string; cuit: string | null; modoFacturacion: string };
  fechaDesde: string;
  fechaHasta: string;
  fecha: string;
  usuario: string | null;
  vendidas: LineaComprobante[];
  mermas: LineaMermaComprobante[];
  /** El costo de la merma sale del subtotal guardado menos lo vendido. */
  netoVendido: number;
  netoMerma: number;
  montoFinal: number;
  facturaNumero: string | null;
  facturaIva: number | null;
};

export async function comprobanteLiquidacionProveedor(
  supabase: SupabaseClient,
  idLiquidacion: string
): Promise<ComprobanteLiquidacionProveedor | null> {
  const { data: liq } = await supabase
    .from("liquidaciones_proveedor")
    .select("*")
    .eq("id_liquidacion", idLiquidacion)
    .maybeSingle();
  if (!liq) return null;

  const [provRes, detalleRes, mermasRes] = await Promise.all([
    supabase
      .from("proveedores")
      .select("nombre, cuit, modo_facturacion")
      .eq("id_proveedor", liq.id_proveedor as string)
      .maybeSingle(),
    supabase
      .from("detalle_liquidacion_proveedor")
      .select("id_variante, id_detalle_recepcion, cantidad_vendida, costo_unitario, subtotal")
      .eq("id_liquidacion", idLiquidacion),
    supabase
      .from("mermas")
      .select("id_variante, cantidad, motivo, fecha, costo_unitario")
      .eq("id_liquidacion_proveedor", idLiquidacion)
      .order("fecha", { ascending: true }),
  ]);

  const detalle = detalleRes.data ?? [];
  const mermas = mermasRes.data ?? [];

  // Nombres de producto para las dos listas.
  const idsVariante = [
    ...new Set([...detalle, ...mermas].map((d) => d.id_variante as string).filter(Boolean)),
  ];
  const { data: variantes } = idsVariante.length
    ? await supabase.from("variantes_producto").select("id_variante, id_producto, nombre").in("id_variante", idsVariante)
    : { data: [] as Record<string, unknown>[] };
  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto as string))];
  const { data: productos } = idsProducto.length
    ? await supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProducto)
    : { data: [] as Record<string, unknown>[] };

  const nombreProducto = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
  const nombreVariante = new Map(
    (variantes ?? []).map((v) => {
      const base = nombreProducto.get(v.id_producto as string) ?? "Producto";
      return [v.id_variante as string, v.nombre !== "Único" ? `${base} — ${v.nombre}` : base];
    })
  );

  // La fecha del lote: es lo que deja decirle al proveedor de qué remito
  // salió cada unidad si discute el costo.
  const idsLote = [
    ...new Set(detalle.map((d) => d.id_detalle_recepcion as string | null).filter((x): x is string => Boolean(x))),
  ];
  const { data: lotes } = idsLote.length
    ? await supabase.from("detalle_recepcion_proveedor").select("id_detalle, id_recepcion").in("id_detalle", idsLote)
    : { data: [] as Record<string, unknown>[] };
  const idsRecepcion = [...new Set((lotes ?? []).map((l) => l.id_recepcion as string))];
  const { data: recepciones } = idsRecepcion.length
    ? await supabase.from("recepciones_proveedor").select("id_recepcion, fecha").in("id_recepcion", idsRecepcion)
    : { data: [] as Record<string, unknown>[] };
  const fechaRecepcion = new Map((recepciones ?? []).map((r) => [r.id_recepcion as string, r.fecha as string]));
  const fechaDeLote = new Map(
    (lotes ?? []).map((l) => [l.id_detalle as string, fechaRecepcion.get(l.id_recepcion as string) ?? null])
  );

  const vendidas: LineaComprobante[] = detalle
    .map((d) => ({
      producto: nombreVariante.get(d.id_variante as string) ?? "Producto",
      fechaRecepcion: d.id_detalle_recepcion ? fechaDeLote.get(d.id_detalle_recepcion as string) ?? null : null,
      cantidad: (d.cantidad_vendida as number) ?? 0,
      costoUnitario: (d.costo_unitario as number) ?? 0,
      subtotal: (d.subtotal as number) ?? 0,
    }))
    .sort((a, b) => a.producto.localeCompare(b.producto) || (a.fechaRecepcion ?? "").localeCompare(b.fechaRecepcion ?? ""));

  const lineasMerma: LineaMermaComprobante[] = mermas.map((m) => {
    const cantidad = (m.cantidad as number) ?? 0;
    // El costo quedó congelado cuando se registró la merma — es el mismo
    // número que la pantalla mostró antes de confirmarla. Guardarlo ahí y no
    // recalcularlo acá es lo que hace que el papel y lo que se dijo en el
    // momento digan siempre lo mismo.
    const costoUnitario = (m.costo_unitario as number | null) ?? 0;
    return {
      producto: nombreVariante.get(m.id_variante as string) ?? "Producto",
      motivo: (m.motivo as string) ?? "OTRO",
      fecha: m.fecha as string,
      cantidad,
      costoUnitario,
      subtotal: redondear2(cantidad * costoUnitario),
    };
  });

  // El detalle guardado suma vendido + merma en un renglón por lote: al
  // liquidar, las unidades de merma se sumaron a las vendidas para consumir
  // el FIFO una sola vez. Acá se vuelve a partir restando la merma, que sí
  // tiene su costo propio guardado.
  const totalGuardado = detalle.reduce((a, d) => a + ((d.subtotal as number) ?? 0), 0);
  const netoMerma = redondear2(lineasMerma.reduce((a, m) => a + m.subtotal, 0));
  const netoVendido = redondear2(totalGuardado - netoMerma);

  return {
    idLiquidacion,
    proveedor: {
      nombre: (provRes.data?.nombre as string) ?? "Proveedor",
      cuit: (provRes.data?.cuit as string | null) ?? null,
      modoFacturacion: (provRes.data?.modo_facturacion as string) ?? "",
    },
    fechaDesde: liq.fecha_desde as string,
    fechaHasta: liq.fecha_hasta as string,
    fecha: (liq.fecha as string) ?? "",
    usuario: (liq.usuario as string | null) ?? null,
    vendidas,
    mermas: lineasMerma,
    netoVendido,
    netoMerma,
    montoFinal: (liq.monto_final as number) ?? 0,
    facturaNumero: (liq.factura_numero as string | null) ?? null,
    facturaIva: (liq.factura_iva as number | null) ?? null,
  };
}

export async function generarLiquidacionProveedor(
  supabase: SupabaseClient,
  params: {
    idProveedor: string;
    fechaDesde: string;
    fechaHasta: string;
    montoFinal: number;
    usuario: string | null;
    observaciones: string | null;
  }
): Promise<string> {
  // Se recalcula fresco (no se reusa lo que se mostró en el preview) porque
  // puede haber pasado tiempo entre calcular y confirmar, y en el medio
  // pudo haberse cargado otra venta o devolución que cambie qué lotes están
  // disponibles.
  const fresco = await calcularLiquidacionProveedor(supabase, params.idProveedor, params.fechaDesde, params.fechaHasta);
  const montoCalculado = fresco.lineas.reduce((acc, l) => acc + l.subtotal, 0);

  const { data: liquidacion, error } = await supabase
    .from("liquidaciones_proveedor")
    .insert({
      id_proveedor: params.idProveedor,
      fecha_desde: params.fechaDesde,
      fecha_hasta: params.fechaHasta,
      monto_calculado: montoCalculado,
      monto_final: params.montoFinal,
      estado: "GENERADA",
      observaciones: params.observaciones,
      usuario: params.usuario,
    })
    .select("id_liquidacion")
    .single();
  if (error) throw new Error(error.message);

  // Un renglón por cada lote consumido (no uno por producto) para poder ver
  // después de qué remito salió cada parte de la plata liquidada.
  for (const linea of fresco.lineas) {
    for (const lote of linea.lotes) {
      const { error: errorDetalle } = await supabase.from("detalle_liquidacion_proveedor").insert({
        id_liquidacion: liquidacion.id_liquidacion,
        id_variante: linea.idVariante,
        id_detalle_recepcion: lote.idDetalleRecepcion === "ESTIMADO" ? null : lote.idDetalleRecepcion,
        cantidad_vendida: lote.cantidad,
        costo_unitario: lote.costoUnitario,
        subtotal: Math.round(lote.cantidad * lote.costoUnitario),
      });
      if (errorDetalle) throw new Error(errorDetalle.message);
    }
    // Recién acá, al confirmar, se descuenta de verdad el saldo disponible
    // de cada lote — es lo que hace que lo no vendido quede para el mes
    // que viene en vez de perderse.
    await aplicarConsumoLotes(supabase, linea.lotes);
  }

  // Marcar por línea las ventas ya cubiertas por esta liquidación, para no
  // volver a contarlas el mes que viene.
  const varianteIds = fresco.lineas.map((l) => l.idVariante);
  if (varianteIds.length > 0) {
    const { data: ventasDelPeriodo } = await supabase
      .from("ventas")
      .select("id_venta")
      .eq("estado", "PAGADA")
      .gte("fecha", `${params.fechaDesde}T00:00:00`)
      .lte("fecha", `${params.fechaHasta}T23:59:59`);
    const idsVenta = (ventasDelPeriodo ?? []).map((v) => v.id_venta as string);
    if (idsVenta.length > 0) {
      await supabase
        .from("detalle_ventas")
        .update({ id_liquidacion_proveedor: liquidacion.id_liquidacion })
        .in("id_venta", idsVenta)
        .in("id_variante", varianteIds)
        .is("id_liquidacion_proveedor", null);
    }

    // Lo mismo con la merma. Sin esto, la mercadería rota se le pagaría a
    // Alifrut todos los meses hasta el fin de los tiempos.
    await supabase
      .from("mermas")
      .update({ id_liquidacion_proveedor: liquidacion.id_liquidacion })
      .in("id_variante", varianteIds)
      .is("id_liquidacion_proveedor", null)
      .gte("fecha", `${params.fechaDesde}T00:00:00`)
      .lte("fecha", `${params.fechaHasta}T23:59:59`);
  }

  return liquidacion.id_liquidacion as string;
}
