import type { SupabaseClient } from "@supabase/supabase-js";

// Motor de devoluciones — total y parcial, un solo camino.
//
// La anulación completa de una venta es, acá adentro, una devolución que
// cubre todas las líneas. No hay dos mecanismos: si los hubiera, uno haría
// tarde o temprano algo que el otro no (reponer el stock, emitir la nota,
// descontarle a la marca), y la diferencia aparecería el día menos pensado.
//
// Este archivo tiene solo las cuentas y las validaciones. Lo que toca ARCA,
// Mercado Pago y la cuenta corriente de las marcas vive en ventas/actions.ts,
// que es quien orquesta.

export type DestinoMercaderia = "VUELVE" | "NO_VUELVE";

/** Una línea de la venta con lo que ya se devolvió antes. */
export type LineaDevolvible = {
  idDetalle: string;
  idVariante: string;
  idMarca: string | null;
  producto: string;
  cantidadVendida: number;
  cantidadYaDevuelta: number;
  /** Lo que todavía se puede devolver. */
  disponible: number;
  precioUnitario: number;
};

export type PedidoDevolucion = { idDetalle: string; cantidad: number };

/**
 * Qué se puede devolver de una venta.
 *
 * El tope es por línea y descuenta lo ya devuelto: un cliente que devolvió 1
 * de 3 la semana pasada solo puede devolver 2 hoy. Sin esto, dos devoluciones
 * parciales podrían sumar más que la venta.
 */
export async function lineasDevolvibles(
  supabase: SupabaseClient,
  idVenta: string
): Promise<LineaDevolvible[]> {
  const { data: detalle } = await supabase
    .from("detalle_ventas")
    .select("id_detalle, id_variante, id_marca, cantidad, precio_unitario, subtotal")
    .eq("id_venta", idVenta);
  if (!detalle || detalle.length === 0) return [];

  const ids = detalle.map((d) => d.id_detalle as string);
  const { data: devueltas } = await supabase
    .from("detalle_devoluciones")
    .select("id_detalle, cantidad")
    .in("id_detalle", ids);

  const yaDevuelto = new Map<string, number>();
  (devueltas ?? []).forEach((d) => {
    const k = d.id_detalle as string;
    yaDevuelto.set(k, (yaDevuelto.get(k) ?? 0) + ((d.cantidad as number) ?? 0));
  });

  const idsVariante = [...new Set(detalle.map((d) => d.id_variante as string))];
  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_variante", idsVariante);
  const varPorId = new Map((variantes ?? []).map((v) => [v.id_variante as string, v]));
  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto as string))];
  const { data: productos } = idsProducto.length
    ? await supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProducto)
    : { data: [] };
  const prodPorId = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));

  return detalle.map((d) => {
    const v = varPorId.get(d.id_variante as string);
    const nombreProd = v ? prodPorId.get(v.id_producto as string) ?? "Producto" : "Producto";
    const nombreVar = v && v.nombre !== "Único" ? ` — ${v.nombre}` : "";
    const cantidad = (d.cantidad as number) ?? 0;
    const devuelta = yaDevuelto.get(d.id_detalle as string) ?? 0;
    // El precio se saca del subtotal cuando está: si la línea tuvo un
    // descuento propio, el unitario suelto mentiría.
    const subtotal = (d.subtotal as number | null) ?? null;
    const unitario =
      subtotal !== null && cantidad > 0 ? subtotal / cantidad : (d.precio_unitario as number) ?? 0;

    return {
      idDetalle: d.id_detalle as string,
      idVariante: d.id_variante as string,
      idMarca: (d.id_marca as string | null) ?? null,
      producto: `${nombreProd}${nombreVar}`,
      cantidadVendida: cantidad,
      cantidadYaDevuelta: devuelta,
      disponible: Math.max(cantidad - devuelta, 0),
      precioUnitario: Math.round(unitario * 100) / 100,
    };
  });
}

export type DevolucionCalculada = {
  /** Renglones a devolver, ya validados contra lo disponible. */
  renglones: {
    idDetalle: string;
    idVariante: string;
    idMarca: string | null;
    producto: string;
    cantidad: number;
    precioUnitario: number;
    subtotal: number;
  }[];
  total: number;
  unidades: number;
  /** true si con esta devolución no queda nada más por devolver. */
  esTotal: boolean;
  error: string | null;
};

/**
 * Valida el pedido contra lo que realmente se puede devolver y saca los
 * totales. Todo lo que decide "esto se puede o no" está acá y en ningún otro
 * lado, así la pantalla y el servidor no pueden discrepar.
 */
export function calcularDevolucion(
  lineas: LineaDevolvible[],
  pedido: PedidoDevolucion[]
): DevolucionCalculada {
  const vacio: DevolucionCalculada = { renglones: [], total: 0, unidades: 0, esTotal: false, error: null };
  const porId = new Map(lineas.map((l) => [l.idDetalle, l]));
  const renglones: DevolucionCalculada["renglones"] = [];

  for (const p of pedido) {
    if (p.cantidad <= 0) continue;
    const linea = porId.get(p.idDetalle);
    if (!linea) return { ...vacio, error: "Uno de los productos no pertenece a esta venta." };
    if (!Number.isInteger(p.cantidad)) {
      return { ...vacio, error: "Las cantidades tienen que ser números enteros." };
    }
    if (p.cantidad > linea.disponible) {
      return {
        ...vacio,
        error:
          linea.disponible === 0
            ? `${linea.producto} ya se devolvió entero.`
            : `De ${linea.producto} quedan ${linea.disponible} por devolver, no ${p.cantidad}.`,
      };
    }
    renglones.push({
      idDetalle: linea.idDetalle,
      idVariante: linea.idVariante,
      idMarca: linea.idMarca,
      producto: linea.producto,
      cantidad: p.cantidad,
      precioUnitario: linea.precioUnitario,
      subtotal: Math.round(linea.precioUnitario * p.cantidad * 100) / 100,
    });
  }

  if (renglones.length === 0) {
    return { ...vacio, error: "Elegí al menos un producto para devolver." };
  }

  const total = Math.round(renglones.reduce((a, r) => a + r.subtotal, 0) * 100) / 100;
  const unidades = renglones.reduce((a, r) => a + r.cantidad, 0);

  // Total = después de esta devolución no queda nada por devolver en ninguna
  // línea. Es lo que decide si la venta pasa a ANULADA o queda parcial.
  const pedidoPorId = new Map(renglones.map((r) => [r.idDetalle, r.cantidad]));
  const esTotal = lineas.every((l) => l.disponible - (pedidoPorId.get(l.idDetalle) ?? 0) === 0);

  return { renglones, total, unidades, esTotal, error: null };
}

/**
 * Cuántos puntos hay que revertir.
 *
 * Proporcional a lo devuelto sobre el total de la venta. El saldo del cliente
 * nunca queda en negativo: si ya gastó los puntos que ganó con esta compra,
 * se queda en cero y no se le persigue la diferencia. Es plata chica, y
 * discutir puntos con alguien que está devolviendo algo no vale la pena.
 */
export function puntosARevertir(params: {
  puntosGenerados: number;
  puntosCanjeados: number;
  totalVenta: number;
  totalDevuelto: number;
  saldoActual: number;
}): number {
  if (params.totalVenta <= 0) return params.saldoActual;
  const proporcion = Math.min(params.totalDevuelto / params.totalVenta, 1);
  const generados = Math.round(params.puntosGenerados * proporcion);
  const canjeados = Math.round(params.puntosCanjeados * proporcion);
  return Math.max(params.saldoActual + canjeados - generados, 0);
}
