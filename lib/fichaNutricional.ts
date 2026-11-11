// Qué productos no llevan información nutricional: lo que no es un alimento
// (shakers, botellas, vasos). Antes a Animalfit le figuraban sus shakers como
// «sin información nutricional» (2026-11-11). Lo usan Mis tareas y la lista
// filtrada de Cambios y altas, así cuentan lo mismo.
export function noLlevaFichaNutricional(nombre: string, subcategoria: string | null | undefined) {
  return /shaker|botella|vaso|accesorio/i.test(`${nombre} ${subcategoria ?? ""}`);
}

/** Una ficha vacía cuenta como que falta: la fila se crea sola al tocar otros campos. */
export function fichaCargada(f: Record<string, unknown> | null | undefined) {
  if (!f) return false;
  return ["kcal_100g", "proteinas", "carbohidratos", "grasas", "porcion", "ingredientes"].some((k) => f[k] !== null && f[k] !== undefined && f[k] !== "");
}
