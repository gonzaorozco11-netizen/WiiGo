import { getSupabaseServerClient } from "@/lib/supabase";
import type { DatosReceptor } from "@/lib/arca/emitir";

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
  "ARCA_MONTO_IDENTIFICACION",
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
  /**
   * Monto a partir del cual ARCA exige identificar al comprador en ventas a
   * consumidor final. Arriba de esto, el totem pide el DNI antes de cobrar.
   *
   * En 0 no se pide nunca. Es un parámetro y no una constante porque ARCA lo
   * actualiza seguido y no queremos un deploy cada vez.
   */
  montoIdentificacion: number;
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
    montoIdentificacion: Number(mapa.get("ARCA_MONTO_IDENTIFICACION")) || 0,
  };
}

/**
 * A partir de qué monto el totem tiene que pedir el DNI. 0 = nunca.
 *
 * Devuelve 0 si no hay nada que facturar automáticamente: sin factura no hay
 * nada que ARCA pueda rechazar, y no tiene sentido molestar al cliente.
 *
 * Se resuelve antes de elegir el medio de pago (el DNI se pide al pasar del
 * carrito a la pantalla de cobro), así que alcanza con que alguno de los dos
 * medios facture solo.
 */
export async function montoQuePideDni(): Promise<number> {
  const config = await obtenerConfigArca();
  if (!config.habilitado || config.montoIdentificacion <= 0) return 0;
  if (!config.autoEfectivo && !config.autoMercadoPago) return 0;
  return config.montoIdentificacion;
}

/**
 * ¿Esta venta se factura sola? Se consulta al acreditarse el cobro. Si
 * devuelve false, la venta queda sin factura y se emite a mano desde Ventas.
 */
export async function debeFacturarseAutomatico(medioPago: string): Promise<boolean> {
  const config = await obtenerConfigArca();
  if (!config.habilitado) return false;
  if (medioPago === "EFECTIVO") return config.autoEfectivo;
  if (medioPago === "MERCADO_PAGO") return config.autoMercadoPago;
  return false;
}

/**
 * Factura una venta recién cobrada, si la configuración lo pide.
 *
 * NUNCA tira error: si ARCA está caído o rechaza, la venta ya está cobrada y
 * cerrada, y no puede deshacerse por un problema de facturación. La venta
 * queda sin CAE y aparece en Ventas → "Pendientes de facturar" para emitirla
 * después. Sin esto, una caída de ARCA (que pasa seguido) dejaría al local
 * sin poder cobrar.
 */
export async function facturarAlAcreditarse(idVenta: string, medioPago: string) {
  try {
    if (!(await debeFacturarseAutomatico(medioPago))) return;
    // Import diferido para no arrastrar node-forge y todo el cliente de ARCA
    // en las ventas que no se facturan solas.
    const { emitirFacturaParaVenta } = await import("@/lib/arca/emitir");
    await emitirFacturaParaVenta(idVenta, await receptorDeVenta(idVenta));
  } catch {
    // Silencio a propósito: la venta ya está cobrada y no se toca.
  }
}

/**
 * A nombre de quién va la factura de esta venta.
 *
 * Se lee de la venta y no se pasa por parámetro a propósito: el cobro puede
 * confirmarlo el webhook de Mercado Pago, que no sabe nada de lo que se
 * eligió en la pantalla. El dato queda estampado en la venta al momento de
 * cobrar (totem o POS) y acá solo se lee.
 *
 * Orden: lo que se cargó al cobrar → el DNI que el cliente ya tenga en su
 * ficha (los que se identifican con puntos WiiGo) → consumidor final.
 */
export async function receptorDeVenta(idVenta: string): Promise<DatosReceptor> {
  const supabase = getSupabaseServerClient();
  const { data: venta } = await supabase
    .from("ventas")
    .select("factura_doc_tipo, factura_doc_nro, id_cliente")
    .eq("id_venta", idVenta)
    .maybeSingle();

  const cargado = (venta?.factura_doc_nro as string | null)?.replace(/\D/g, "");
  if (cargado) {
    return { tipo: venta?.factura_doc_tipo === 80 ? "CUIT" : "DNI", numero: cargado };
  }

  if (venta?.id_cliente) {
    const { data: cliente } = await supabase
      .from("clientes")
      .select("dni")
      .eq("id_cliente", venta.id_cliente)
      .maybeSingle();
    const dni = (cliente?.dni as string | null)?.replace(/\D/g, "");
    if (dni) return { tipo: "DNI", numero: dni };
  }

  return { tipo: "CONSUMIDOR_FINAL", numero: "0" };
}
