// Los estados de un pedido, en un solo lugar.
//
// Antes cada pantalla comparaba contra el string "PENDIENTE" a mano. Al
// aparecer RECIBIDA_PARCIAL eso se vuelve una trampa: cualquier lugar que
// no se acuerde de sumarlo hace desaparecer el pedido de su pantalla sin
// avisar. Con estas funciones, agregar un estado nuevo se hace acá y todos
// los que preguntan se enteran.
//
// No importa supabase a propósito: lo usan tanto los server actions como los
// componentes de cliente.

/** Emitida, todavía no se mandó. */
export const PENDIENTE = "PENDIENTE";
/** Llegó una parte. Lo que entró ya se vende; el resto sigue esperando. */
export const RECIBIDA_PARCIAL = "RECIBIDA_PARCIAL";
/** Llegó todo lo pedido. */
export const RECIBIDA = "RECIBIDA";
/** Llegó distinto de lo pedido y ya no se espera nada más. */
export const RECIBIDA_CON_DIFERENCIAS = "RECIBIDA_CON_DIFERENCIAS";
/** Administración decidió no esperar el faltante. */
export const CERRADA_INCOMPLETA = "CERRADA_INCOMPLETA";
export const CANCELADA = "CANCELADA";

/**
 * Estados en los que todavía puede entrar mercadería.
 *
 * Es la lista que usan los contadores y el tablero: si un pedido está acá,
 * alguien tiene algo pendiente que hacer con él.
 */
// Sin `as const`: se pasa tal cual a los `.in()` de supabase, que piden un
// string[] mutable.
export const ESTADOS_ABIERTOS: string[] = [PENDIENTE, RECIBIDA_PARCIAL];

/** ¿Todavía puede entrar mercadería contra este pedido? */
export function estaAbierta(estado: string | null | undefined): boolean {
  return estado === PENDIENTE || estado === RECIBIDA_PARCIAL;
}

/** ¿Ya se cerró, con o sin faltante? */
export function estaCerrada(estado: string | null | undefined): boolean {
  return !estaAbierta(estado) && estado !== CANCELADA;
}

/**
 * Cómo se muestra cada estado. Sin "recibida con diferencias" para el que
 * recibe: le importa si falta algo, no la etiqueta interna.
 */
export function etiquetaEstado(estado: string, enviada: boolean): string {
  switch (estado) {
    case PENDIENTE:
      return enviada ? "Enviada" : "Sin enviar";
    case RECIBIDA_PARCIAL:
      return "Llegó a medias";
    case RECIBIDA:
      return "Completa";
    case CERRADA_INCOMPLETA:
      return "Cerrada incompleta";
    case CANCELADA:
      return "Cancelada";
    default:
      return "Con diferencias";
  }
}

/**
 * Decide el estado de un pedido a partir de sus renglones, después de
 * cargar una entrega.
 *
 * Es la regla de toda la recepción parcial y por eso vive sola: si falta
 * algo el pedido sigue abierto, si no falta nada se cierra. Nadie elige
 * esto a mano — sale de las cantidades.
 */
export function estadoSegunRecibido(
  lineas: { solicitada: number; recibidaAcumulada: number }[]
): typeof RECIBIDA | typeof RECIBIDA_CON_DIFERENCIAS | typeof RECIBIDA_PARCIAL {
  const falta = lineas.some((l) => l.recibidaAcumulada < l.solicitada);
  if (falta) return RECIBIDA_PARCIAL;
  // No falta nada. Si además llegó de más, queda registrado como diferencia.
  const sobra = lineas.some((l) => l.recibidaAcumulada > l.solicitada);
  return sobra ? RECIBIDA_CON_DIFERENCIAS : RECIBIDA;
}
