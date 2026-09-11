// Canje de puntos WiiGo Club por descuento — separado del canje de saldo de
// un profesional (lib/canjesProfesionales.ts), que es otra plata totalmente
// distinta. Acá el cliente paga parte de su propia compra con los puntos que
// fue acumulando.
//
// CUÁNTO VALE UN PUNTO — leer antes de tocar esto.
//
// Antes el valor salía de la propia tasa de acumulación
// (PUNTOS_CADA_MONTO / PUNTOS_OTORGADOS). Esa fórmula devuelve SIEMPRE un
// cashback del 100%, con cualquier número que se cargue: si se ganan 10
// puntos cada $1.000, cada punto vale $100, y los 10 puntos ganados valen
// exactamente los $1.000 gastados. No era un valor mal cargado, estaba
// trabado así.
//
// Y el descuento lo absorbe WiiGo entero: la liquidación a la marca se
// calcula sobre detalle_ventas.subtotal, que es el precio de lista sin
// restar los puntos (ver construirLineas en liquidaciones/actions.ts). Con
// un royalty del 5% y un tope de canje del 20%, cada venta canjeada dejaba
// menos plata cobrada que la que había que rendirle a la marca.
//
// Ahora el valor es un parámetro propio, independiente de la acumulación.
// Si no está cargado el canje queda APAGADO: es preferible que el cliente
// no pueda canjear a que canjee a un valor que funde el negocio. La
// acumulación sigue andando igual, no se pierde nada.
import type { SupabaseClient } from "@supabase/supabase-js";

export type InfoCanjePuntos = {
  puntosDisponibles: number;
  valorPorPunto: number;
  topePorcentaje: number;
  maxDescuento: number;
  puntosNecesarios: number;
};

const SIN_CANJE: InfoCanjePuntos = { puntosDisponibles: 0, valorPorPunto: 0, topePorcentaje: 0, maxDescuento: 0, puntosNecesarios: 0 };

async function tasasCanje(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", ["PUNTOS_VALOR_PESOS", "PUNTOS_TOPE_CANJE_PORCENTAJE"]);
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.parametro, Number(r.valor ?? 0)]));
  // Sin valor cargado, 0: el canje queda apagado. Nunca se vuelve a la
  // fórmula vieja, que regalaba el 100%.
  const valorPorPunto = Number.isFinite(cfg.PUNTOS_VALOR_PESOS) ? Math.max(cfg.PUNTOS_VALOR_PESOS, 0) : 0;
  return { valorPorPunto, topePorcentaje: cfg.PUNTOS_TOPE_CANJE_PORCENTAJE ?? 0 };
}

// Nunca se le pide más puntos de los que tiene, ni se supera el % tope de la
// compra — redondeando siempre para abajo (nunca se pasa del tope por un
// redondeo). Si el tope está en 0% (no configurado), el canje queda apagado.
export async function calcularCanjePuntos(
  supabase: SupabaseClient,
  idCliente: string | null,
  montoAPagar: number
): Promise<InfoCanjePuntos> {
  if (!idCliente || montoAPagar <= 0) return SIN_CANJE;

  const { valorPorPunto, topePorcentaje } = await tasasCanje(supabase);
  if (valorPorPunto <= 0 || topePorcentaje <= 0) return { ...SIN_CANJE, valorPorPunto, topePorcentaje };

  const { data: cliente } = await supabase.from("clientes").select("puntos").eq("id_cliente", idCliente).maybeSingle();
  const puntosDisponibles = cliente?.puntos ?? 0;

  const topeDinero = montoAPagar * (topePorcentaje / 100);
  const puntosPorTope = Math.floor(topeDinero / valorPorPunto);
  const puntosNecesarios = Math.max(Math.min(puntosDisponibles, puntosPorTope), 0);
  const maxDescuento = Math.round(puntosNecesarios * valorPorPunto);

  return { puntosDisponibles, valorPorPunto, topePorcentaje, maxDescuento, puntosNecesarios };
}

export async function buscarClientePorDniConPuntos(supabase: SupabaseClient, dni: string) {
  const dniLimpio = dni.trim();
  if (!dniLimpio) return null;
  const { data } = await supabase.from("clientes").select("id_cliente, nombre, apellido, puntos").eq("dni", dniLimpio).maybeSingle();
  return data;
}

// Se llama recién al confirmar el cobro/la venta — nunca al armar el
// carrito, para no descontarle puntos a nadie por una compra que termina
// abandonada.
export async function aplicarCanjePuntos(supabase: SupabaseClient, idCliente: string, puntosUsados: number) {
  if (puntosUsados <= 0) return;
  const { data: cliente } = await supabase.from("clientes").select("puntos").eq("id_cliente", idCliente).maybeSingle();
  const nuevoSaldo = Math.max((cliente?.puntos ?? 0) - puntosUsados, 0);
  await supabase.from("clientes").update({ puntos: nuevoSaldo }).eq("id_cliente", idCliente);
}
