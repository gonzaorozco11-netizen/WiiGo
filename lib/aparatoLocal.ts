// La tablet del local (Gonzalo, 2026-11-16): los operativos marcaban la
// llegada desde el celular, sin estar en el local. Ahora el sistema interno
// para ellos se usa SOLO en un aparato registrado como «del local».
//
// Cómo funciona:
//   - El Dueño, desde la tablet y con su usuario, entra a «Aparatos del local»
//     y la registra. La tablet guarda una cookie firmada (wiigo_aparato) que
//     sobrevive al cerrar sesión: después los chicos entran con su usuario de
//     siempre. La cookie es httpOnly: no se ve ni se copia desde la pantalla.
//   - Un operativo en otro aparato (su celular) solo puede abrir lo de la lista
//     RUTAS_EN_EL_CELULAR (mirar la góndola, sus recibos, Aprender). Fichar,
//     caja, ventas, cobros y todo lo demás lo manda a /solo-tablet.
//   - El Dueño, las marcas y las profesionales entran desde cualquier lado.
//
// La firma usa una clave derivada (no la de la sesión), así una cookie de un
// lado nunca sirve para el otro. Sin imports de Supabase a propósito: lo usa
// proxy.ts, que corre en Edge.
import { toHex, fromHex, bytesToBase64Url, base64UrlToBytes } from "./crypto";

export const COOKIE_APARATO = "wiigo_aparato";
// Chrome no guarda una cookie más de 400 días: el proxy la renueva sola cuando
// tiene más de RENOVAR_CADA_MS, así una tablet que se usa nunca se cae.
export const DURACION_APARATO_S = 400 * 24 * 60 * 60;
export const RENOVAR_CADA_MS = 30 * 24 * 60 * 60 * 1000;

export type Aparato = { id: string; nombre: string; iat: number };

/** Lo único que un operativo puede abrir fuera de la tablet. */
const RUTAS_EN_EL_CELULAR = ["/gondola", "/mis-recibos", "/aprender", "/solo-tablet"];

export function sePuedeEnElCelular(pathname: string): boolean {
  return RUTAS_EN_EL_CELULAR.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/** Quién queda atado a la tablet: el equipo interno salvo el Dueño. */
export function rolAtadoALaTablet(rol: string | null | undefined): boolean {
  const r = rol ?? "";
  return r === "operativo" || r === "";
}

async function clave(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(`${secret}|aparato-local-v1`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function firmarAparato(aparato: { id: string; nombre: string }, secret: string): Promise<string> {
  const datos: Aparato = { id: aparato.id, nombre: aparato.nombre, iat: Date.now() };
  const b64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(datos)));
  const firma = await crypto.subtle.sign("HMAC", await clave(secret), new TextEncoder().encode(b64));
  return `a1.${b64}.${toHex(firma)}`;
}

export async function leerAparato(token: string | undefined, secret: string): Promise<Aparato | null> {
  if (!token || !secret) return null;
  const [version, b64, firma] = token.split(".");
  if (version !== "a1" || !b64 || !firma || !/^[0-9a-f]+$/.test(firma) || firma.length % 2) return null;
  const ok = await crypto.subtle.verify("HMAC", await clave(secret), fromHex(firma), new TextEncoder().encode(b64)).catch(() => false);
  if (!ok) return null;
  try {
    const datos = JSON.parse(new TextDecoder().decode(base64UrlToBytes(b64))) as Aparato;
    return typeof datos?.id === "string" && typeof datos?.iat === "number" ? datos : null;
  } catch {
    return null;
  }
}

export const opcionesCookieAparato = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: DURACION_APARATO_S,
};
