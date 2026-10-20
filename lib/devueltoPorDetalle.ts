import type { SupabaseClient } from "@supabase/supabase-js";

// Lo que volvió de cada renglón de venta.
//
// Una devolución parcial deja la venta PAGADA y no toca su detalle: el renglón
// sigue diciendo "3 unidades, $30.000" aunque el cliente haya traído una de
// vuelta. Todo lo que suma ventas renglón por renglón —Resumen de ventas, el
// Dashboard, Rentabilidad, Resultado del mes, la liquidación a la marca—
// tiene que restar esto antes de contar, o el producto devuelto se vende para
// siempre y a la marca se le paga por algo que tiene de vuelta en la góndola.
//
// Vive en un solo lugar para que todas esas pantallas resten lo mismo. Las
// anulaciones totales no hacen falta mirarlas acá: esa venta queda ANULADA y
// ya la filtra cada consulta.

export type Devuelto = { cantidad: number; subtotal: number };

// Postgrest manda los `.in()` en la URL: con miles de ids se pasa del largo
// permitido y la consulta falla sin decir por qué.
const TANDA = 500;

/** Cantidad y plata devueltas por renglón, sumando todas sus devoluciones. */
export async function devueltoPorDetalle(
  supabase: SupabaseClient,
  idsDetalle: string[]
): Promise<Map<string, Devuelto>> {
  const mapa = new Map<string, Devuelto>();
  const ids = [...new Set(idsDetalle.filter(Boolean))];
  for (let i = 0; i < ids.length; i += TANDA) {
    const { data } = await supabase
      .from("detalle_devoluciones")
      .select("id_detalle, cantidad, subtotal")
      .in("id_detalle", ids.slice(i, i + TANDA));
    for (const d of data ?? []) {
      const k = d.id_detalle as string;
      const previo = mapa.get(k) ?? { cantidad: 0, subtotal: 0 };
      previo.cantidad += (d.cantidad as number) ?? 0;
      previo.subtotal += (d.subtotal as number) ?? 0;
      mapa.set(k, previo);
    }
  }
  return mapa;
}

/**
 * Un renglón ya sin lo devuelto. Nunca queda en negativo: si por alguna
 * razón se devolvió más de lo vendido, el renglón vale cero, no deuda.
 */
export function netearRenglon(
  cantidad: number | null | undefined,
  subtotal: number | null | undefined,
  devuelto: Devuelto | undefined
): Devuelto {
  return {
    cantidad: Math.max((cantidad ?? 0) - (devuelto?.cantidad ?? 0), 0),
    subtotal: Math.max((subtotal ?? 0) - (devuelto?.subtotal ?? 0), 0),
  };
}

/**
 * Plata devuelta por venta, solo de devoluciones parciales.
 *
 * Para lo que suma `ventas.total` en vez de renglones (el "Venta" del
 * Dashboard). Las totales no entran: esa venta ya está ANULADA.
 */
export async function devueltoParcialPorVenta(
  supabase: SupabaseClient,
  idsVenta: string[]
): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const ids = [...new Set(idsVenta.filter(Boolean))];
  for (let i = 0; i < ids.length; i += TANDA) {
    const { data } = await supabase
      .from("devoluciones")
      .select("id_venta, total")
      .eq("alcance", "PARCIAL")
      .in("id_venta", ids.slice(i, i + TANDA));
    for (const d of data ?? []) {
      const k = d.id_venta as string;
      mapa.set(k, (mapa.get(k) ?? 0) + ((d.total as number) ?? 0));
    }
  }
  return mapa;
}
