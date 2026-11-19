// Firma y verifica la cookie de sesión con HMAC-SHA256 (Web Crypto),
// compatible con runtime Node (Server Actions) y runtime Edge (proxy.ts).
// A diferencia de un token "todo o nada", acá el payload lleva quién es el
// usuario y su rol, para poder mostrar/ocultar pantallas más adelante.

import { toHex, fromHex, bytesToBase64Url, base64UrlToBytes } from "./crypto";

export const SESSION_COOKIE = "wiigo_session";

export type SessionPayload = {
  sub: string; // id_usuario
  nombre: string;
  rol: string;
  /** Cuándo entró (segundos). Sirve para «Cerrar sesión en todos los aparatos». */
  iat?: number;
  /** Hasta cuándo vale (segundos). */
  exp?: number;
};

// La sesión vence sola a los 30 días (seguridad, 19/11): una cookie robada no sirve para siempre.
export const DURACION_SESION_S = 60 * 60 * 24 * 30;
// Las sesiones de antes no tenían vencimiento: valen hasta esta fecha y después hay que volver a entrar.
const VIEJAS_VALEN_HASTA_S = Date.parse("2026-12-20T03:00:00Z") / 1000;

async function getKey(secret: string) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSessionToken(payload: SessionPayload, secret: string) {
  const key = await getKey(secret);
  const enc = new TextEncoder();
  const ahora = Math.floor(Date.now() / 1000);
  const conFechas: SessionPayload = { ...payload, iat: payload.iat ?? ahora, exp: payload.exp ?? ahora + DURACION_SESION_S };
  const payloadB64 = bytesToBase64Url(enc.encode(JSON.stringify(conFechas)));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  return `${payloadB64}.${toHex(sig)}`;
}

export async function readSessionToken(
  token: string | undefined,
  secret: string
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [payloadB64, sigHex] = token.split(".");
  if (!payloadB64 || !sigHex) return null;

  const key = await getKey(secret);
  const enc = new TextEncoder();
  const valid = await crypto.subtle
    .verify("HMAC", key, fromHex(sigHex), enc.encode(payloadB64))
    .catch(() => false);
  if (!valid) return null;

  try {
    const json = new TextDecoder().decode(base64UrlToBytes(payloadB64));
    const p = JSON.parse(json) as SessionPayload;
    const ahora = Date.now() / 1000;
    if (typeof p.exp === "number" ? ahora > p.exp : ahora > VIEJAS_VALEN_HASTA_S) return null;
    return p;
  } catch {
    return null;
  }
}
