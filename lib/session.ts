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
};

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
  const payloadB64 = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
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
    return JSON.parse(json) as SessionPayload;
  } catch {
    return null;
  }
}
