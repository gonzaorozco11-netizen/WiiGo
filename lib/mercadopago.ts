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

async function mpFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
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

export async function obtenerUsuarioMp(): Promise<{ id: number; nickname?: string }> {
  return mpFetch("/users/me");
}

// Si ya se había creado antes (mismo external_id), Mercado Pago no deja
// crearla de nuevo — hay que buscarla y reusarla. Ver crearSucursalMp/
// crearCajaMp abajo, que siguen existiendo por si hace falta crear una
// sucursal o caja nueva desde cero.
export async function buscarSucursalMp(userId: number, externalId: string): Promise<{ id: string } | null> {
  const data = await mpFetch(`/users/${userId}/stores/search?external_id=${encodeURIComponent(externalId)}`);
  const encontrada = data?.results?.[0];
  return encontrada ? { id: encontrada.id } : null;
}

export async function buscarCajaMp(externalPosId: string, externalStoreId: string): Promise<{ id: number; external_id: string } | null> {
  const data = await mpFetch(`/pos?external_id=${encodeURIComponent(externalPosId)}&external_store_id=${encodeURIComponent(externalStoreId)}`);
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
// Ojo: distinguir "cuotas sin interés" de "crédito común" no viene
// explícito y directo en el pago — se infiere de la cantidad de cuotas.
// Puede no ser 100% preciso en promociones bancarias raras; conviene
// revisar los primeros cobros reales para confirmar que la comisión
// calculada tiene sentido.
export function mapearFormaPagoMp(paymentMethod: {
  type?: string;
  installments?: number;
}): "DINERO_CUENTA" | "DEBITO" | "CUOTAS_SIN_INTERES" | "PREPAGA" | "CREDITO" {
  const tipo = paymentMethod.type;
  if (tipo === "account_money") return "DINERO_CUENTA";
  if (tipo === "debit_card") return "DEBITO";
  if (tipo === "prepaid_card") return "PREPAGA";
  if (tipo === "credit_card") {
    return (paymentMethod.installments ?? 1) > 1 ? "CUOTAS_SIN_INTERES" : "CREDITO";
  }
  return "CREDITO";
}
