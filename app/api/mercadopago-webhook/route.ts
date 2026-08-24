// Mercado Pago llama acá cada vez que pasa algo con una orden de QR
// (pago aprobado, cancelado, expirado, etc.). Es la pieza que reemplaza al
// "(QR pendiente de integración)" del self-checkout: cuando el pago se
// aprueba, esto marca la venta como PAGADA solo, sin que nadie del local
// tenga que tocar nada — reusando exactamente la misma lógica de negocio
// que ya usa "Confirmar cobro" en efectivo (stock, comisiones, puntos, etc.).
//
// Documentación:
// https://www.mercadopago.com.ar/developers/es/docs/qr-code/notifications

import { createHmac, timingSafeEqual } from "crypto";
import { obtenerOrdenMp, obtenerPagoMp, mapearFormaPagoMp } from "@/lib/mercadopago";
import { confirmarCobro } from "@/app/(app)/cobros-efectivo/actions";

function firmaValida(req: Request, dataId: string): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    console.error("MP webhook: falta configurar MP_WEBHOOK_SECRET");
    return false;
  }
  const signature = req.headers.get("x-signature") ?? "";
  const requestId = req.headers.get("x-request-id") ?? "";

  const partes = Object.fromEntries(
    signature.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const esperado = createHmac("sha256", secret).update(manifest).digest("hex");

  const a = Buffer.from(esperado);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  const tipo = url.searchParams.get("type");

  // Ping de prueba de Mercado Pago u otro evento que no es una orden de QR
  // — no hay nada que hacer, pero respondemos 200 igual.
  if (!dataId || tipo !== "order") {
    return new Response(null, { status: 200 });
  }

  if (!firmaValida(req, dataId)) {
    console.error("MP webhook: firma inválida, se ignora la notificación");
    return new Response(null, { status: 401 });
  }

  try {
    const orden = await obtenerOrdenMp(dataId);
    const idVenta: string | undefined = orden?.external_reference;
    const estado: string | undefined = orden?.status;

    if (!idVenta) {
      console.error("MP webhook: la orden no tiene external_reference", dataId);
      return new Response(null, { status: 200 });
    }

    // Solo nos importa cuando el pago quedó efectivamente acreditado — el
    // resto de los estados (cancelado, expirado) los deja el cliente
    // manejar desde "Cancelar" en el propio totem, no hace falta duplicar
    // esa lógica acá.
    if (estado !== "processed") {
      return new Response(null, { status: 200 });
    }

    const idPago: string | undefined = orden?.transactions?.payments?.[0]?.id;
    let formaPagoMp: ReturnType<typeof mapearFormaPagoMp> = "CREDITO";
    if (idPago) {
      const pago = await obtenerPagoMp(String(idPago));
      formaPagoMp = mapearFormaPagoMp(pago);
    }

    const total = Number(orden?.total_amount ?? 0);
    const resultado = await confirmarCobro(idVenta, total, formaPagoMp, "Mercado Pago (automático)");
    if (resultado.error) {
      console.error(`MP webhook: no se pudo confirmar el cobro de la venta ${idVenta}:`, resultado.error);
    }

    return new Response(null, { status: 200 });
  } catch (err) {
    console.error("MP webhook: error procesando la notificación", err);
    // Devolvemos 200 igual — si el problema es nuestro, reintentar cada 15
    // minutos no lo va a arreglar solo, y no queremos que Mercado Pago nos
    // marque la integración como poco confiable.
    return new Response(null, { status: 200 });
  }
}

// Mercado Pago a veces valida la URL con un GET simple al guardarla en el
// panel — con responder 200 alcanza.
export async function GET() {
  return new Response(null, { status: 200 });
}
