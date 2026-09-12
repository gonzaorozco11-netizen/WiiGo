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

export type MedioLiquidacion = "ELECTRONICO" | "EFECTIVO";

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
  if (idsVenta.length === 0) return { lineas: [], total: 0 };

  const { data: detalle } = await supabase
    .from("detalle_ventas")
    .select("id_variante, cantidad")
    .in("id_venta", idsVenta)
    .in("id_variante", varianteIds)
    .is("id_liquidacion_proveedor", null);

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
  if (!ventas || ventas.length === 0) return vacio;
  const ventaPorId = new Map(ventas.map((v) => [v.id_venta as string, v]));

  const { data: detalle } = await supabase
    .from("detalle_ventas")
    .select("id_venta, id_variante, cantidad, precio_unitario, subtotal")
    .in("id_venta", [...ventaPorId.keys()])
    .in("id_variante", [...variantePorId.keys()])
    .is("id_liquidacion_proveedor", null);
  if (!detalle || detalle.length === 0) return vacio;

  // Mismo orden que las ventas, para que el FIFO sea el real.
  const ordenVenta = new Map([...ventaPorId.keys()].map((id, i) => [id, i]));
  const lineasOrdenadas = detalle
    .slice()
    .sort((a, b) => (ordenVenta.get(a.id_venta as string) ?? 0) - (ordenVenta.get(b.id_venta as string) ?? 0));

  // Los lotes se cargan una vez por variante y se van gastando en memoria.
  const lotesPorVariante = new Map<string, Awaited<ReturnType<typeof lotesDeVariante>>>();
  for (const idVariante of new Set(lineasOrdenadas.map((d) => d.id_variante as string))) {
    lotesPorVariante.set(idVariante, await lotesDeVariante(supabase, idProveedor, idVariante));
  }

  // Clave: medio + variante. Adentro se acumulan los lotes por recepción.
  const acumulado = new Map<string, LineaDetalle & { _lotes: Map<string, LoteDeLinea> }>();
  let estimado = false;

  for (const d of lineasOrdenadas) {
    const cantidad = (d.cantidad as number) ?? 0;
    if (cantidad <= 0) continue;

    const idVariante = d.id_variante as string;
    const v = variantePorId.get(idVariante);
    const p = v ? productoPorId.get(v.id_producto as string) : undefined;
    if (!v || !p) continue;

    const medio: MedioLiquidacion =
      ventaPorId.get(d.id_venta as string)?.medio_pago === "EFECTIVO" ? "EFECTIVO" : "ELECTRONICO";

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
    // — el que importa para el margen.
    const subtotalVenta = (d.subtotal as number | null) ?? (d.precio_unitario as number) * cantidad;
    linea.cantidad += cantidad;
    linea.ventaTotal = redondear2(linea.ventaTotal + subtotalVenta);
    linea.precioVenta = redondear2(linea.ventaTotal / linea.cantidad);

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

  const porMedio = (["ELECTRONICO", "EFECTIVO"] as MedioLiquidacion[]).map((medio) => {
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
        // contra el costo, que va neto.
        ventaNeta: redondear2(acc.ventaTotal / (1 + acc.ivaPorcentaje / 100)),
        margen: 0,
      };
      l.margen = redondear2(l.ventaNeta - l.costoNeto);
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
  }

  return liquidacion.id_liquidacion as string;
}
