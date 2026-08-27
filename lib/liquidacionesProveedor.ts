// Liquidación por venta (modo LIQUIDACION_VENTA en proveedores, caso
// Alifrut): se le paga el costo de lo vendido en el período, nunca de lo
// entregado — mucho más simple que lib/cuentaComercialMarca.ts o el módulo
// Liquidaciones de marcas: sin royalty, sin comisión de Mercado Pago
// trasladada, sin SIRCREB. WiiGo se queda con todo el margen entre el
// precio de venta y este costo.
import type { SupabaseClient } from "@supabase/supabase-js";

export type LineaLiquidacionProveedor = {
  idVariante: string;
  nombreProducto: string;
  cantidadVendida: number;
  costoUnitario: number;
  subtotal: number;
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
  const costoPorVariante = new Map<string, number>();
  for (const v of variantes ?? []) {
    const producto = productoPorId.get(v.id_producto as string);
    const nombreBase = producto?.nombre ?? "Producto";
    nombrePorVariante.set(v.id_variante as string, v.nombre !== "Único" ? `${nombreBase} — ${v.nombre}` : nombreBase);
    costoPorVariante.set(v.id_variante as string, (producto?.costo_informado as number | null) ?? 0);
  }

  const cantidadPorVariante = new Map<string, number>();
  for (const d of detalle ?? []) {
    cantidadPorVariante.set(d.id_variante, (cantidadPorVariante.get(d.id_variante) ?? 0) + (d.cantidad ?? 0));
  }

  const lineas: LineaLiquidacionProveedor[] = [];
  let total = 0;
  for (const [idVariante, cantidad] of cantidadPorVariante) {
    if (cantidad <= 0) continue;
    const costoUnitario = costoPorVariante.get(idVariante) ?? 0;
    const subtotal = Math.round(cantidad * costoUnitario);
    lineas.push({ idVariante, nombreProducto: nombrePorVariante.get(idVariante) ?? "Producto", cantidadVendida: cantidad, costoUnitario, subtotal });
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
    lineas: LineaLiquidacionProveedor[];
    usuario: string | null;
    observaciones: string | null;
  }
): Promise<string> {
  const montoCalculado = params.lineas.reduce((acc, l) => acc + l.subtotal, 0);

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

  if (params.lineas.length > 0) {
    const { error: errorDetalle } = await supabase.from("detalle_liquidacion_proveedor").insert(
      params.lineas.map((l) => ({
        id_liquidacion: liquidacion.id_liquidacion,
        id_variante: l.idVariante,
        cantidad_vendida: l.cantidadVendida,
        costo_unitario: l.costoUnitario,
        subtotal: l.subtotal,
      }))
    );
    if (errorDetalle) throw new Error(errorDetalle.message);
  }

  // Marcar por línea las ventas ya cubiertas por esta liquidación, para no
  // volver a contarlas el mes que viene — se vuelve a buscar en vez de
  // reusar las líneas de arriba porque puede haber pasado tiempo entre
  // calcular y confirmar.
  const varianteIds = params.lineas.map((l) => l.idVariante);
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
