/**
 * Dibuja un código de barras Code 128.
 *
 * Por qué Code 128 y no EAN-13: nuestros códigos internos tienen 11 dígitos y
 * un EAN tiene que tener 13 exactos. Convertirlos obligaría a agregarles
 * dígitos, y entonces lo que devuelve el lector ya no sería igual a lo que está
 * guardado en la base — el tótem escanearía y no encontraría nada. Code 128
 * acepta cualquier largo y devuelve el número tal cual, que es justo lo que
 * hace falta. Lo leen todos los lectores de tienda.
 *
 * Sin librerías: son treinta líneas de tabla y una cuenta. Meter una
 * dependencia para esto sería cargar 40 KB en cada pantalla del sistema.
 */

// Las 107 combinaciones de anchos que define el estándar. Cada una son seis
// números (barra, espacio, barra, espacio, barra, espacio) salvo la última,
// que es la de fin y tiene siete.
const PATRONES = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 " +
  "221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 " +
  "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 " +
  "212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 " +
  "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 " +
  "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 " +
  "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 " +
  "112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 " +
  "214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 " +
  "114131 311141 411131 211412 211214 211232 2331112"
).split(" ");

const INICIO_B = 104;
const INICIO_C = 105;
const CAMBIO_A_C = 99;
const FIN = 106;

/**
 * Los anchos de barra y espacio, en módulos, de izquierda a derecha.
 * El primero siempre es barra y después se van alternando.
 */
export function modulosCode128(texto: string): number[] {
  const digitos = String(texto).replace(/\D/g, "");
  if (!digitos) return [];

  // El modo C mete dos dígitos en cada símbolo, así que el código sale casi a
  // la mitad de ancho. Solo funciona de a pares: si el largo es impar, el
  // primer dígito se manda en modo B y recién ahí se cambia a C.
  const valores: number[] = [];
  let inicio: number;
  let i = 0;
  if (digitos.length % 2 === 0) {
    inicio = INICIO_C;
  } else {
    inicio = INICIO_B;
    valores.push(digitos.charCodeAt(0) - 32);
    valores.push(CAMBIO_A_C);
    i = 1;
  }
  for (; i < digitos.length; i += 2) valores.push(Number(digitos.substr(i, 2)));

  // El dígito de control: el símbolo de inicio más cada valor multiplicado por
  // su posición, todo módulo 103. Sin esto el lector rechaza el código.
  let suma = inicio;
  valores.forEach((v, k) => (suma += v * (k + 1)));

  const simbolos = [inicio, ...valores, suma % 103, FIN];
  const modulos: number[] = [];
  for (const s of simbolos) {
    for (const n of PATRONES[s]) modulos.push(Number(n));
  }
  return modulos;
}

/** Los rectángulos negros y el ancho total, para dibujar el SVG. */
export function barrasCode128(texto: string, alto = 30) {
  const modulos = modulosCode128(texto);
  // La "zona muda": el estándar pide blanco a los costados o el lector no
  // encuentra dónde empieza el código. Diez módulos de cada lado.
  const MARGEN = 10;
  const barras: { x: number; ancho: number }[] = [];
  let x = MARGEN;
  let esBarra = true;
  for (const ancho of modulos) {
    if (esBarra) barras.push({ x, ancho });
    x += ancho;
    esBarra = !esBarra;
  }
  return { barras, ancho: x + MARGEN, alto };
}

/**
 * Agrupa los dígitos para poder leerlos abajo del código.
 * 11 dígitos corridos no se pueden comparar a ojo contra nada.
 */
export function agrupar(codigo: string): string {
  const c = String(codigo).replace(/\D/g, "");
  if (c.length === 11) return `${c.slice(0, 2)} ${c.slice(2, 5)} ${c.slice(5, 8)} ${c.slice(8)}`;
  if (c.length === 13) return `${c.slice(0, 1)} ${c.slice(1, 7)} ${c.slice(7)}`;
  return c;
}
