// Integración con la API de Mercado Pago (Orders API) para el QR dinámico
// del self-checkout. Todo pasa por acá — nada de credenciales ni llamadas a
// Mercado Pago sueltas en otros archivos.
//
// Documentación de referencia (Orders API + QR Code):
// https://www.mercadopago.com.ar/developers/es/docs/qr-code
//
// El Access Token vive SOLO en la variable de entorno MP_ACCESS_TOKEN
// (cargada en Vercel) — nunca se pisa ni se expone al cliente.

import { randomUUID } from "crypto";

const MP_API = "https://api.mercadopago.com";

function accessToken(): string {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error("Falta configurar la variable MP_ACCESS_TOKEN en Vercel.");
  return token;
}

// permitir404: para búsquedas (stores/search, pos) — una cuenta que todavía
// no tiene ninguna sucursal/caja creada puede devolver 404 en vez de un
// listado vacío. En esos casos un 404 significa "no existe todavía", no un
// error real, así que se devuelve null en vez de cortar con una excepción.
async function mpFetch(path: string, init: RequestInit = {}, permitir404 = false) {
  const res = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (permitir404 && res.status === 404) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detalle =
      data?.message ||
      data?.error ||
      (Array.isArray(data?.cause) && data.cause[0]?.description) ||
      `Mercado Pago devolvió un error (${res.status})`;
    throw new Error(typeof detalle === "string" ? detalle : JSON.stringify(detalle));
  }
  return data;
}

/**
 * Reintegro al cliente, total o parcial.
 *
 * Sin `monto` devuelve todo el pago; con `monto`, solo esa parte — que es lo
 * que hace falta cuando el cliente devuelve un producto de tres.
 *
 * La clave de idempotencia va armada con el id del pago y el monto, así un
 * doble clic o un reintento no le devuelven la plata dos veces. Mercado Pago
 * reconoce la clave repetida y responde el mismo reintegro en vez de crear
 * otro.
 *
 * Ojo: Mercado Pago no acepta reintegros de pagos viejos (el límite lo pone
 * ellos, no nosotros). En ese caso tira error y hay que resolverlo por fuera.
 */
export async function reintegrarPagoMp(params: {
  idPagoMp: string;
  monto?: number;
  referencia: string;
}): Promise<{ id: string; monto: number }> {
  const cuerpo = params.monto !== undefined ? JSON.stringify({ amount: Number(params.monto.toFixed(2)) }) : "{}";

  const data = await mpFetch(`/v1/payments/${params.idPagoMp}/refunds`, {
    method: "POST",
    body: cuerpo,
    headers: { "X-Idempotency-Key": `wiigo-dev-${params.referencia}` },
  });

  return { id: String(data?.id ?? ""), monto: Number(data?.amount ?? params.monto ?? 0) };
}

export async function obtenerUsuarioMp(): Promise<{ id: number; nickname?: string }> {
  return mpFetch("/users/me");
}

// Si ya se había creado antes (mismo external_id), Mercado Pago no deja
// crearla de nuevo — hay que buscarla y reusarla. Ver crearSucursalMp/
// crearCajaMp abajo, que siguen existiendo por si hace falta crear una
// sucursal o caja nueva desde cero.
export async function buscarSucursalMp(userId: number, externalId: string): Promise<{ id: string } | null> {
  const data = await mpFetch(`/users/${userId}/stores/search?external_id=${encodeURIComponent(externalId)}`, {}, true);
  const encontrada = data?.results?.[0];
  return encontrada ? { id: encontrada.id } : null;
}

export async function buscarCajaMp(externalPosId: string, externalStoreId: string): Promise<{ id: number; external_id: string } | null> {
  const data = await mpFetch(
    `/pos?external_id=${encodeURIComponent(externalPosId)}&external_store_id=${encodeURIComponent(externalStoreId)}`,
    {},
    true
  );
  const encontrada = data?.results?.[0];
  return encontrada ? { id: encontrada.id, external_id: encontrada.external_id } : null;
}

export async function crearSucursalMp(
  userId: number,
  nombre: string,
  externalId: string,
  ubicacion: { calle: string; altura: string; ciudad: string; provincia: string; latitud: number; longitud: number }
): Promise<{ id: string }> {
  return mpFetch(`/users/${userId}/stores`, {
    method: "POST",
    body: JSON.stringify({
      name: nombre,
      external_id: externalId,
      location: {
        street_name: ubicacion.calle,
        street_number: ubicacion.altura,
        city_name: ubicacion.ciudad,
        state_name: ubicacion.provincia,
        latitude: ubicacion.latitud,
        longitude: ubicacion.longitud,
      },
    }),
  });
}

export async function crearCajaMp(params: {
  storeId: string;
  externalStoreId: string;
  externalPosId: string;
  nombre: string;
}): Promise<{ id: number; external_id: string }> {
  return mpFetch("/pos", {
    method: "POST",
    body: JSON.stringify({
      name: params.nombre,
      fixed_amount: false,
      store_id: params.storeId,
      external_store_id: params.externalStoreId,
      external_id: params.externalPosId,
      category: 621102,
    }),
  });
}

export type OrdenQrMp = {
  idOrden: string;
  qrData: string;
};

// Crea una orden de tipo QR por el monto exacto del pedido — cada venta
// genera un QR nuevo, no reutiliza uno fijo. external_reference queda con
// el id de la venta de WiiGo, así el webhook puede volver a encontrarla.
export async function crearOrdenQrMp(params: {
  idVenta: string;
  total: number;
  externalPosId: string;
  descripcion: string;
}): Promise<OrdenQrMp> {
  const data = await mpFetch("/v1/orders", {
    method: "POST",
    headers: { "X-Idempotency-Key": randomUUID() },
    body: JSON.stringify({
      type: "qr",
      total_amount: params.total.toFixed(2),
      external_reference: params.idVenta,
      description: params.descripcion.slice(0, 150),
      config: {
        qr: {
          external_pos_id: params.externalPosId,
          mode: "dynamic",
        },
      },
      transactions: {
        payments: [{ amount: params.total.toFixed(2) }],
      },
    }),
  });
  const qrData = data?.type_response?.qr_data;
  if (!data?.id || !qrData) throw new Error("Mercado Pago no devolvió el QR de la orden.");
  return { idOrden: data.id, qrData };
}

export async function obtenerOrdenMp(idOrden: string) {
  return mpFetch(`/v1/orders/${idOrden}`);
}

// Traduce la forma de pago real que usó el cliente (que informa Mercado
// Pago dentro de la propia orden, en transactions.payments[0].payment_method)
// a las mismas categorías que ya se cargan en Configuración → Comisión de
// Mercado Pago (ver FORMAS_PAGO_MP en app/(app)/cobros-efectivo/actions.ts)
// — así la comisión se calcula con la tasa correcta según cómo pagó, no una
// tasa única.
//
// Los ids de pago de la Orders API (con prefijo "PAY...") no son
// compatibles con el endpoint clásico GET /v1/payments/{id} (que espera un
// id numérico y devuelve 404 con estos) — por eso la forma de pago se lee
// directo del objeto payment_method que ya viene incluido en la orden, sin
// necesidad de una llamada aparte.
//
// CUOTAS_SIN_INTERES es, en la cuenta de Mercado Pago, «Cuotas sin tarjeta»
// (Mercado Crédito: el cliente paga en cuotas con un préstamo de Mercado
// Pago, sin tarjeta). Cuesta 1,38% al instante (Gonzalo, 2026-11-04). La
// clave se dejó con el nombre viejo para no migrar las ventas guardadas.
//
// La tarjeta de crédito va siempre como CREDITO, en 1 o en varias cuotas:
// desde 2026-11-04 Gonzalo la tiene desactivada en el QR (el crédito se
// cobra con el posnet), y si se reactiva, cuesta lo del crédito y no lo de
// Mercado Crédito.
//
// Antes, cualquier cosa que no fuera de las de arriba caía en CREDITO. Así
// quedó la venta #15 (2026-11-12), que la clienta pagó con MODO desde su
// cuenta: Mercado Pago no cobró comisión y el sistema le restaba la del
// crédito (6,15 % + IVA). Ahora crédito es solo la tarjeta de crédito, y lo
// demás que no es tarjeta (transferencia desde MODO o un banco) va como
// TRANSFERENCIA. Si no viene el tipo, se sigue suponiendo lo más caro.
export function mapearFormaPagoMp(paymentMethod: {
  id?: string;
  type?: string;
  installments?: number;
}): "DINERO_CUENTA" | "DEBITO" | "CUOTAS_SIN_INTERES" | "PREPAGA" | "CREDITO" | "TRANSFERENCIA" {
  const tipo = paymentMethod.type;
  if (tipo === "account_money") return "DINERO_CUENTA";
  if (tipo === "debit_card") return "DEBITO";
  if (tipo === "prepaid_card") return "PREPAGA";
  if (paymentMethod.id === "consumer_credits" || tipo === "digital_currency" || tipo === "consumer_credits") return "CUOTAS_SIN_INTERES";
  if (tipo === "credit_card" || !tipo) return "CREDITO";
  return "TRANSFERENCIA";
}
