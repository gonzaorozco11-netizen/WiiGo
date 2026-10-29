// El nombre de lo que vende WiiGo (marca propia) lleva el tamaño al final, y
// lo pone el sistema a partir del peso neto: se escribe "Almendra Non
// Pareil" y queda "Almendra Non Pareil 250 g" (Gonzalo, 2026-10-29). Cada
// tamaño sigue siendo un producto aparte —su código, stock y precio—, así que
// el tamaño tiene que estar en el nombre para distinguirlos en la caja y el tótem.

/** "250 g", "1 kg", "1,5 kg". */
export function textoTamano(gramos: number) {
  if (gramos >= 1000) return `${(gramos / 1000).toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg`;
  return `${Math.round(gramos)} g`;
}

// Un tamaño escrito al final, a mano o por el sistema: "x250gr", "250 g", "- 1kg", "x 1,5 kg".
const TAMANO_AL_FINAL = /\s*[-·]?\s*x?\s*\d+(?:[.,]\d+)?\s*(?:g|gr|grs|gramos|kg|kgs|kilo|kilos)\.?\s*$/i;

/** El nombre sin el tamaño del final. */
export function nombreBase(nombre: string) {
  const base = nombre.replace(TAMANO_AL_FINAL, "").trim();
  return base || nombre.trim();
}

/** El nombre con el tamaño del peso neto. Sin peso, queda como está (con lo que diga a mano). */
export function nombreConTamano(nombre: string, gramos: number | null | undefined) {
  return gramos && gramos > 0 ? `${nombreBase(nombre)} ${textoTamano(gramos)}` : nombre.trim();
}
