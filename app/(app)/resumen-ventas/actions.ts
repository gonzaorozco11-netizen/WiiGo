"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";

// 2 decimales, no pesos enteros — si se redondea a entero en cada producto,
// la suma de muchos productos puede terminar desviada del total real.
function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

export type LineaResumenVentas = {
  idProducto: string;
  nombreProducto: string;
  tipoComercializacion: string; // PROPIA / CONSIGNACION
  marca: string;
  cantidadVendida: number;
  totalFacturado: number;
  costo: number;
  margen: number;
  margenPorcentaje: number;
};

// Resumen de TODO lo vendido en un rango de fechas, agrupado por producto —
// mezcla marca propia, proveedores y marcas en consignación, sin importar
// canal (POS/Self Checkout) ni local.
//
// El margen se calcula distinto según el tipo de marca, porque son negocios
// distintos: en marca propia (y proveedores como Alifrut, que usan el mismo
// tipo "PROPIA") WiiGo compró esa mercadería, así que el margen real es
// venta − costo. En consignación WiiGo nunca compró el producto — la
// mercadería es de la marca — así que no hay "costo" que restarle; lo que
// WiiGo gana ahí es el royalty, y eso es lo que se muestra como margen.
// Tope de seguridad: con rangos de fechas razonables (día/semana/mes) nunca
// se acerca a esto — es para no mandar una lista gigante de ids en el
// siguiente query si alguien elige un rango enorme.
const LIMITE_VENTAS = 3000;

export async function calcularResumenVentas(
  desde: string,
  hasta: string
): Promise<{ lineas: LineaResumenVentas[]; totalFacturado: number; totalMargen: number; posibleTruncado: boolean }> {
  const supabase = getSupabaseServerClient();

  const { data: ventas, error: errorVentas } = await supabase
    .from("ventas")
    .select("id_venta")
    .eq("estado", "PAGADA")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`)
    .order("fecha", { ascending: false })
    .limit(LIMITE_VENTAS);
  if (errorVentas) throw new Error(friendlyDbError(errorVentas));
  const idsVenta = (ventas ?? []).map((v) => v.id_venta as string);
  const posibleTruncado = idsVenta.length === LIMITE_VENTAS;
  if (idsVenta.length === 0) return { lineas: [], totalFacturado: 0, totalMargen: 0, posibleTruncado: false };

  const { data: detalle, error: errorDetalle } = await supabase
    .from("detalle_ventas")
    .select("id_variante, cantidad, subtotal")
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
    .select("id_producto, nombre, costo_informado, id_marca")
    .in("id_producto", idsProducto.length > 0 ? idsProducto : ["00000000-0000-0000-0000-000000000000"]);
  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto as string, p]));

  const idsMarca = [...new Set((productos ?? []).map((p) => p.id_marca as string).filter(Boolean))];
  const { data: marcas } = await supabase
    .from("marcas")
    .select("id_marca, nombre, tipo_comercializacion, royalty_porcentaje")
    .in("id_marca", idsMarca.length > 0 ? idsMarca : ["00000000-0000-0000-0000-000000000000"]);
  const marcaPorId = new Map((marcas ?? []).map((m) => [m.id_marca as string, m]));

  const acumPorProducto = new Map<string, { cantidad: number; total: number }>();
  for (const d of detalle) {
    const idProducto = productoPorVariante.get(d.id_variante as string);
    if (!idProducto) continue;
    const actual = acumPorProducto.get(idProducto) ?? { cantidad: 0, total: 0 };
    actual.cantidad += (d.cantidad as number) ?? 0;
    actual.total += (d.subtotal as number) ?? 0;
    acumPorProducto.set(idProducto, actual);
  }

  const lineas: LineaResumenVentas[] = [];
  for (const [idProducto, acum] of acumPorProducto) {
    if (acum.cantidad <= 0) continue;
    const producto = productoPorId.get(idProducto);
    const marca = producto?.id_marca ? marcaPorId.get(producto.id_marca as string) : undefined;
    const tipo = marca?.tipo_comercializacion ?? "PROPIA";

    let costo = 0;
    let margen = 0;
    if (tipo === "CONSIGNACION") {
      // No hay costo para WiiGo — el "margen" acá es lo que WiiGo cobra de
      // royalty por esta venta, que es la ganancia real del negocio.
      margen = redondear2(acum.total * ((marca?.royalty_porcentaje ?? 0) / 100));
    } else {
      costo = redondear2((producto?.costo_informado ?? 0) * acum.cantidad);
      margen = redondear2(acum.total - costo);
    }

    lineas.push({
      idProducto,
      nombreProducto: producto?.nombre ?? "Producto",
      tipoComercializacion: tipo,
      marca: marca?.nombre ?? "—",
      cantidadVendida: acum.cantidad,
      totalFacturado: redondear2(acum.total),
      costo,
      margen,
      margenPorcentaje: acum.total > 0 ? (margen / acum.total) * 100 : 0,
    });
  }

  lineas.sort((a, b) => b.totalFacturado - a.totalFacturado);

  const totalFacturado = redondear2(lineas.reduce((acc, l) => acc + l.totalFacturado, 0));
  const totalMargen = redondear2(lineas.reduce((acc, l) => acc + l.margen, 0));

  return { lineas, totalFacturado, totalMargen, posibleTruncado };
}
