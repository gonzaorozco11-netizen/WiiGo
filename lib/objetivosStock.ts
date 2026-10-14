// Cómo se eligen el mínimo y el objetivo de cada variante.
//
// Datos puros: los usa el server action que guarda y también la pantalla, que
// es de cliente. Mismo criterio que lib/recepcion.ts.
//
// Los dos números hacen trabajos distintos, y con días fijos de recepción uno
// de los dos cambió de función:
//
//   OBJETIVO — hasta cuánto se llena la góndola. Es el que manda: cada día de
//   recepción se repone hasta acá.
//
//   MÍNIMO — la alarma. Ya NO es el disparador del pedido: el disparador es el
//   calendario, porque los martes y viernes se revisa todo igual. Estar por
//   debajo del mínimo significa "vas a quebrar antes de la próxima recepción",
//   y es lo que habilita una urgencia.

/** Debajo de esta parte del objetivo, no llega a la próxima recepción. */
const PROPORCION_MINIMO = 0.4;

/**
 * El mínimo que le corresponde a un objetivo.
 *
 * Es una proporción y no un número fijo porque un mínimo de 3 significa cosas
 * opuestas según el objetivo: con objetivo 5 es "casi lleno" y con objetivo 30
 * es "prácticamente vacío".
 *
 * Nunca da 0 cuando hay objetivo: un mínimo en cero es una alarma que no
 * suena nunca — el producto ya se agotó cuando salta.
 */
export function minimoSugerido(objetivo: number): number {
  if (!Number.isFinite(objetivo) || objetivo <= 0) return 0;
  return Math.max(1, Math.round(objetivo * PROPORCION_MINIMO));
}

/**
 * Cuántas ventas por semana aguanta un objetivo sin quebrar.
 *
 * Es la pregunta que hay que poder contestar al elegir el número, y la que
 * nadie se hace: un objetivo de 5 con 4 días sin recibir aguanta 7 ventas
 * semanales. El producto que vende 10 va a quebrar siempre, repongas puntual
 * o no.
 *
 * Se resta 1 porque quebrar es llegar a cero: con 5 unidades se pueden vender
 * 4 y seguir teniendo algo en la góndola.
 */
export function ventasSemanalesQueAguanta(objetivo: number, huecoDias: number): number {
  if (objetivo <= 1 || huecoDias <= 0) return 0;
  return ((objetivo - 1) / huecoDias) * 7;
}

/**
 * El objetivo que haría falta para sostener una venta semanal.
 *
 * El revés de la función de arriba, con un colchón del 50% encima: la venta
 * no llega repartida prolija, llega en picos. Sin colchón, el producto que
 * vende justo el promedio quiebra la mitad de las semanas.
 */
export function objetivoParaVender(ventasPorSemana: number, huecoDias: number): number {
  if (ventasPorSemana <= 0) return 0;
  return Math.ceil(((ventasPorSemana / 7) * huecoDias) * 1.5) + 1;
}
