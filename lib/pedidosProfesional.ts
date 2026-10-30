// Pedidos que arma una profesional para su paciente (ver
// sql/profesionales-pedidos.sql). Lo que comparten su espacio, el módulo
// Pedidos del equipo y la caja. Sin imports de servidor: lo usan también
// componentes de cliente.

export type EstadoPedido = "NUEVO" | "LISTO" | "ENTREGADO" | "CANCELADO" | "DEVUELTO";

// ENTREGADO pasa solo cuando se cobra en la caja: por eso dice también "pagado".
export const ETIQUETA_ESTADO: Record<EstadoPedido, string> = {
  NUEVO: "Lo están armando",
  LISTO: "Listo para retirar",
  ENTREGADO: "Entregado y pagado",
  CANCELADO: "Cancelado",
  DEVUELTO: "No lo retiró",
};

/** El precio del momento del pedido se respeta 24 horas (decisión de Gonzalo). */
export const HORAS_PRECIO_FIJO = 24;
/** Una vez armado, se le guarda 3 días. */
export const DIAS_GUARDADO = 3;

export function preciosVigentes(creado: string, ahora = Date.now()) {
  return ahora - new Date(creado).getTime() < HORAS_PRECIO_FIJO * 3600 * 1000;
}

export function hastaCuandoVaElPrecio(creado: string) {
  return new Date(new Date(creado).getTime() + HORAS_PRECIO_FIJO * 3600 * 1000);
}

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

/**
 * wa.me necesita el número con código de país. En Argentina, los celulares
 * van con 549 adelante: un número de 10 dígitos (261 555-0123) se completa solo.
 */
export function linkWhatsApp(telefono: string | null, texto: string) {
  let numero = (telefono ?? "").replace(/\D/g, "");
  if (numero.startsWith("0")) numero = numero.slice(1);
  if (numero.length === 10) numero = `549${numero}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/**
 * El WhatsApp que le manda el local al paciente cuando el pedido está armado.
 * Si el pedido es de la profesional para ella (lo paga con su saldo), le
 * habla a ella.
 */
export function mensajePedidoListo(p: {
  paciente: string;
  profesional: string;
  direccion: string | null;
  guardarHasta: Date;
  totalEfectivo: number;
  totalLista: number;
  creado: string;
  paraProfesional?: boolean;
}) {
  const dia = p.guardarHasta.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
  // Con caritas, más cálido (Gonzalo, 2026-10-30: "que sea más divertido, tipo ¡Hola Juan!").
  if (p.paraProfesional) {
    return [
      `¡Hola ${p.paciente}! 👋🔥`,
      "Tu pedido ya está listo en WiiGo 🛍️✨",
      ...(p.direccion ? [`📍 ${p.direccion}`] : []),
      "",
      `🗓️ Te lo guardamos hasta el ${dia}.`,
      "💳 Al retirarlo ponés tu PIN en la caja y se descuenta de tu saldo; si falta algo, lo pagás ahí.",
      "",
      "¡Te esperamos! 🌿",
    ].join("\n");
  }
  const vence = hastaCuandoVaElPrecio(p.creado);
  const precioVigente = vence.getTime() > Date.now();
  const hora = vence.toLocaleString("es-AR", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
  const precios =
    p.totalEfectivo !== p.totalLista
      ? `${pesos(p.totalEfectivo)} en efectivo o ${pesos(p.totalLista)} con tarjeta o Mercado Pago`
      : pesos(p.totalLista);
  return [
    `¡Hola ${p.paciente}! 👋🔥`,
    `Tu pedido de ${p.profesional} ya está listo en WiiGo 🛍️✨`,
    ...(p.direccion ? [`📍 ${p.direccion}`] : []),
    "",
    `🗓️ Te lo guardamos hasta el ${dia}.`,
    `💵 Lo pagás cuando lo retirás: ${precios}.`,
    ...(precioVigente ? [`⏰ Ese precio vale hasta el ${hora}; después se cobra el del día.`] : []),
    "",
    "¡Te esperamos! 🌿",
  ].join("\n");
}
