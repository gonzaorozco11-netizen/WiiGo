"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";

// 2 decimales, no pesos enteros — si se redondea a entero en cada línea, la
// suma de muchas líneas puede terminar desviada del total real.
function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

export type LineaResumenVentas = {
  idVenta: string;
  numeroVenta: number;
  fecha: string;
  medioPago: string | null;
  cantidadItems: number;
  totalFacturado: number;
  costo: number;
  margen: number;
  margenPorcentaje: number;
};

// Resumen de TODO lo vendido en un rango de fechas, una fila por venta —
// mezcla marca propia, proveedores y marcas en consignación, sin importar
// canal (POS/Self Checkout) ni local.
//
// El margen se calcula distinto según el tipo de marca de cada línea dentro
// de la venta, porque son negocios distintos: en marca propia (y
// proveedores como Alifrut, que usan el mismo tipo "PROPIA") WiiGo compró
// esa mercadería, así que el margen real es venta − costo. En consignación
// WiiGo nunca compró el producto — la mercadería es de la marca — así que
// no hay "costo" que restarle; lo que WiiGo gana ahí es el royalty, y eso
// es lo que se suma como margen. Un mismo carrito puede mezclar líneas de
// los dos tipos — el margen de la venta es la suma de cada línea calculada
// con su propia regla.
const LIMITE_VENTAS = 3000;

export async function calcularResumenVentas(
  desde: string,
  hasta: string
): Promise<{ lineas: LineaResumenVentas[]; totalFacturado: number; totalMargen: number; posibleTruncado: boolean }> {
  const supabase = getSupabaseServerClient();

  const { data: ventas, error: errorVentas } = await supabase
    .from("ventas")
    .select("id_venta, numero, fecha, medio_pago")
    .eq("estado", "PAGADA")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`)
    .order("fecha", { ascending: false })
    .limit(LIMITE_VENTAS);
  if (errorVentas) throw new Error(friendlyDbError(errorVentas));
  const posibleTruncado = (ventas ?? []).length === LIMITE_VENTAS;
  if (!ventas || ventas.length === 0) return { lineas: [], totalFacturado: 0, totalMargen: 0, posibleTruncado: false };
  const ventaPorId = new Map(ventas.map((v) => [v.id_venta as string, v]));
  const idsVenta = ventas.map((v) => v.id_venta as string);

  const { data: detalle, error: errorDetalle } = await supabase
    .from("detalle_ventas")
    .select("id_venta, id_variante, cantidad, subtotal")
    .in("id_venta", idsVenta);
  if (errorDetalle) throw new Error(friendlyDbError(errorDetalle));
  if (!detalle || detalle.length === 0) return { lineas: [], totalFacturado: 0, totalMargen: 0, posibleTruncado };

  const idsVariante = [...new Set(detalle.map((d) => d.id_variante as string))];
  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto")
    .in("id_variante", idsVariante);
  const productoPorVariante = new Map((variantes ?? []).map((v) => [v.id_variante as string, v.id_producto as string]));

  const idsProducto = [...new Set([...productoPorVariante.values()])];
  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, costo_informado, id_marca")
    .in("id_producto", idsProducto.length > 0 ? idsProducto : ["00000000-0000-0000-0000-000000000000"]);
  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto as string, p]));

  const idsMarca = [...new Set((productos ?? []).map((p) => p.id_marca as string).filter(Boolean))];
  const { data: marcas } = await supabase
    .from("marcas")
    .select("id_marca, tipo_comercializacion, royalty_porcentaje")
    .in("id_marca", idsMarca.length > 0 ? idsMarca : ["00000000-0000-0000-0000-000000000000"]);
  const marcaPorId = new Map((marcas ?? []).map((m) => [m.id_marca as string, m]));

  const acumPorVenta = new Map<string, { items: number; total: number; costo: number; margen: number }>();
  for (const d of detalle) {
    const idVenta = d.id_venta as string;
    const idProducto = productoPorVariante.get(d.id_variante as string);
    const producto = idProducto ? productoPorId.get(idProducto) : undefined;
    const marca = producto?.id_marca ? marcaPorId.get(producto.id_marca as string) : undefined;
    const tipo = marca?.tipo_comercializacion ?? "PROPIA";
    const subtotalLinea = (d.subtotal as number) ?? 0;
    const cantidadLinea = (d.cantidad as number) ?? 0;

    let costoLinea = 0;
    let margenLinea = 0;
    if (tipo === "CONSIGNACION") {
      margenLinea = redondear2(subtotalLinea * ((marca?.royalty_porcentaje ?? 0) / 100));
    } else {
      costoLinea = redondear2((producto?.costo_informado ?? 0) * cantidadLinea);
      margenLinea = redondear2(subtotalLinea - costoLinea);
    }

    const actual = acumPorVenta.get(idVenta) ?? { items: 0, total: 0, costo: 0, margen: 0 };
    actual.items += cantidadLinea;
    actual.total += subtotalLinea;
    actual.costo += costoLinea;
    actual.margen += margenLinea;
    acumPorVenta.set(idVenta, actual);
  }

  const lineas: LineaResumenVentas[] = [];
  for (const [idVenta, acum] of acumPorVenta) {
    const venta = ventaPorId.get(idVenta);
    if (!venta) continue;
    const totalFacturado = redondear2(acum.total);
    const margen = redondear2(acum.margen);
    lineas.push({
      idVenta,
      numeroVenta: venta.numero as number,
      fecha: venta.fecha as string,
      medioPago: venta.medio_pago as string | null,
      cantidadItems: acum.items,
      totalFacturado,
      costo: redondear2(acum.costo),
      margen,
      margenPorcentaje: totalFacturado > 0 ? (margen / totalFacturado) * 100 : 0,
    });
  }

  lineas.sort((a, b) => b.fecha.localeCompare(a.fecha));

  const totalFacturado = redondear2(lineas.reduce((acc, l) => acc + l.totalFacturado, 0));
  const totalMargen = redondear2(lineas.reduce((acc, l) => acc + l.margen, 0));

  return { lineas, totalFacturado, totalMargen, posibleTruncado };
}
