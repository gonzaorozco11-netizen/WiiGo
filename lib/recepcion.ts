// Los días en que el local recibe mercadería de las marcas.
//
// Datos puros, sin `next/headers`: los usa el server action que calcula la
// próxima fecha y también la pantalla de Configuración, que es de cliente.
// Mismo criterio que lib/planesMarca.ts.
//
// Por qué días fijos y no "cuando quieran": recibir es el único paso del
// circuito de reposición que ocupa a una persona del local —hay que contar lo
// que llegó— y si cada marca aparece cuando se le ocurre, la operativa pasa la
// semana recibiendo. Dos días concentran todas las entregas en dos mañanas.

/** Lunes = 1 … Domingo = 7, igual que `fechaHoraArgentina().diaSemanaISO`. */
export const DIAS_SEMANA = [
  { iso: 1, corto: "Lun", largo: "lunes" },
  { iso: 2, corto: "Mar", largo: "martes" },
  { iso: 3, corto: "Mié", largo: "miércoles" },
  { iso: 4, corto: "Jue", largo: "jueves" },
  { iso: 5, corto: "Vie", largo: "viernes" },
  { iso: 6, corto: "Sáb", largo: "sábado" },
  { iso: 7, corto: "Dom", largo: "domingo" },
] as const;

/**
 * Martes y viernes.
 *
 * No es simétrico a propósito: deja huecos de 3 y 4 días. Lunes-jueves sería
 * más parejo pero el lunes es el día de acomodar lo del fin de semana, y el
 * viernes conviene llegar con la góndola llena. El hueco largo (viernes a
 * martes) es el que manda para calcular cuánto stock hace falta.
 */
export const DIAS_RECEPCION_POR_DEFECTO = [2, 5];

export const PARAMETRO_DIAS = "RECEPCION_DIAS";
export const PARAMETRO_HORA_DESDE = "RECEPCION_HORA_DESDE";
export const PARAMETRO_HORA_HASTA = "RECEPCION_HORA_HASTA";

/** "2,5" → [2, 5]. Lo guardado que no se entiende cae al valor por defecto. */
export function leerDias(valor: string | null | undefined): number[] {
  const dias = (valor ?? "")
    .split(",")
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  const unicos = [...new Set(dias)].sort((a, b) => a - b);
  return unicos.length > 0 ? unicos : DIAS_RECEPCION_POR_DEFECTO;
}

export function escribirDias(dias: number[]): string {
  return [...new Set(dias)]
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((a, b) => a - b)
    .join(",");
}

/** "martes y viernes" — para decírselo a la marca en una frase. */
export function nombrarDias(dias: number[]): string {
  const nombres = dias
    .map((d) => DIAS_SEMANA.find((x) => x.iso === d)?.largo)
    .filter(Boolean) as string[];
  if (nombres.length === 0) return "—";
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

/**
 * Cuántos días faltan para la próxima recepción, desde un día de la semana.
 *
 * 0 significa hoy. Se cuenta en días de semana y no con fechas porque lo
 * único que importa es el día: la hora la pone el horario de recepción.
 */
export function diasHastaProxima(diaActualISO: number, dias: number[]): number {
  if (dias.length === 0) return 0;
  let mejor = 7;
  for (const d of dias) {
    const falta = (d - diaActualISO + 7) % 7;
    if (falta < mejor) mejor = falta;
  }
  return mejor;
}

/**
 * El hueco más largo entre dos recepciones seguidas.
 *
 * Es el número que manda para el stock objetivo: hay que aguantar vendiendo
 * todo ese tiempo sin que entre nada. Con martes y viernes son 4 días
 * (viernes a martes). Un objetivo que no cubre este hueco garantiza quiebres
 * a mitad de semana, por más que se reponga puntual.
 */
export function huecoMasLargo(dias: number[]): number {
  if (dias.length === 0) return 7;
  if (dias.length === 1) return 7;
  const orden = [...new Set(dias)].sort((a, b) => a - b);
  let mayor = 0;
  for (let i = 0; i < orden.length; i++) {
    const siguiente = orden[(i + 1) % orden.length];
    const hueco = i === orden.length - 1 ? siguiente - orden[i] + 7 : siguiente - orden[i];
    if (hueco > mayor) mayor = hueco;
  }
  return mayor;
}
