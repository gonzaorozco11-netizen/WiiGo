import { getSupabaseServerClient } from "@/lib/supabase";
import { emitirFactura, NOTA_CREDITO_DE, TIPO_DOC } from "@/lib/arca/wsfe";
import { obtenerConfigArca } from "@/lib/arca/config";

// Nota de crédito: cómo se anula una venta que ya se facturó.
//
// Una factura autorizada por ARCA no se borra ni se corrige — queda emitida
// para siempre. Lo que se hace es emitir un comprobante nuevo, la nota de
// crédito, que la deja sin efecto. Es el equivalente fiscal de lo que hace
// `anularVenta` puertas adentro: no borra, revierte.
//
// Va por el mismo servicio que ya emite las facturas, con dos diferencias: el
// tipo de comprobante (3 para las A, 8 para las B) y el bloque CbtesAsoc, que
// le dice a ARCA cuál es la factura que se está anulando.

export type EstadoNotaCredito = "NO_CORRESPONDE" | "EMITIDA" | "PENDIENTE";

export type ResultadoNotaCredito = {
  estado: EstadoNotaCredito;
  /** Texto para mostrarle a quien anuló. Siempre viene algo. */
  mensaje: string;
};

type VentaFacturada = {
  id_venta: string;
  cae: string | null;
  factura_tipo: number | null;
  factura_punto_venta: number | null;
  factura_numero: number | null;
  factura_fecha: string | null;
  factura_doc_tipo: number | null;
  factura_doc_nro: string | null;
  total: number | null;
};

/** AAAAMMDD, que es como ARCA pide las fechas. */
function aFormatoArca(fecha: string | null) {
  if (!fecha) return undefined;
  const limpio = fecha.slice(0, 10).replace(/-/g, "");
  return limpio.length === 8 ? limpio : undefined;
}

/**
 * Emite la nota de crédito que anula la factura de una venta.
 *
 * Nunca tira error: devuelve el estado. La razón es que esto corre dentro de
 * una anulación que ya devolvió el stock y la plata — si ARCA está caído, la
 * anulación tiene que completarse igual y la nota de crédito queda PENDIENTE,
 * bien visible, para reintentarla. Frenar la anulación dejaría al cliente
 * esperando en el mostrador por una caída de un servicio externo.
 */
export async function emitirNotaCreditoDeVenta(idVenta: string): Promise<ResultadoNotaCredito> {
  const supabase = getSupabaseServerClient();

  const { data } = await supabase
    .from("ventas")
    .select(
      "id_venta, cae, factura_tipo, factura_punto_venta, factura_numero, factura_fecha, factura_doc_tipo, factura_doc_nro, total, nc_cae"
    )
    .eq("id_venta", idVenta)
    .maybeSingle();

  const venta = data as (VentaFacturada & { nc_cae: string | null }) | null;

  // Venta sin factura: no hay nada que anular en ARCA, alcanza con la
  // anulación interna.
  if (!venta || !venta.cae) {
    return { estado: "NO_CORRESPONDE", mensaje: "Esta venta no estaba facturada, así que no hace falta nota de crédito." };
  }

  // Ya tiene una: no se emite dos veces. Dos notas de crédito sobre la misma
  // factura le devolverían el IVA dos veces a ARCA.
  if (venta.nc_cae) {
    return { estado: "EMITIDA", mensaje: "Esta venta ya tenía su nota de crédito emitida." };
  }

  const tipoNota = NOTA_CREDITO_DE[venta.factura_tipo ?? 0];
  if (!tipoNota || !venta.factura_punto_venta || !venta.factura_numero) {
    return {
      estado: "PENDIENTE",
      mensaje: "No se pudo armar la nota de crédito: faltan datos de la factura original. Avisale a administración.",
    };
  }

  const total = venta.total ?? 0;
  if (total <= 0) {
    return { estado: "PENDIENTE", mensaje: "La venta no tiene importe: la nota de crédito quedó pendiente." };
  }

  const config = await obtenerConfigArca();
  // Si la facturación está apagada no se puede emitir, pero la factura ya
  // existe: queda pendiente, no "no corresponde".
  if (!config.habilitado) {
    await supabase
      .from("ventas")
      .update({ nc_estado: "PENDIENTE", nc_error: "La facturación electrónica está apagada en Configuración." })
      .eq("id_venta", idVenta);
    return {
      estado: "PENDIENTE",
      mensaje:
        "La venta quedó anulada, pero la facturación electrónica está apagada y esta venta tenía factura. " +
        "Prendela en Configuración y reintentá la nota de crédito desde Ventas.",
    };
  }

  try {
    const resultado = await emitirFactura({
      tipoComprobante: tipoNota,
      puntoVenta: venta.factura_punto_venta,
      // El receptor tiene que ser el mismo de la factura original.
      tipoDoc: venta.factura_doc_tipo ?? TIPO_DOC.CONSUMIDOR_FINAL,
      nroDoc: venta.factura_doc_nro ?? "0",
      total,
      porcentajeIva: config.ivaPorcentaje,
      comprobanteAsociado: {
        tipo: venta.factura_tipo as number,
        puntoVenta: venta.factura_punto_venta,
        numero: venta.factura_numero,
        fecha: aFormatoArca(venta.factura_fecha),
      },
    });

    // Momento crítico, igual que al facturar: ARCA ya autorizó y no hay vuelta
    // atrás. Si el guardado fallara, la nota existiría en ARCA y no acá, y
    // alguien la volvería a emitir. Por eso el error se registra en vez de
    // tirarse.
    const { error } = await supabase
      .from("ventas")
      .update({
        nc_estado: "EMITIDA",
        nc_cae: resultado.cae,
        nc_cae_vencimiento: resultado.vencimientoCae,
        nc_tipo: resultado.tipoComprobante,
        nc_punto_venta: resultado.puntoVenta,
        nc_numero: resultado.numeroComprobante,
        nc_neto: resultado.neto,
        nc_iva: resultado.iva,
        nc_total: resultado.total,
        nc_fecha: `${resultado.fecha.slice(0, 4)}-${resultado.fecha.slice(4, 6)}-${resultado.fecha.slice(6, 8)}`,
        nc_error: null,
      })
      .eq("id_venta", idVenta);

    if (error) {
      return {
        estado: "EMITIDA",
        mensaje:
          `ARCA autorizó la nota de crédito ${resultado.puntoVenta}-${resultado.numeroComprobante} ` +
          `(CAE ${resultado.cae}) pero no se pudo guardar en el sistema. Anotala y avisá: ${error.message}`,
      };
    }

    return {
      estado: "EMITIDA",
      mensaje: `Nota de crédito ${String(resultado.puntoVenta).padStart(5, "0")}-${String(
        resultado.numeroComprobante
      ).padStart(8, "0")} emitida. La factura quedó anulada ante ARCA.`,
    };
  } catch (err) {
    const detalle = err instanceof Error ? err.message : "error desconocido";
    await supabase
      .from("ventas")
      .update({ nc_estado: "PENDIENTE", nc_error: detalle })
      .eq("id_venta", idVenta);

    return {
      estado: "PENDIENTE",
      mensaje:
        "La venta quedó anulada, pero ARCA no emitió la nota de crédito: " +
        detalle +
        " · Queda marcada como pendiente en Ventas para reintentarla.",
    };
  }
}
