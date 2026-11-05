// La competencia de Mendoza al lado de cada producto de WiiGo Dietética
// (Gonzalo, 2026-10-29: "no quiero completar nada a mano", "siempre Mendoza").
// Sin imports de servidor: lo usan la lectura semanal y la pantalla.
//
// Comercios: Bela Vita (dietética, fraccionado), Regio Mendoza (por kilo),
// Mardegan (mix y especias) y Jumbo, la sucursal de Mendoza. Cada precio se
// lleva al tamaño de WiiGo: si ellos venden 100 g y WiiGo 250 g, se multiplica.

export type Comercio = "BELAVITA" | "MEGANUTS" | "REGIO" | "MARDEGAN" | "JUMBO" | "ALIFRUT" | "SABORYGRAN";

// Bela Vita y Regio Mendoza se sacaron el 2026-11-04 (Gonzalo: «sacalos de
// competencia»): ya no se leen ni se muestran. Siguen en el tipo Comercio
// porque quedan filas viejas en la base; cargarCompetencia las ignora.
// La comparación principal pasó a Sabor y Gran, la dietética que fracciona.
export const COMERCIOS: { clave: Comercio; nombre: string; tipo: string; principal?: boolean }[] = [
  { clave: "MEGANUTS", nombre: "Mega Nuts", tipo: "frutos secos · de 500 g a 5 kg" },
  { clave: "MARDEGAN", nombre: "Mardegan", tipo: "mix y especias" },
  { clave: "JUMBO", nombre: "Jumbo Mendoza", tipo: "súper · sucursal Mendoza" },
  // Su lista al público, no la exclusiva de Gonzalo: lo que paga cualquiera que le compra (Gonzalo, 2026-10-29).
  { clave: "ALIFRUT", nombre: "Alifrut (público)", tipo: "mayorista · precio al público, por kilo" },
  // Dietética mendocina (Gonzalo, 2026-11-04). En la Lista de precios va al lado de Alifrut, solo lo confirmado.
  { clave: "SABORYGRAN", nombre: "Sabor y Gran", tipo: "dietética · paquetes de 100 g a 1 kg", principal: true },
];

export type ItemCompetencia = {
  id: string;
  comercio: Comercio;
  nombre: string;
  /** Lo que trae, en gramos. null = no se sabe (no se puede comparar). */
  gramos: number | null;
  porKilo: boolean;
  /** El precio de hoy: si está en oferta, el de la oferta. */
  precio: number;
  /** El precio normal cuando está en oferta; null si no hay oferta. */
  precioAntes: number | null;
  /** Por qué la oferta, si lo publican ("VENCE 4 NOV"). */
  nota: string | null;
  /** La página del producto en su tienda, para verificar que sea el mismo. null = todavía no se leyó. */
  url: string | null;
  disponible: boolean;
  vistoEl: string;
};

/**
 * El precio normal llevado al tamaño de WiiGo. Contra este se compara: una
 * oferta puede ser mercadería por vencer (Gonzalo, 2026-10-29), así que se
 * muestra aparte, como referencia.
 */
export function precioNormalATuTamano(item: Pick<ItemCompetencia, "precio" | "precioAntes" | "gramos">, gramos: number): number | null {
  return precioATuTamano({ precio: item.precioAntes ?? item.precio, gramos: item.gramos }, gramos);
}

/** Gramos que dice un nombre: "X100GRS", "x 250 g", "1 Kg", "x 1,5 kg". */
export function gramosDelNombre(nombre: string): number | null {
  const m = /(?:^|[\sx×(])\s*([\d]+(?:[.,]\d+)?)\s*(kg|kgs|kilo|kilos|gr|grs|g|gramos)\b/i.exec(nombre);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return /^k/i.test(m[2]) ? Math.round(n * 1000) : Math.round(n);
}

/** Lo que salen `gramos` de WiiGo con el precio del otro. */
export function precioATuTamano(item: Pick<ItemCompetencia, "precio" | "gramos">, gramos: number): number | null {
  return item.gramos && item.gramos > 0 ? (item.precio / item.gramos) * gramos : null;
}

// ---------- Emparejar: qué producto de ellos es el equivalente ----------

const VACIAS = new Set(["x", "de", "del", "la", "el", "los", "las", "y", "en", "por", "a", "al", "gr", "grs", "g", "kg", "kgs", "un", "u", "premium", "tipo", "natural", "belavita", "bolsa", "granel", "suelto", "sueltas", "sueltos"]);
// Palabras que cambian el producto: con una sí y la otra no, no es el mismo.
const DECISIVAS = [["con", "sal"], ["sin", "sal"]];
// Variedades que se excluyen: pasas negras no son rubias (Jumbo proponía "pasas rubias" para las negras).
// Coco en escamas no es coco rallado (Sabor y Gran, 2026-11-05).
// Nuez de Brasil no es nuez Chandler; las almohaditas de un gusto no son las de otro.
const EXCLUYENTES = [["negra", "rubia"], ["escama", "rallado"], ["brasil", "chandler"], ["salvado", "frutilla", "limon", "avellana", "choco", "dulce"], ["clasico", "tropical", "europeo", "energetico", "semilla"]];
// Lo que cambia qué producto es: "harina de almendras" no son almendras, ni
// "aceite de coco" es coco. Si una de las dos lo dice y la otra no, no es el mismo
// (Sabor y Gran proponía harina de almendras para las almendras enteras, 2026-11-05).
const FORMAS = ["harina", "aceite", "manteca", "pasta", "leche", "crema", "galletita", "galleta", "barra", "barrita", "bebida", "mermelada", "salsa", "garrapinada", "japon", "saborizado", "molida", "molido", "polvo", "caramelo", "moscada"];
// La primera palabra sola no dice qué es: "mix clásico" no es "mix cervecero".
// Para estos tiene que coincidir, además, al menos otra palabra (2026-11-05).
const GENERICAS = new Set(["mix", "granola", "almohadita", "nuez"]);
const SINONIMOS: Record<string, string> = {
  nueces: "nuez", almendras: "almendra", castanas: "caju", castana: "caju", cajus: "caju", avellanas: "avellana",
  datiles: "datil", pasas: "pasa", morochas: "negra", morocha: "negra", negras: "negra", rubias: "rubia",
  bananitas: "banana", bananas: "banana", chip: "chips", arandanos: "arandano", mani: "mani", manies: "mani",
  instantanea: "instantanea", copos: "copo", semillas: "semilla", harinas: "harina", granolas: "granola",
};

export function normalizarTexto(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // "X250GRS" → "x 250 grs": el tamaño pegado al nombre se separa.
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    // "MANI C/SAL", "S/CAROZO", "Maní salado": se leen igual que "con sal" / "sin …".
    .replace(/\bc\s*\/\s*/g, "con ")
    .replace(/\bs\s*\/\s*/g, "sin ")
    .replace(/\bsalad[oa]s?\b/g, "con sal")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function palabras(nombre: string): string[] {
  return normalizarTexto(nombre)
    .replace(/\b\d+([.,]\d+)?\s*(kg|kgs|gr|grs|g|gramos)\b/g, " ")
    .split(" ")
    .filter((w) => w && !VACIAS.has(w) && !/^\d+$/.test(w))
    .map((w) => SINONIMOS[w] ?? raiz(w));
}

/**
 * Singular y plural iguales: "tomates" y "tomate" → "tomat"; "frutales" y
 * "frutal" → "frutal". Antes se sacaba solo "es"/"s", y "tomates" quedaba
 * "tomat" contra "tomate": Sabor y Gran no aparecía para los tomates (2026-11-04).
 */
function raiz(w: string) {
  return w.length > 4 ? w.replace(/(es|s|e)$/, "") : w;
}

function tieneFrase(texto: string, frase: string[]) {
  return new RegExp(`\\b${frase.join("\\s+")}\\b`).test(texto);
}

/**
 * Qué tan parecido es su producto al de WiiGo (0 a 1). La primera palabra del
 * nombre de WiiGo ("almendra", "nuez", "mani") tiene que estar sí o sí.
 */
export function parecido(nuestro: string, suyo: string): number {
  const a = palabras(nuestro);
  const b = new Set(palabras(suyo));
  if (a.length === 0 || !b.has(a[0])) return 0;
  const ta = normalizarTexto(nuestro);
  const tb = normalizarTexto(suyo);
  for (const f of DECISIVAS) if (tieneFrase(ta, f) !== tieneFrase(tb, f) && (tieneFrase(ta, f) || tieneFrase(tb, f))) return 0;
  for (const grupo of EXCLUYENTES) {
    const nuestra = grupo.find((w) => a.includes(w));
    const suya = grupo.find((w) => b.has(w));
    if (nuestra && suya && nuestra !== suya) return 0;
  }
  const forma = (lista: Iterable<string>) => new Set([...lista].filter((w) => FORMAS.some((f) => w.startsWith(f))).map((w) => FORMAS.find((f) => w.startsWith(f))));
  const fa = forma(a);
  const fb = forma(b);
  if (fa.size !== fb.size || [...fa].some((f) => !fb.has(f))) return 0;
  const comunes = a.filter((w) => b.has(w)).length;
  if (GENERICAS.has(a[0]) && a.length > 1 && comunes < 2) return 0;
  return comunes / new Set([...a, ...b]).size + 0.5 * (comunes / a.length);
}

/**
 * El mejor candidato de un comercio para un producto de WiiGo: el más parecido
 * y, a igual parecido, el del tamaño más cercano (en una dietética, 250 g
 * contra 250 g). Los que Gonzalo ya rechazó no se vuelven a proponer.
 */
export function mejorCandidato(
  nuestro: { nombre: string; gramos: number | null },
  items: ItemCompetencia[],
  rechazados: string[] = []
): ItemCompetencia | null {
  let mejor: { it: ItemCompetencia; puntos: number } | null = null;
  for (const it of items) {
    if (rechazados.includes(it.id) || !it.gramos) continue;
    const p = parecido(nuestro.nombre, it.nombre);
    if (p < 0.45) continue;
    const tamano = nuestro.gramos ? Math.abs(Math.log(it.gramos / nuestro.gramos)) : 0;
    const puntos = p - 0.08 * tamano + (it.disponible ? 0.05 : 0);
    if (!mejor || puntos > mejor.puntos) mejor = { it, puntos };
  }
  return mejor?.it ?? null;
}

/** Diferencia de WiiGo contra un precio (0.12 = 12 % más caro). */
export function diferencia(nuestro: number, suyo: number | null) {
  return suyo && suyo > 0 ? nuestro / suyo - 1 : null;
}
