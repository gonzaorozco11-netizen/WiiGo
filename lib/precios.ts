// El precio de un producto, en un solo lugar.
//
// Hasta ahora esta cuenta estaba copiada en PosApp, SelfCheckoutApp y
// AsesorApp. Mientras fue una línea no molestó; con dos precios por medio de
// pago, tres copias son tres formas de cobrar distinto por lo mismo.
//
// Hay dos precios y son los dos "el precio", no uno con descuento:
//
//   precio_venta     lo que se cobra con tarjeta o Mercado Pago
//   precio_efectivo  lo que se cobra pagando en efectivo
//
// Y aparte está `descuento_porcentaje`, que SÍ es una oferta: es lo que pinta
// el cartelito "-20%" en el catálogo.
//
// Los descuentos NO se suman. La oferta se aplica sobre el precio de lista, y
// el que paga en efectivo se lleva el más barato de los dos resultados:
//
//   Agua sin gas — lista $3.000, efectivo $2.700 (10% menos)
//     sin oferta    tarjeta $3.000   efectivo $2.700   (gana el de efectivo)
//     oferta 5%     tarjeta $2.850   efectivo $2.700   (gana el de efectivo)
//     oferta 20%    tarjeta $2.400   efectivo $2.400   (gana el de oferta)
//
// Se decidió así por dos motivos. Si se sumaran, una oferta del 20% sobre una
// marca con 14% de efectivo terminaría siendo un 31% que nadie aprobó — y de
// ese descuento el 95% lo pone la marca, porque la liquidación se calcula
// sobre lo que se vendió de verdad. Y al revés, aplicar la oferta solo al
// precio de tarjeta dejaría al efectivo MÁS CARO apenas la oferta supere el
// porcentaje de efectivo, que es justo lo contrario de lo que se busca.
//
// La contra, asumida: en un producto con oferta fuerte el efectivo deja de
// tener ventaja. No sale más caro, sale igual.

export type MedioDePago = "EFECTIVO" | "OTRO";

type ConPrecio = {
  precio_venta: number | null;
  precio_efectivo?: number | null;
};

/**
 * El precio base, antes de la oferta.
 *
 * La variante pisa al producto, y el efectivo pisa al de lista. Si una
 * variante tiene precio propio pero no precio de efectivo, en efectivo se
 * cobra el suyo de lista — no el del producto, que sería de otro sabor.
 */
function base(producto: ConPrecio, variante: ConPrecio | null, medio: MedioDePago): number {
  const fuente = variante && (variante.precio_venta != null || variante.precio_efectivo != null) ? variante : producto;
  if (medio === "EFECTIVO" && fuente.precio_efectivo != null) return fuente.precio_efectivo;
  return fuente.precio_venta ?? 0;
}

export function precioDe(
  producto: ConPrecio & { descuento_porcentaje?: number | null },
  variante: ConPrecio | null,
  medio: MedioDePago
): number {
  const lista = base(producto, variante, "OTRO");
  const descuento = producto.descuento_porcentaje ?? 0;
  const conOferta = descuento > 0 ? Math.round(lista * (1 - descuento / 100)) : lista;
  if (medio !== "EFECTIVO") return conOferta;

  // El de efectivo se lleva el mejor de los dos. Si el producto no tiene precio
  // de efectivo cargado, `base` devuelve el de lista y queda el de la oferta:
  // así un producto sin precio de efectivo igual respeta la promoción.
  const efectivo = base(producto, variante, "EFECTIVO");
  return Math.min(efectivo, conOferta);
}

/**
 * Los dos precios juntos, para mostrarlos antes de que el cliente elija cómo
 * paga. `ahorro` es null cuando no hay precio de efectivo cargado: ahí se
 * cobra lo mismo en los dos casos y mostrar "ahorrás $0" sería ruido.
 */
export function ambosPrecios(
  producto: ConPrecio & { descuento_porcentaje?: number | null },
  variante: ConPrecio | null
): { lista: number; efectivo: number; ahorro: number | null } {
  const lista = precioDe(producto, variante, "OTRO");
  const efectivo = precioDe(producto, variante, "EFECTIVO");
  return { lista, efectivo, ahorro: efectivo < lista ? lista - efectivo : null };
}
