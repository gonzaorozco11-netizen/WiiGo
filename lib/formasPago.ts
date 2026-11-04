// Cómo pagó el cliente, en un solo lugar (2026-11-04).
//
// Cada venta guarda DÓNDE pagó (`ventas.medio_pago`: EFECTIVO, MERCADO_PAGO o
// POSNET) y CON QUÉ (`pagos.forma_pago_cliente`). Con las dos cosas la
// liquidación le descuenta a la marca el costo exacto de ese cobro: no es lo
// mismo débito por QR que débito en el posnet.
//
// - Mercado Pago (QR de la caja y del totem): la forma la informa Mercado
//   Pago solo (ver mapearFormaPagoMp en lib/mercadopago.ts).
// - Posnet (hoy Nave, de Galicia): no está conectado al sistema. La cajera
//   elige débito o crédito, y se guarda como POSNET_DEBITO / POSNET_CREDITO
//   para que no se confunda con el débito del QR.
//
// Las tasas se cargan en Configuración, sin IVA (como las muestran Mercado
// Pago y Nave). El IVA se suma al calcular.
//
// Sin imports de servidor: lo usan también pantallas de cliente.

export type MedioPagoVenta = "EFECTIVO" | "MERCADO_PAGO" | "POSNET";
export type TarjetaPosnet = "DEBITO" | "CREDITO";

/** forma_pago_cliente → el parámetro de Configuración con su comisión. */
export const CLAVE_COMISION_COBRO: Record<string, string> = {
  DINERO_CUENTA: "MP_COMISION_DINERO_CUENTA",
  DEBITO: "MP_COMISION_DEBITO",
  CUOTAS_SIN_INTERES: "MP_COMISION_CUOTAS_SIN_INTERES",
  PREPAGA: "MP_COMISION_PREPAGA",
  CREDITO: "MP_COMISION_CREDITO",
  POSNET_DEBITO: "POSNET_COMISION_DEBITO",
  POSNET_CREDITO: "POSNET_COMISION_CREDITO",
};

/** Las tasas del posnet si todavía no se cargaron: las de Nave (Galicia) del 2026-11-04. */
export const POSNET_POR_DEFECTO = { debito: 0.8, credito: 1.8 };

export function formaPagoPosnet(tarjeta: TarjetaPosnet): string {
  return tarjeta === "CREDITO" ? "POSNET_CREDITO" : "POSNET_DEBITO";
}

/**
 * La plata entra a una cuenta (Mercado Pago o el banco del posnet): hay
 * comisión de cobro, retenciones e impuesto a los créditos. El efectivo no.
 */
export function entraPorCuenta(medio: string | null | undefined): boolean {
  return medio === "MERCADO_PAGO" || medio === "POSNET";
}

const FORMA_CORTA: Record<string, string> = {
  DINERO_CUENTA: "Dinero en cuenta",
  DEBITO: "Débito",
  CUOTAS_SIN_INTERES: "Cuotas sin tarjeta",
  PREPAGA: "Prepaga",
  CREDITO: "Crédito",
  POSNET_DEBITO: "Débito",
  POSNET_CREDITO: "Crédito",
};

/** "Efectivo", "QR · Débito", "Posnet · Crédito"… Lo mismo en la caja, la liquidación y el portal. */
export function etiquetaPago(medio: string | null | undefined, forma?: string | null): string {
  if (medio === "EFECTIVO") return "Efectivo";
  if (medio === "TRANSFERENCIA") return "Transferencia";
  const corta = forma ? FORMA_CORTA[forma] : null;
  if (medio === "MERCADO_PAGO") return corta ? `QR · ${corta}` : "Mercado Pago";
  if (medio === "POSNET") return corta ? `Posnet · ${corta}` : "Posnet";
  return medio ?? "—";
}

/** Solo dónde pagó, sin el con qué (listas y filtros). */
export function etiquetaMedio(medio: string | null | undefined): string {
  if (medio === "EFECTIVO") return "Efectivo";
  if (medio === "MERCADO_PAGO") return "Mercado Pago";
  if (medio === "POSNET") return "Posnet";
  if (medio === "TRANSFERENCIA") return "Transferencia";
  return medio ?? "—";
}
