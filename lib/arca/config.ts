import { getSupabaseServerClient } from "@/lib/supabase";

// Qué se factura solo y qué no. Todo apagado por defecto a propósito: nadie
// debería empezar a emitir facturas reales sin haberlo decidido a mano.
//
// Se guarda en la tabla `configuracion` como el resto de los parámetros del
// sistema, para poder cambiarlo sin tocar código ni volver a deployar.

export const PARAMETROS_ARCA = [
  "ARCA_HABILITADO",
  "ARCA_AUTO_EFECTIVO",
  "ARCA_AUTO_MERCADO_PAGO",
  "ARCA_PUNTO_VENTA",
  "ARCA_IVA_PORCENTAJE",
] as const;

export type ConfigArca = {
  /** Interruptor general. Si está apagado, no se emite nada. */
  habilitado: boolean;
  /** Emitir sola la factura de las ventas cobradas en efectivo. */
  autoEfectivo: boolean;
  /** Emitir sola la factura de las ventas cobradas con Mercado Pago. */
  autoMercadoPago: boolean;
  puntoVenta: number;
  ivaPorcentaje: number;
};

export async function obtenerConfigArca(): Promise<ConfigArca> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", [...PARAMETROS_ARCA]);
  const mapa = new Map((data ?? []).map((r) => [r.parametro as string, r.valor as string]));

  return {
    habilitado: mapa.get("ARCA_HABILITADO") === "1",
    autoEfectivo: mapa.get("ARCA_AUTO_EFECTIVO") === "1",
    autoMercadoPago: mapa.get("ARCA_AUTO_MERCADO_PAGO") === "1",
    puntoVenta: Number(mapa.get("ARCA_PUNTO_VENTA")) || 3,
    ivaPorcentaje: Number(mapa.get("ARCA_IVA_PORCENTAJE")) || 21,
  };
}

/**
 * ¿Esta venta se factura sola? Se consulta al confirmar el cobro. Si devuelve
 * false, la venta queda sin factura y se puede emitir a mano después.
 */
export async function debeFacturarseAutomatico(medioPago: string): Promise<boolean> {
  const config = await obtenerConfigArca();
  if (!config.habilitado) return false;
  if (medioPago === "EFECTIVO") return config.autoEfectivo;
  if (medioPago === "MERCADO_PAGO") return config.autoMercadoPago;
  return false;
}
