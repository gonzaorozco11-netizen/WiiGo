// Gramos para mostrar (el granel se guarda en gramos, ver lib/granel.ts).
// Aparte para poder usarlo en pantallas del navegador.

/** «1,25 kg» o «250 g». */
export function textoGramos(g: number): string {
  if (Math.abs(g) >= 1000) return `${(g / 1000).toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg`;
  return `${Math.round(g)} g`;
}

/** Lo que se escribe en kilos («1,5» o «1.5») a gramos enteros. null si no es un número. */
export function kgAGramos(texto: string): number | null {
  const n = Number(String(texto).replace(",", ".").trim());
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
}
