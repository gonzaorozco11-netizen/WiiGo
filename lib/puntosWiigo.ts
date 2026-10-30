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
//
// DOS NIVELES (Gonzalo, 2026-10-30). Lo que regala un punto pesa distinto
// según de quién es el producto: de una marca en consignación WiiGo se queda
// con el royalty (5 %), de un producto propio (granel, fraccionado) con todo
// el margen. Por eso:
// - Se gana más en productos WiiGo (PUNTOS_OTORGADOS_PROPIOS) que en los de
//   marcas (PUNTOS_OTORGADOS), los dos "cada PUNTOS_CADA_MONTO".
// - Los puntos se canjean solo contra productos WiiGo
//   (PUNTOS_CANJE_SOLO_PROPIOS): canjear en una marca obliga a pagarle a la
//   marca el precio de lista entero; en lo propio, a WiiGo le cuesta solo la
//   mercadería. De paso, el que viene por suplementos prueba el granel.
import type { SupabaseClient } from "@supabase/supabase-js";

export type InfoCanjePuntos = {
  puntosDisponibles: number;
  valorPorPunto: number;
  topePorcentaje: number;
  maxDescuento: number;
  puntosNecesarios: number;
  /** Si el canje vale solo en productos WiiGo, para avisarlo en la pantalla. */
  soloPropios: boolean;
};

/** Un renglón de la compra: de qué marca es y cuánto suma (precio × cantidad). */
export type LineaPuntos = { idMarca: string | null; importe: number };

const SIN_CANJE: InfoCanjePuntos = { puntosDisponibles: 0, valorPorPunto: 0, topePorcentaje: 0, maxDescuento: 0, puntosNecesarios: 0, soloPropios: false };

async function leerConfigPuntos(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", [
      "PUNTOS_ACTIVO",
      "PUNTOS_CADA_MONTO",
      "PUNTOS_OTORGADOS",
      "PUNTOS_OTORGADOS_PROPIOS",
      "PUNTOS_VALOR_PESOS",
      "PUNTOS_TOPE_CANJE_PORCENTAJE",
      "PUNTOS_CANJE_SOLO_PROPIOS",
    ]);
  const txt = Object.fromEntries((data ?? []).map((r) => [r.parametro as string, (r.valor as string | null) ?? ""]));
  const num = (k: string) => {
    const n = Number(txt[k]);
    return Number.isFinite(n) ? Math.max(n, 0) : 0;
  };
  return {
    activo: txt.PUNTOS_ACTIVO === "true",
    cadaMonto: num("PUNTOS_CADA_MONTO"),
    otorgadosMarcas: num("PUNTOS_OTORGADOS"),
    // Sin cargar todavía: lo mismo que en las marcas (como era antes).
    otorgadosPropios: txt.PUNTOS_OTORGADOS_PROPIOS ? num("PUNTOS_OTORGADOS_PROPIOS") : num("PUNTOS_OTORGADOS"),
    // Sin valor cargado, 0: el canje queda apagado. Nunca se vuelve a la
    // fórmula vieja, que regalaba el 100%.
    valorPorPunto: num("PUNTOS_VALOR_PESOS"),
    topePorcentaje: num("PUNTOS_TOPE_CANJE_PORCENTAJE"),
    soloPropios: txt.PUNTOS_CANJE_SOLO_PROPIOS !== "false",
  };
}

/** Cuánto de la compra es de productos WiiGo (marcas PROPIA) y cuánto de marcas. */
async function repartirPropios(supabase: SupabaseClient, lineas: LineaPuntos[]) {
  const ids = [...new Set(lineas.map((l) => l.idMarca).filter((x): x is string => !!x))];
  const propias = new Set<string>();
  if (ids.length > 0) {
    const { data } = await supabase.from("marcas").select("id_marca, tipo_comercializacion").in("id_marca", ids);
    for (const m of data ?? []) if (m.tipo_comercializacion === "PROPIA") propias.add(m.id_marca as string);
  }
  let propio = 0;
  let total = 0;
  for (const l of lineas) {
    const importe = Math.max(Number(l.importe) || 0, 0);
    total += importe;
    if (l.idMarca && propias.has(l.idMarca)) propio += importe;
  }
  return { propio, total };
}

/**
 * Los puntos que gana el cliente con esta compra. `totalPagado` es lo que
 * pagó de verdad (después de descuentos y de lo que cubrió con puntos): se
 * reparte entre lo propio y lo de marcas en la misma proporción que el carrito.
 */
export async function calcularPuntosGanados(supabase: SupabaseClient, lineas: LineaPuntos[], totalPagado: number) {
  const cfg = await leerConfigPuntos(supabase);
  if (!cfg.activo || cfg.cadaMonto <= 0 || totalPagado <= 0) return 0;
  const { propio, total } = await repartirPropios(supabase, lineas);
  if (total <= 0) return 0;
  const factor = Math.min(totalPagado / total, 1);
  const pagadoPropio = propio * factor;
  const pagadoMarcas = (total - propio) * factor;
  return Math.floor((pagadoPropio / cfg.cadaMonto) * cfg.otorgadosPropios + (pagadoMarcas / cfg.cadaMonto) * cfg.otorgadosMarcas);
}

// Nunca se le pide más puntos de los que tiene, ni se supera el % tope —
// redondeando siempre para abajo (nunca se pasa del tope por un redondeo).
// Si el tope está en 0% (no configurado), el canje queda apagado. Con
// "solo productos WiiGo", el tope se mide sobre lo propio del carrito.
export async function calcularCanjePuntos(
  supabase: SupabaseClient,
  idCliente: string | null,
  montoAPagar: number,
  lineas: LineaPuntos[]
): Promise<InfoCanjePuntos> {
  if (!idCliente || montoAPagar <= 0) return SIN_CANJE;

  const { valorPorPunto, topePorcentaje, soloPropios } = await leerConfigPuntos(supabase);
  if (valorPorPunto <= 0 || topePorcentaje <= 0) return { ...SIN_CANJE, valorPorPunto, topePorcentaje, soloPropios };

  // Sobre qué parte de lo que paga se puede canjear: todo, o solo lo propio
  // (en la misma proporción que el carrito, ya con los descuentos aplicados).
  let base = montoAPagar;
  if (soloPropios) {
    const { propio, total } = await repartirPropios(supabase, lineas);
    base = total > 0 ? montoAPagar * Math.min(propio / total, 1) : 0;
  }
  const { data: cliente } = await supabase.from("clientes").select("puntos").eq("id_cliente", idCliente).maybeSingle();
  const puntosDisponibles = cliente?.puntos ?? 0;
  // Sin productos WiiGo en el carrito: no hay canje, pero se devuelven sus
  // puntos para que la pantalla le avise dónde los puede usar.
  if (base <= 0) return { ...SIN_CANJE, puntosDisponibles, valorPorPunto, topePorcentaje, soloPropios };

  const topeDinero = base * (topePorcentaje / 100);
  const puntosPorTope = Math.floor(topeDinero / valorPorPunto);
  const puntosNecesarios = Math.max(Math.min(puntosDisponibles, puntosPorTope), 0);
  const maxDescuento = Math.round(puntosNecesarios * valorPorPunto);

  return { puntosDisponibles, valorPorPunto, topePorcentaje, maxDescuento, puntosNecesarios, soloPropios };
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
