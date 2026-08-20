// Hash y verificación de contraseñas con PBKDF2-HMAC-SHA256 (Web Crypto).
// Formato guardado en usuarios.password_hash: "pbkdf2$<iteraciones>$<salt hex>$<hash hex>"

import { toHex, fromHex } from "./crypto";

const ITERATIONS = 100000;
const KEY_LENGTH_BYTES = 32;

async function deriveBits(password: string, salt: Uint8Array, iterations: number) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_LENGTH_BYTES * 8
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveBits(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const iterations = Number(parts[1]);
  const salt = fromHex(parts[2]);
  const expectedHex = parts[3];
  if (!iterations || !salt.length || !expectedHex) return false;

  const hash = await deriveBits(password, salt, iterations);
  return toHex(hash) === expectedHex;
}
