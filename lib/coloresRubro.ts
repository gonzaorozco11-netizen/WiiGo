/**
 * Un color por rubro (color, fondo suave, texto), según el orden de los
 * rubros: siempre el mismo para cada uno. Ninguno es el azul de tarjeta ni el
 * verde agua de efectivo. Lo usan la Lista de precios y Competencia, para que
 * cada rubro se vea igual en las dos.
 */
export const COLORES_RUBRO: [string, string, string][] = [
  ["#b7791f", "#fdf6e7", "#7c4a03"], // tostado
  ["#c2416b", "#fdf0f4", "#8a1f45"], // frambuesa
  ["#5f8a2e", "#f3f8ec", "#3d5c1a"], // oliva
  ["#d4622a", "#fdf1ea", "#94380c"], // naranja
  ["#7a5bb5", "#f5f1fb", "#4f3489"], // lavanda
  ["#2f7fa8", "#eef6fb", "#1b5272"], // celeste
  ["#a2571f", "#f9f0e8", "#6b3510"], // canela
  ["#4f6b7a", "#f0f4f6", "#30444f"], // pizarra
];
export const COLOR_SIN_RUBRO: [string, string, string] = ["#9ca3af", "#f6f7f9", "#374151"];

/** El color del rubro según su lugar en la lista de rubros (-1 = sin rubro). */
export function colorDeRubro(indice: number): [string, string, string] {
  return indice >= 0 ? COLORES_RUBRO[indice % COLORES_RUBRO.length] : COLOR_SIN_RUBRO;
}
