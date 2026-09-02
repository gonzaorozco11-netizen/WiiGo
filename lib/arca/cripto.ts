import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// La clave privada del certificado de ARCA se guarda en la base, pero
// CIFRADA. Motivo: quien tenga esa clave puede emitir facturas a nombre de la
// empresa, así que un acceso indebido a la base de datos no debería alcanzar
// para robarla — hace falta además la llave de cifrado, que vive solo en las
// variables de entorno del servidor (nunca en la base ni en el repositorio).
//
// Se reutiliza AUTH_SECRET, que ya existe y nunca sale del servidor. Si algún
// día se rota ese secreto, hay que volver a generar el certificado.

function llave() {
  const secreto = process.env.AUTH_SECRET;
  if (!secreto) throw new Error("Falta AUTH_SECRET: no se puede cifrar la clave privada de ARCA.");
  // AES-256 necesita exactamente 32 bytes; el hash los garantiza.
  return createHash("sha256").update(secreto).digest();
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", llave(), iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv:tag:datos — el tag detecta si alguien modificó el contenido.
  return `${iv.toString("base64")}:${tag.toString("base64")}:${cifrado.toString("base64")}`;
}

export function descifrar(guardado: string): string {
  const [ivB64, tagB64, datosB64] = guardado.split(":");
  if (!ivB64 || !tagB64 || !datosB64) throw new Error("La clave privada guardada está corrupta.");
  const decipher = createDecipheriv("aes-256-gcm", llave(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(datosB64, "base64")), decipher.final()]).toString("utf8");
}
