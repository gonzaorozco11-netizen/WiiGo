/**
 * El rótulo de lo que fraccionamos nosotros: peso, fechas, lote y alérgenos.
 *
 * Lo usan la etiqueta de la bolsita (Códigos de barras) y el cartel de góndola
 * (peso y precio por kilo). Sin dependencias de servidor: corre en los dos lados.
 */

export const PIE_ETIQUETA_DEFECTO = "WiiGo\nEstaciones de Bienestar\nArístides Villanueva 256\nMendoza";

/**
 * Cuánto dura un producto fraccionado en bolsa kraft con cierre, cuando no
 * tiene sus días cargados. Son valores prudentes y orientativos: el que manda
 * es el proveedor (la ficha técnica o la bolsa grande). La pantalla avisa
 * cuáles salen con este valor para que se carguen los reales.
 *
 * El orden importa: gana la primera regla que coincide, así "harina de coco"
 * cae en harinas integrales antes que en coco, y "mix" no se confunde con las
 * nueces que trae adentro.
 */
const DURACIONES: { claves: string[]; dias: number; tipo: string }[] = [
  { claves: ["harina integral", "integral fina", "harina de coco", "salvado", "germen"], dias: 90, tipo: "harinas integrales" },
  { claves: ["coco"], dias: 90, tipo: "coco" },
  { claves: ["harina", "fecula", "semola", "almidon", "premezcla"], dias: 180, tipo: "harinas" },
  { claves: ["poroto", "lenteja", "garbanzo", "arveja", "lupin", "trigo", "mung", "soja"], dias: 365, tipo: "legumbres" },
  { claves: ["mix"], dias: 180, tipo: "mix" },
  { claves: ["nuez", "nueces", "pecan", "avellana"], dias: 120, tipo: "nueces y avellanas" },
  { claves: ["chia", "lino", "sesamo", "girasol", "zapallo", "amapola", "amaranto", "quinoa real"], dias: 270, tipo: "semillas" },
  { claves: ["granola", "cereal", "aritos", "almohad", "copos", "pop", "inflad", "hebras", "granix", "avena"], dias: 150, tipo: "cereales y granolas" },
];
const DURACION_GENERAL = { dias: 180, tipo: "general" };

function normalizar(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** La duración sugerida para un producto, según su nombre. */
export function duracionSugerida(nombre: string): { dias: number; tipo: string } {
  const n = normalizar(nombre);
  const regla = DURACIONES.find((r) => r.claves.some((c) => n.includes(c)));
  return regla ? { dias: regla.dias, tipo: regla.tipo } : DURACION_GENERAL;
}

/** "2026-10-23" → Date al mediodía, para que ningún huso horario corra el día. */
function fechaLocal(iso: string) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, (m ?? 1) - 1, d ?? 1, 12);
}

function aIso(f: Date) {
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}

/**
 * El vencimiento de la bolsita: envasado + los días que dura, pero nunca
 * después del vencimiento de la bolsa grande de donde salió.
 */
export function calcularVencimiento(envasado: string, dias: number, venceBolsaGrande: string | null): string {
  const f = fechaLocal(envasado);
  f.setDate(f.getDate() + dias);
  const propio = aIso(f);
  return venceBolsaGrande && venceBolsaGrande < propio ? venceBolsaGrande : propio;
}

/** "2026-10-23" → "23/10/26". */
export function fechaCorta(iso: string) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

/** El lote es la fecha de envasado: "2026-10-23" → "231026". */
export function loteDe(envasado: string) {
  const [a, m, d] = envasado.split("-");
  return `${d}${m}${a.slice(2)}`;
}

/** 250 → "250 g"; 1000 → "1 kg"; 1500 → "1,5 kg". */
export function pesoTexto(gramos: number) {
  if (gramos >= 1000) return `${(gramos / 1000).toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg`;
  return `${gramos.toLocaleString("es-AR", { maximumFractionDigits: 1 })} g`;
}

/** Lo que sale el kilo, redondeado al peso. */
export function precioPorKilo(precio: number, gramos: number) {
  return Math.round((precio * 1000) / gramos);
}
