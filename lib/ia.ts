// Conexión con la inteligencia artificial (Claude, de Anthropic).
//
// Se usa para escribir las explicaciones de Aprender y para la Junta. Necesita la variable
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
 * Las instrucciones pueden ir en partes: las que se marcan `fija` se guardan
 * un rato del lado de Anthropic y las consultas siguientes que empiezan igual
 * las cobran mucho más barato (la Junta manda los mismos datos del negocio a
 * los seis encargados). Lo fijo tiene que ir primero.
 */
export type ParteSistema = { texto: string; fija?: boolean };

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Le pide a Claude una respuesta y devuelve el texto tal cual.
 * Si Anthropic está saturado o se pasó el límite por minuto de la cuenta
 * (429/529), espera y prueba hasta dos veces más: con varias consultas
 * seguidas, como la Junta, pasa en las cuentas nuevas.
 */
export async function pedirTexto(sistema: string | ParteSistema[], pedido: string, maxTokens = 2000): Promise<string> {
  const clave = process.env.ANTHROPIC_API_KEY;
  if (!clave) throw new SinClaveIA();

  const system =
    typeof sistema === "string"
      ? sistema
      : sistema.map((p) => ({ type: "text", text: p.texto, ...(p.fija ? { cache_control: { type: "ephemeral" } } : {}) }));

  for (let intento = 1; ; intento++) {
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
        system,
        messages: [{ role: "user", content: pedido }],
      }),
    });
    if (respuesta.ok) {
      const datos = (await respuesta.json()) as { content?: { type: string; text?: string }[] };
      return (datos.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("");
    }
    const texto = await respuesta.text().catch(() => "");
    if ((respuesta.status === 429 || respuesta.status === 529) && intento < 3) {
      const pide = Number(respuesta.headers.get("retry-after"));
      await esperar(Number.isFinite(pide) && pide > 0 ? Math.min(pide, 20) * 1000 : intento * 4000);
      continue;
    }
    console.error(`[ia] Anthropic respondió ${respuesta.status}: ${texto.slice(0, 500)}`);
    if (respuesta.status === 401) throw new Error("La clave de la inteligencia artificial no es válida. Revisá ANTHROPIC_API_KEY en Vercel.");
    if (respuesta.status === 429) throw new Error("La inteligencia artificial está ocupada. Probá de nuevo en un minuto.");
    if (/credit balance/i.test(texto)) throw new Error("La cuenta de Anthropic se quedó sin crédito.");
    throw new Error(`La inteligencia artificial respondió con un error (${respuesta.status}). ${texto.slice(0, 200)}`);
  }
}

/**
 * Le pide a Claude una respuesta en JSON y la devuelve ya leída.
 * El pedido incluye cómo tiene que ser el JSON; acá solo se extrae y se parsea.
 */
export async function pedirJson(sistema: string | ParteSistema[], pedido: string, maxTokens = 2000): Promise<unknown> {
  const texto = await pedirTexto(sistema, pedido, maxTokens);
  // El JSON puede venir solo o entre ```json ... ```: se toma del primer { al último }.
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) throw new Error("La inteligencia artificial no devolvió una respuesta que se pueda leer.");
  return JSON.parse(texto.slice(inicio, fin + 1));
}
