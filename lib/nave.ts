import { createHmac, timingSafeEqual } from "crypto";

// Nave (Banco Galicia): cobrar con tarjeta en la tienda online (Gonzalo, 18/11).
//
// Nave no publica la documentación de su API: los pasos salen del plugin oficial
// «Nave for WooCommerce» (código abierto, WordPress.org), que hace lo mismo:
//   1. Token: POST al servicio de seguridad con client_id, client_secret y audience.
//   2. Intención de pago: POST {api}/payment_requests/ecommerce → { id, checkout_url }.
//      El cliente paga en checkout_url y vuelve a callback_url.
//   3. Aviso: Nave hace POST a notification_url con { payment_id, payment_check_url }.
//      No viene firmado: se valida con un secreto en la URL y se vuelve a consultar el
//      pago a Nave (GET {api}/payments/{payment_id}) antes de creerle.
//
// Credenciales (las pide Gonzalo a integraciones@navenegocios.com y las carga en Vercel):
//   NAVE_CLIENT_ID, NAVE_CLIENT_SECRET, NAVE_POS_ID y NAVE_ENTORNO («produccion» o «sandbox»).
// Sin las tres primeras, la opción «Tarjeta» no aparece en la tienda.

// Las del portal de desarrolladores de Nave (20/11, Cobros online → Checkout): las
// credenciales nuevas usan la API «integrations». Las del plugin de WooCommerce
// (api-sandbox.ranty.io/api, punku…) devuelven 403 con estas credenciales.
// 24/11: Nave confirmó (SI-357) que en producción el token es «m2msPrivate». El 401 que dio
// era por las credenciales mal pegadas. Queda «m2ms» de respaldo; NAVE_TOKEN_URL la fija a mano.
const URLS = {
  sandbox: {
    token: ["https://homoservices.apinaranja.com/security-ms/api/security/auth0/b2b/m2ms"],
    api: "https://api-sandbox.ranty.io/integrations",
  },
  produccion: {
    token: [
      "https://services.apinaranja.com/security-ms/api/security/auth0/b2b/m2msPrivate",
      "https://services.apinaranja.com/security-ms/api/security/auth0/b2b/m2ms",
    ],
    api: "https://api.ranty.io/integrations",
  },
} as const;
// El que vino con las credenciales de Nave (20/11); si cambia, va en NAVE_AUDIENCE.
// Sin espacios ni comillas alrededor: al copiar de la nota de Nave se pegó el audience entre
// comillas ("https://…") y Nave rechazaba todo con 401 (24/11).
const limpio = (v: string | undefined) => (v ?? "").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
const AUDIENCE = () => limpio(process.env.NAVE_AUDIENCE) || "https://api.ranty.io/integrations";

export function naveConfigurado(): boolean {
  return Boolean(process.env.NAVE_CLIENT_ID && process.env.NAVE_CLIENT_SECRET && process.env.NAVE_POS_ID);
}

/**
 * ¿Los clientes ven «Tarjeta» en la tienda? Solo con las credenciales de
 * producción (19/11: mientras se prueba en sandbox, la opción queda oculta). Para
 * probar, la tienda se abre con ?probar=tarjeta (ver public/tienda/app.js).
 */
export function naveParaClientes(): boolean {
  return naveConfigurado() && process.env.NAVE_ENTORNO === "produccion";
}
function entorno() {
  return process.env.NAVE_ENTORNO === "produccion" ? URLS.produccion : URLS.sandbox;
}

/**
 * Para pagar DENTRO de la tienda (24/11): el módulo de Nave (@ranty/ranty-sdk, el
 * elemento <payfac-sdk>) necesita la clave pública y el entorno. Nave confirmó (SI-357)
 * que en pruebas el entorno es «sandbox». La clave pública no es secreta (va al
 * navegador). Sin NAVE_PUBLIC_KEY se usa la página de pago de Nave, como antes.
 */
export function datosPagoEmbebido(): { clave: string; env: "production" | "sandbox" } | null {
  const clave = limpio(process.env.NAVE_PUBLIC_KEY);
  if (!clave || !naveConfigurado()) return null;
  return { clave, env: process.env.NAVE_ENTORNO === "produccion" ? "production" : "sandbox" };
}

/**
 * Con qué credenciales y contra qué servidor se habla. La tienda online usa las de
 * NAVE_CLIENT_ID; el posnet (Nave Point, 24/11) puede tener las suyas (ver cuentaPosnet).
 */
export type CuentaNave = { clave: string; tokens: readonly string[]; api: string; id: string; secreto: string; tokenFijo?: string };

function cuentaOnline(): CuentaNave {
  const e = entorno();
  return {
    clave: "online",
    tokens: e.token,
    api: e.api,
    id: limpio(process.env.NAVE_CLIENT_ID),
    secreto: limpio(process.env.NAVE_CLIENT_SECRET),
    tokenFijo: process.env.NAVE_TOKEN_URL?.trim() || undefined,
  };
}

// El posnet (Nave Point): la guía de Nave da otro servidor de pruebas (e3-api) que el de la tienda.
const URLS_POSNET = {
  sandbox: {
    token: [
      "https://homoservices.apinaranja.com/security-ms/api/security/auth0/b2b/m2msPrivate",
      "https://homoservices.apinaranja.com/security-ms/api/security/auth0/b2b/m2ms",
    ],
    api: "https://e3-api.ranty.io/integrations",
  },
  produccion: {
    token: ["https://services.apinaranja.com/security-ms/api/security/auth0/b2b/m2msPrivate"],
    api: "https://api.ranty.io/integrations",
  },
} as const;

export type EntornoNave = "produccion" | "sandbox";

/**
 * Las credenciales del posnet: NAVE_POSNET_CLIENT_ID / NAVE_POSNET_CLIENT_SECRET (producción) o
 * NAVE_POSNET_SANDBOX_CLIENT_ID / NAVE_POSNET_SANDBOX_CLIENT_SECRET (pruebas). Si no están, las
 * de la tienda online cuando son del mismo entorno (Nave puede usar las mismas para los dos).
 */
export function cuentaPosnet(e: EntornoNave): CuentaNave | null {
  const pre = e === "sandbox" ? "NAVE_POSNET_SANDBOX" : "NAVE_POSNET";
  const mismasQueOnline = (process.env.NAVE_ENTORNO === "produccion" ? "produccion" : "sandbox") === e;
  const id = limpio(process.env[`${pre}_CLIENT_ID`]) || (mismasQueOnline ? limpio(process.env.NAVE_CLIENT_ID) : "");
  const secreto = limpio(process.env[`${pre}_CLIENT_SECRET`]) || (mismasQueOnline ? limpio(process.env.NAVE_CLIENT_SECRET) : "");
  if (!id || !secreto) return null;
  return { clave: `posnet-${e}`, tokens: URLS_POSNET[e].token, api: URLS_POSNET[e].api, id, secreto };
}

// El token dura ~1 h: se guarda en memoria mientras viva la función (si no, se pide otro).
const tokensGuardados = new Map<string, { valor: string; vence: number }>();

// La dirección del token que funcionó (se prueba esa primero la próxima vez).
const tokenUrlBuena = new Map<string, string>();

async function token(cuenta: CuentaNave, renovar = false): Promise<string> {
  const guardado = tokensGuardados.get(cuenta.clave);
  if (!renovar && guardado && guardado.vence > Date.now()) return guardado.valor;
  const candidatas = cuenta.tokenFijo
    ? [cuenta.tokenFijo]
    : [...new Set([tokenUrlBuena.get(cuenta.clave), ...cuenta.tokens].filter((u): u is string => Boolean(u)))];
  const fallas: string[] = [];
  for (const url of candidatas) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: cuenta.id, client_secret: cuenta.secreto, audience: AUDIENCE() }),
      signal: AbortSignal.timeout(10000),
    });
    const texto = await r.text();
    let j: { access_token?: string; expires_in?: number } = {};
    try { j = JSON.parse(texto); } catch { /* respuesta no JSON */ }
    if (r.ok && j.access_token) {
      tokenUrlBuena.set(cuenta.clave, url);
      const segundos = Math.max(Number(j.expires_in ?? 3600) - 60, 60);
      tokensGuardados.set(cuenta.clave, { valor: j.access_token, vence: Date.now() + segundos * 1000 });
      return j.access_token;
    }
    // Lo que contestó Nave (sin datos secretos: es su mensaje de error) para poder diagnosticar.
    fallas.push(`${url.split("/").pop()} ${r.status} ${texto.slice(0, 160)}`);
  }
  throw new Error(`Nave no dio el token: ${fallas.join(" | ")}`);
}

async function pedir<T>(url: string, init: { method: "GET" | "POST" | "DELETE"; body?: unknown }, cuenta: CuentaNave = cuentaOnline()): Promise<T> {
  for (let intento = 0; intento < 2; intento++) {
    const r = await fetch(url, {
      method: init.method,
      headers: { Authorization: `Bearer ${await token(cuenta, intento > 0)}`, "Content-Type": "application/json", Accept: "application/json" },
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
  const r = await pedir<{ id?: string; checkout_url?: string }>(`${entorno().api}/payment_requests/ecommerce`, {
    method: "POST",
    body: {
      external_payment_id: p.referencia,
      seller: { pos_id: limpio(process.env.NAVE_POS_ID) },
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
export async function consultarPagoNave(
  idPago: string,
  cuenta: CuentaNave = cuentaOnline()
): Promise<{ estado: EstadoPagoNave; crudo: string; forma: "POSNET_DEBITO" | "POSNET_CREDITO" | null; datos: Record<string, unknown> }> {
  const d = await pedir<Record<string, unknown>>(`${cuenta.api}/payments/${encodeURIComponent(idPago)}`, { method: "GET" }, cuenta);
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
export async function consultarPedidoNave(
  idPedidoNave: string,
  cuenta: CuentaNave = cuentaOnline()
): Promise<{ estado: string; idPago: string | null; ultimoIntento: string | null }> {
  const d = await pedir<Record<string, unknown>>(`${cuenta.api}/payment_requests/${encodeURIComponent(idPedidoNave)}`, { method: "GET" }, cuenta);
  const estado = String((d.status as { name?: string } | undefined)?.name ?? "").toUpperCase();
  // El id del pago puede venir en distintos lugares. La guía del posnet (24/11) lo pone en
  // payment_attempts.payments: ahí puede haber varios intentos; vale el último.
  const intentos = (d.payment_attempts as { payments?: { payment_id?: string; status?: string }[] } | undefined)?.payments ?? [];
  const ultimo = intentos[intentos.length - 1];
  const pagos = (d.payments ?? (d.transactions as { payments?: unknown }[] | undefined)?.[0]?.payments) as { id?: string; payment_id?: string }[] | undefined;
  const idPago = (d.payment_id as string | undefined) ?? ultimo?.payment_id ?? pagos?.[0]?.payment_id ?? pagos?.[0]?.id ?? null;
  return { estado, idPago, ultimoIntento: ultimo?.status ? String(ultimo.status).toUpperCase() : null };
}

// ===== Posnet (Nave Point) conectado a la caja (24/11) =====
// La caja manda el monto al posnet (POST /payment_requests/smart_pos), el cliente paga en el
// aparato y Nave avisa a /api/nave/posnet/aviso. La caja además pregunta cada pocos segundos
// mientras espera. Nunca se le cree al aviso: se consulta el pago (ver lib/navePosnet.ts).

/** Manda el cobro al posnet. Devuelve el id de la intención de pago. */
export async function crearCobroPosnet(
  cuenta: CuentaNave,
  p: { posId: string; referencia: string; total: number; descripcion: string; segundos: number }
): Promise<string> {
  const r = await pedir<{ id?: string }>(
    `${cuenta.api}/payment_requests/smart_pos`,
    {
      method: "POST",
      body: {
        external_payment_id: p.referencia.slice(0, 36),
        seller: { pos_id: p.posId },
        // Un solo renglón por el total: con descuentos, puntos o combos la suma de los
        // productos no da el total, y el posnet cobra lo que dice «amount».
        transactions: [
          {
            amount: { currency: "ARS", value: plata(p.total) },
            products: [{ name: p.descripcion.slice(0, 120), description: p.descripcion.slice(0, 120), quantity: 1, unit_price: { currency: "ARS", value: plata(p.total) } }],
          },
        ],
        duration_time: p.segundos,
      },
    },
    cuenta
  );
  if (!r.id) throw new Error("Nave no devolvió el cobro del posnet");
  return r.id;
}

/** Saca el cobro del posnet (si el cliente se arrepiente o se cambia de medio). */
export async function cancelarCobroPosnet(cuenta: CuentaNave, idCobro: string): Promise<void> {
  await pedir(
    `${cuenta.api}/payment_requests/${encodeURIComponent(idCobro)}`,
    { method: "DELETE", body: { reason: { code: "disabled_from_saas", description: "Cancelado desde la caja de WiiGo" } } },
    cuenta
  );
}

const MOTIVOS_RECHAZO: [RegExp, string][] = [
  [/no_amount_available|error_of_debit/, "La tarjeta no tiene fondos suficientes."],
  [/expired|expiry/, "La tarjeta está vencida."],
  [/exceeds_amount_limit/, "El monto supera el límite de la tarjeta."],
  [/invalid_card_type/, "Ese tipo de tarjeta no se acepta acá."],
  [/blocked_by_cardholder|restricted_card/, "La tarjeta está bloqueada o tiene restricciones."],
  [/cvv/, "El código de seguridad de la tarjeta es incorrecto."],
  [/fraud|risky|security/, "El banco la rechazó por seguridad."],
  [/gateway|not_available|alert_sent|service/, "Nave no pudo hablar con el banco. Probá de nuevo."],
];

/** El motivo de un rechazo, en castellano (los códigos son los de la guía de Nave). */
export function motivoRechazoNave(datos: Record<string, unknown>): string {
  const codigo = String((datos.status as { reason_code?: string } | undefined)?.reason_code ?? "").toLowerCase();
  return MOTIVOS_RECHAZO.find(([re]) => re.test(codigo))?.[1] ?? "El banco rechazó la tarjeta.";
}

/** Lo que se anota del pago: «Visa débito ···0011 · 1 cuota · cupón 11 · lote 168». */
export function detallePagoPosnet(datos: Record<string, unknown>): { texto: string; cupon: string | null } {
  const m = (datos.payment_method ?? {}) as { card_brand?: string; card_type?: string; card_last4?: string; installment_plan?: { installments?: number } };
  const ticket = ((datos.transactions as { auth_data?: { ticket?: { number?: string; batch?: string } } }[] | undefined)?.[0]?.auth_data?.ticket) ?? {};
  const marca = m.card_brand ? m.card_brand.charAt(0) + m.card_brand.slice(1).toLowerCase() : "Tarjeta";
  const tipo = /DEBIT/i.test(m.card_type ?? "") ? " débito" : /CREDIT/i.test(m.card_type ?? "") ? " crédito" : "";
  const cuotas = Number(m.installment_plan?.installments ?? 0);
  const partes = [`${marca}${tipo}${m.card_last4 ? ` ···${m.card_last4}` : ""}`];
  if (cuotas > 1) partes.push(`${cuotas} cuotas`);
  const cupon = ticket.number ? String(ticket.number) : null;
  if (cupon) partes.push(`cupón ${cupon}${ticket.batch ? ` · lote ${ticket.batch}` : ""}`);
  return { texto: partes.join(" · "), cupon };
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
