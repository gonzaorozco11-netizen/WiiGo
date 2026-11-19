import { createHmac, timingSafeEqual } from "crypto";

// Nave (Banco Galicia): cobrar con tarjeta en la tienda online (Gonzalo, 18/11).
//
// Nave no publica la documentación de su API: los pasos salen del plugin oficial
// «Nave for WooCommerce» (código abierto, WordPress.org), que hace lo mismo:
//   1. Token: POST al servicio de seguridad con client_id, client_secret y audience.
//   2. Intención de pago: POST {api}/payment_request/ecommerce → { id, checkout_url }.
//      El cliente paga en checkout_url y vuelve a callback_url.
//   3. Aviso: Nave hace POST a notification_url con { payment_id, payment_check_url }.
//      No viene firmado: se valida con un secreto en la URL y se vuelve a consultar el
//      pago a Nave (GET {pagos}/{payment_id}/internal) antes de creerle.
//
// Credenciales (las pide Gonzalo a integraciones@navenegocios.com y las carga en Vercel):
//   NAVE_CLIENT_ID, NAVE_CLIENT_SECRET, NAVE_POS_ID y NAVE_ENTORNO («produccion» o «sandbox»).
// Sin las tres primeras, la opción «Tarjeta» no aparece en la tienda.

const URLS = {
  sandbox: {
    token: "https://homoservices.apinaranja.com/security-ms/api/security/auth0/b2b/m2ms",
    api: "https://api-sandbox.ranty.io/api",
    pagos: "https://punku-sandbox.ranty.io/payments-ms/payments",
  },
  produccion: {
    token: "https://services.apinaranja.com/security-ms/api/security/auth0/b2b/m2msPrivate",
    api: "https://api.ranty.io/api",
    pagos: "https://punku.ranty.io/payments-ms/payments",
  },
} as const;
const AUDIENCE = "https://naranja.com/ranty/merchants/api";

export function naveConfigurado(): boolean {
  return Boolean(process.env.NAVE_CLIENT_ID && process.env.NAVE_CLIENT_SECRET && process.env.NAVE_POS_ID);
}
function entorno() {
  return process.env.NAVE_ENTORNO === "produccion" ? URLS.produccion : URLS.sandbox;
}

// El token dura ~1 h: se guarda en memoria mientras viva la función (si no, se pide otro).
let tokenGuardado: { valor: string; vence: number } | null = null;

async function token(renovar = false): Promise<string> {
  if (!renovar && tokenGuardado && tokenGuardado.vence > Date.now()) return tokenGuardado.valor;
  const r = await fetch(entorno().token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.NAVE_CLIENT_ID, client_secret: process.env.NAVE_CLIENT_SECRET, audience: AUDIENCE }),
    signal: AbortSignal.timeout(10000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!r.ok || !j.access_token) throw new Error(`Nave no dio el token (${r.status})`);
  const segundos = Math.max(Number(j.expires_in ?? 3600) - 60, 60);
  tokenGuardado = { valor: j.access_token, vence: Date.now() + segundos * 1000 };
  return j.access_token;
}

async function pedir<T>(url: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
  for (let intento = 0; intento < 2; intento++) {
    const r = await fetch(url, {
      method: init.method,
      headers: { Authorization: `Bearer ${await token(intento > 0)}`, "Content-Type": "application/json", Accept: "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 401 && intento === 0) continue; // token vencido: se pide otro y se reintenta una vez
    const texto = await r.text();
    if (!r.ok) throw new Error(`Nave respondió ${r.status}: ${texto.slice(0, 300)}`);
    return (texto ? JSON.parse(texto) : {}) as T;
  }
  throw new Error("Nave no aceptó el token");
}

const plata = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export type ProductoNave = { nombre: string; cantidad: number; precio: number };

/** Crea la intención de pago y devuelve dónde mandar al cliente a pagar. */
export async function crearPagoNave(p: {
  referencia: string;
  total: number;
  productos: ProductoNave[];
  comprador: { id: string; nombre: string; email: string; dni: string | null };
  volverA: string;
  avisarA: string;
  /** Cuánto dura el link de pago (Nave usa 15 min por defecto). */
  segundos?: number;
}): Promise<{ id: string; checkoutUrl: string }> {
  const r = await pedir<{ id?: string; checkout_url?: string }>(`${entorno().api}/payment_request/ecommerce`, {
    method: "POST",
    body: {
      external_payment_id: p.referencia,
      seller: { pos_id: process.env.NAVE_POS_ID },
      transactions: [
        {
          amount: { currency: "ARS", value: plata(p.total) },
          products: p.productos.map((x) => ({
            name: x.nombre.slice(0, 120),
            description: x.nombre.slice(0, 120),
            quantity: x.cantidad,
            unit_price: { currency: "ARS", value: plata(x.precio) },
          })),
        },
      ],
      buyer: {
        user_id: p.comprador.id,
        name: p.comprador.nombre,
        user_email: p.comprador.email,
        doc_type: "DNI",
        doc_number: p.comprador.dni ?? "",
      },
      additional_info: { callback_url: p.volverA, notification_url: p.avisarA },
      platform: { id: "wiigo", type: "ecommerce", data: { callback_url: p.volverA, notification_url: p.avisarA } },
      duration_time: p.segundos ?? 1800,
    },
  });
  if (!r.id || !r.checkout_url) throw new Error("Nave no devolvió el link de pago");
  return { id: r.id, checkoutUrl: r.checkout_url };
}

export type EstadoPagoNave = "APROBADO" | "RECHAZADO" | "PENDIENTE" | "CANCELADO" | "DEVUELTO" | "OTRO";

/** El pago, consultado a Nave (nunca se le cree al aviso sin esto). */
export async function consultarPagoNave(idPago: string): Promise<{ estado: EstadoPagoNave; crudo: string; forma: "POSNET_DEBITO" | "POSNET_CREDITO" | null; datos: Record<string, unknown> }> {
  const d = await pedir<Record<string, unknown>>(`${entorno().pagos}/${encodeURIComponent(idPago)}/internal`, { method: "GET" });
  const crudo = String((d.status as { name?: string } | undefined)?.name ?? "").toUpperCase();
  const estado: EstadoPagoNave =
    crudo === "APPROVED" ? "APROBADO"
      : crudo === "REJECTED" ? "RECHAZADO"
        : crudo === "PENDING" ? "PENDIENTE"
          : crudo === "CANCELLED" ? "CANCELADO"
            : /REFUND|REVERSED|CHARGED_BACK/.test(crudo) ? "DEVUELTO"
              : "OTRO";
  // Débito o crédito: Nave no documenta el campo; se busca en lo que venga. Sin dato, crédito
  // (la comisión más alta: mejor sobrestimar el costo que inventar ganancia).
  const texto = JSON.stringify(d).toUpperCase();
  const forma = /"(PAYMENT_TYPE|CARD_TYPE|TYPE|PAYMENT_METHOD_TYPE)"\s*:\s*"(DEBIT|DEBITO|DEBIT_CARD)"/.test(texto)
    ? "POSNET_DEBITO"
    : /"(PAYMENT_TYPE|CARD_TYPE|TYPE|PAYMENT_METHOD_TYPE)"\s*:\s*"(CREDIT|CREDITO|CREDIT_CARD)"/.test(texto)
      ? "POSNET_CREDITO"
      : null;
  return { estado, crudo, forma, datos: d };
}

/**
 * A qué pedido nuestro pertenece un pago, según lo que Nave devuelve de él: el
 * external_payment_id (nuestro código de pedido) o el id de la intención de pago.
 * Nave no documenta dónde viene, así que se busca en todo el objeto.
 */
export function referenciasDelPago(datos: Record<string, unknown>): string[] {
  const refs = new Set<string>();
  const ver = (v: unknown, prof: number) => {
    if (!v || typeof v !== "object" || prof > 6) return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const clave = k.toLowerCase();
      if ((typeof x === "string" || typeof x === "number") && /^(external_payment_id|external_id|external_reference|payment_request_id)$/.test(clave)) refs.add(String(x).trim());
      if (clave === "payment_request" && x && typeof x === "object" && (x as { id?: unknown }).id) refs.add(String((x as { id: unknown }).id).trim());
      if (x && typeof x === "object") ver(x, prof + 1);
    }
  };
  ver(datos, 0);
  return [...refs].filter((r) => /^[\w-]{1,100}$/.test(r));
}

/** La intención de pago (por si el aviso no llegó): SUCCESS_PROCESSED = pagada. */
export async function consultarPedidoNave(idPedidoNave: string): Promise<{ estado: string; idPago: string | null }> {
  const d = await pedir<Record<string, unknown>>(`${entorno().api}/payment_requests/${encodeURIComponent(idPedidoNave)}`, { method: "GET" });
  const estado = String((d.status as { name?: string } | undefined)?.name ?? "").toUpperCase();
  // El id del pago puede venir en distintos lugares; se busca el primero que aparezca.
  const pagos = (d.payments ?? (d.transactions as { payments?: unknown }[] | undefined)?.[0]?.payments) as { id?: string; payment_id?: string }[] | undefined;
  const idPago = (d.payment_id as string | undefined) ?? pagos?.[0]?.payment_id ?? pagos?.[0]?.id ?? null;
  return { estado, idPago };
}

/** El secreto que va en la URL del aviso: derivado del pedido, no hace falta guardarlo. */
export function secretoAviso(idPedido: string): string {
  return createHmac("sha256", `${process.env.AUTH_SECRET ?? ""}|nave-aviso`).update(idPedido).digest("hex").slice(0, 40);
}
export function secretoValido(idPedido: string, dado: string): boolean {
  const bueno = Buffer.from(secretoAviso(idPedido));
  const otro = Buffer.from(String(dado ?? ""));
  return bueno.length === otro.length && timingSafeEqual(bueno, otro);
}
