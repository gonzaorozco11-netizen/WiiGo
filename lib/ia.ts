// Conexión con la inteligencia artificial (Claude, de Anthropic).
//
// Se usa para escribir las explicaciones de Aprender. Necesita la variable
// de entorno ANTHROPIC_API_KEY (se crea en console.anthropic.com y se carga
// en Vercel → Settings → Environment Variables). Sin la clave, todo lo demás
// del sistema funciona igual: solo no se escriben explicaciones nuevas.
//
// Server-only: la clave nunca llega al navegador.

const MODELO = "claude-sonnet-5-5";
const URL_API = "https://api.anthropic.com/v1/messages";

export function hayClaveIA() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export class SinClaveIA extends Error {
  constructor() {
    super("Falta conectar la inteligencia artificial: cargá ANTHROPIC_API_KEY en Vercel.");
  }
}

/**
 * Le pide a Claude una respuesta en JSON y la devuelve ya leída.
 * El pedido incluye cómo tiene que ser el JSON; acá solo se extrae y se parsea.
 */
export async function pedirJson(sistema: string, pedido: string, maxTokens = 2000): Promise<unknown> {
  const clave = process.env.ANTHROPIC_API_KEY;
  if (!clave) throw new SinClaveIA();

  const respuesta = await fetch(URL_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": clave,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: maxTokens,
      system: sistema,
      messages: [{ role: "user", content: pedido }],
    }),
  });
  if (!respuesta.ok) {
    const texto = await respuesta.text().catch(() => "");
    if (respuesta.status === 401) throw new Error("La clave de la inteligencia artificial no es válida. Revisá ANTHROPIC_API_KEY en Vercel.");
    if (respuesta.status === 429) throw new Error("La inteligencia artificial está ocupada. Probá de nuevo en un minuto.");
    throw new Error(`La inteligencia artificial respondió con un error (${respuesta.status}). ${texto.slice(0, 200)}`);
  }
  const datos = (await respuesta.json()) as { content?: { type: string; text?: string }[] };
  const texto = (datos.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
  // El JSON puede venir solo o entre ```json ... ```: se toma del primer { al último }.
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) throw new Error("La inteligencia artificial no devolvió una respuesta que se pueda leer.");
  return JSON.parse(texto.slice(inicio, fin + 1));
}
