import { createHash } from "crypto";

/**
 * Diagnóstico de las credenciales de Nave (24/11): prueba pedir el token en producción y en
 * sandbox y devuelve SOLO cómo contestó Nave (código y mensaje) y una huella corta de cada
 * valor (largo y 6 caracteres de un hash: no permite reconstruir nada). Nunca devuelve claves.
 * Sirve para saber si lo cargado en Vercel son credenciales de producción, de sandbox o
 * ninguna, sin hacer una compra. GET /api/tienda/nave/diagnostico
 */
export const dynamic = "force-dynamic";

const TOKEN = {
  produccion_m2msPrivate: "https://services.apinaranja.com/security-ms/api/security/auth0/b2b/m2msPrivate",
  produccion_m2ms: "https://services.apinaranja.com/security-ms/api/security/auth0/b2b/m2ms",
  sandbox_m2ms: "https://homoservices.apinaranja.com/security-ms/api/security/auth0/b2b/m2ms",
};

// Caracteres raros que suelen meter los programas al copiar: comillas curvas, guiones largos,
// espacio duro, espacio invisible y saltos de línea especiales.
const RAROS = [0x201c, 0x201d, 0x2018, 0x2019, 0x2013, 0x2014, 0x00a0, 0x200b, 0x2028, 0x2029];

function huella(v: string | undefined) {
  if (!v) return { cargada: false };
  const limpio = v.trim();
  return {
    cargada: true,
    largo: limpio.length,
    espaciosAfuera: v.length !== limpio.length,
    raros: [...v].some((c) => RAROS.includes(c.codePointAt(0) ?? 0)),
    hash: createHash("sha256").update(limpio).digest("hex").slice(0, 6),
  };
}

export async function GET() {
  const id = process.env.NAVE_CLIENT_ID?.trim();
  const secret = process.env.NAVE_CLIENT_SECRET?.trim();
  const audience = process.env.NAVE_AUDIENCE?.trim() || "https://api.ranty.io/integrations";
  const resultados: Record<string, string> = {};
  for (const [nombre, url] of Object.entries(TOKEN)) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: id, client_secret: secret, audience }),
        signal: AbortSignal.timeout(10000),
      });
      const texto = await r.text();
      resultados[nombre] = r.ok && /access_token/.test(texto) ? `${r.status} OK (token recibido)` : `${r.status} ${texto.slice(0, 120)}`;
    } catch (e) {
      resultados[nombre] = `error de conexión: ${(e as Error).message}`;
    }
  }
  return Response.json(
    {
      entorno: process.env.NAVE_ENTORNO ?? null,
      audience,
      client_id: huella(process.env.NAVE_CLIENT_ID),
      client_secret: huella(process.env.NAVE_CLIENT_SECRET),
      public_key: huella(process.env.NAVE_PUBLIC_KEY),
      pos_id: huella(process.env.NAVE_POS_ID),
      resultados,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
