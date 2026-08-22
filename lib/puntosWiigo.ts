// Canje de puntos WiiGo Club por descuento — separado del canje de saldo de
// un profesional (lib/canjesProfesionales.ts), que es otra plata totalmente
// distinta. Acá el cliente paga parte de su propia compra con los puntos que
// fue acumulando.
//
// El valor de 1 punto en pesos es la misma tasa que la de acumulación (si se
// ganan 10 puntos cada $1.000, 1 punto vale $100 al canjear) — así hay una
// sola regla que mantener en Configuración, no dos.
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
    .in("parametro", ["PUNTOS_CADA_MONTO", "PUNTOS_OTORGADOS", "PUNTOS_TOPE_CANJE_PORCENTAJE"]);
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.parametro, Number(r.valor ?? 0)]));
  const valorPorPunto = cfg.PUNTOS_OTORGADOS > 0 ? cfg.PUNTOS_CADA_MONTO / cfg.PUNTOS_OTORGADOS : 0;
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
