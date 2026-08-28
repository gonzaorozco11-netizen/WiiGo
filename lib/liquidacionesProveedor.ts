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
import { simularConsumoFifo, aplicarConsumoLotes, type ConsumoLote } from "./fifoProveedor";

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
