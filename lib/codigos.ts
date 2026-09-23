/**
 * Códigos de barras: los dos tipos que convive el sistema.
 *
 * 1. **El del fabricante.** Ya viene impreso en el envase (un EAN-13 como
 *    7790895000997). No lo inventamos nosotros: se lee del paquete y se guarda.
 *    Es el mejor caso — no hay que imprimir ni pegar nada.
 *
 * 2. **El nuestro.** Para lo fraccionado, lo que viene a granel o lo que trae
 *    un código ilegible. Son 11 dígitos que arrancan en "20": el estándar EAN
 *    reserva el prefijo 2 para uso interno de cada tienda, así que nunca van a
 *    chocar con el código real de ningún producto del mundo. Estos hay que
 *    imprimirlos en etiqueta y pegarlos.
 *
 * Por qué importa distinguirlos: solo los del segundo grupo van a la cola de
 * impresión de etiquetas. Si imprimiéramos todos, la operativa estaría pegando
 * etiquetas encima de códigos que ya funcionaban.
 */

/** Deja solo los dígitos: los lectores a veces agregan espacios o un Enter. */
export function limpiarCodigoBarras(valor: string): string {
  return (valor ?? "").replace(/\D/g, "");
}

/** ¿Es uno de los códigos que generamos nosotros (y por lo tanto hay que imprimir)? */
export function esCodigoInterno(codigo: string | null | undefined): boolean {
  return /^20\d{9}$/.test((codigo ?? "").trim());
}

/**
 * Verifica el dígito verificador de un EAN-13, EAN-8, UPC-A o UPC-E.
 *
 * Sirve para avisar cuando alguien tipea el código a mano y se come un número.
 * Es un aviso, no un bloqueo: hay envases importados con códigos raros y no
 * vale la pena trabar una carga por eso.
 */
export function largoDeCodigoConocido(codigo: string): boolean {
  return [8, 12, 13, 14].includes(codigo.length);
}

export function digitoVerificadorOk(codigo: string): boolean {
  const limpio = limpiarCodigoBarras(codigo);
  if (!largoDeCodigoConocido(limpio)) return false;

  const digitos = limpio.split("").map(Number);
  const verificador = digitos.pop() as number;
  // Se pesa 3-1-3-1... desde la derecha, que es como lo define el estándar
  // para todas estas familias.
  const suma = digitos
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (suma % 10)) % 10 === verificador;
}
