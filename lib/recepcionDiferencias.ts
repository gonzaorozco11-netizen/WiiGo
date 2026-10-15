// Qué pasó con cada renglón de una recepción, y quién lo decide.
//
// Datos puros: los usa el server action que recibe, la bandeja de WiiGo y el
// portal de la marca. Mismo criterio que lib/estadosOrden.ts.
//
// La regla que ordena todo el módulo:
//
//   CANTIDAD la decide WiiGo, después y con tiempo. Si llegó de más, entra al
//   stock igual y queda para resolver. La operativa no conoce el tope
//   acordado con cada marca, y un mostrador con el repartidor al lado no es
//   lugar para negociar espacio de góndola.
//
//   ESTADO DE LA MERCADERÍA lo decide quien abre la caja, ahí mismo. No es
//   que sepa más: es que no se puede esperar. El repartidor se lleva lo
//   dañado en el mismo viaje, y decidirlo mañana significa quedarse con
//   mercadería rota en el depósito.

/**
 * Por qué entró menos de lo anunciado.
 *
 * Dos textos y no uno, porque son dos preguntas distintas y la marca se hace
 * las dos:
 *
 *   `etiqueta` — QUÉ PASÓ. Es lo que elige la operativa y es lo que la marca
 *     tiene que leer con esas mismas palabras. Antes solo se le mostraba la
 *     consecuencia —"volvieron con tu repartidor"— y el motivo que alguien
 *     eligió de esta lista no aparecía en ninguna pantalla suya: leía que su
 *     mercadería se volvió sin saber nunca por qué.
 *
 *   `destino` — DÓNDE ESTÁ. Es la primera pregunta de cualquiera al que le
 *     dicen que su producto llegó roto, y la que define si tiene que hacer
 *     algo: lo que se llevó el repartidor se repone, lo que nunca llegó se
 *     averigua.
 */
export const MOTIVOS_FALTANTE = [
  {
    clave: "NO_LLEGO",
    etiqueta: "No vino en la caja",
    destino: "No llegó al local. Si la mandaste, avisanos y lo revisamos.",
  },
  {
    clave: "DANADO",
    etiqueta: "Llegó dañado",
    destino: "Se la llevó tu repartidor el mismo día, en el mismo viaje. Mandá otra y listo.",
  },
  {
    clave: "VENCIDO",
    etiqueta: "Vencido o por vencer",
    destino: "No se puede poner en góndola. Se la llevó tu repartidor el mismo día.",
  },
  {
    clave: "NO_ES_LO_PEDIDO",
    etiqueta: "No es el producto anunciado",
    destino: "Llegó otra cosa. Se la llevó tu repartidor el mismo día.",
  },
] as const;

export type MotivoFaltante = (typeof MOTIVOS_FALTANTE)[number]["clave"];

export function motivo(clave: string | null | undefined) {
  return MOTIVOS_FALTANTE.find((m) => m.clave === clave) ?? null;
}

export function esMotivoValido(v: unknown): v is MotivoFaltante {
  return typeof v === "string" && MOTIVOS_FALTANTE.some((m) => m.clave === v);
}

/**
 * Qué se hizo con lo que llegó de más.
 *
 * Arranca en PENDIENTE y lo resuelve WiiGo. Para la marca no es un detalle:
 * lo que se queda está en consignación y se liquida cuando se venda; lo que
 * se devuelve no es de nadie hasta que lo retire. Decirle solo "sobran 4" la
 * deja sin saber cuál de las dos cosas es.
 */
export const RESOLUCIONES = ["PENDIENTE", "SE_QUEDA", "A_DEVOLVER"] as const;
export type ResolucionExcedente = (typeof RESOLUCIONES)[number];

export const ETIQUETA_RESOLUCION: Record<ResolucionExcedente, string> = {
  PENDIENTE: "WiiGo está decidiendo",
  SE_QUEDA: "Se quedaron",
  A_DEVOLVER: "A devolver",
};

export function esResolucionValida(v: unknown): v is ResolucionExcedente {
  return typeof v === "string" && (RESOLUCIONES as readonly string[]).includes(v);
}

/** Cómo terminó un renglón, para decírselo a la marca en una sola etiqueta. */
export type FinalRenglon =
  | "COMPLETO"
  | "SOBRO_PENDIENTE"
  | "SOBRO_SE_QUEDA"
  | "SOBRO_A_DEVOLVER"
  | "FALTO";

/**
 * De los datos crudos al final que ve la marca.
 *
 * Vive acá y no en cada pantalla porque son seis casos y el que se olvide uno
 * muestra "—" donde tendría que decir algo. Con una función, agregar un
 * estado se hace en un lugar.
 */
export function finalDelRenglon(d: {
  solicitada: number;
  recibida: number;
  resolucion?: string | null;
}): FinalRenglon {
  if (d.recibida < d.solicitada) return "FALTO";
  if (d.recibida === d.solicitada) return "COMPLETO";
  if (d.resolucion === "SE_QUEDA") return "SOBRO_SE_QUEDA";
  if (d.resolucion === "A_DEVOLVER") return "SOBRO_A_DEVOLVER";
  return "SOBRO_PENDIENTE";
}
