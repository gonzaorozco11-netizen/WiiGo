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

/** Por qué entró menos de lo anunciado. */
export const MOTIVOS_FALTANTE = [
  {
    clave: "NO_LLEGO",
    etiqueta: "No vino en la caja",
    paraLaMarca: "Estaba en el envío pero no en la caja. Si las mandaste, avisanos.",
  },
  {
    clave: "DANADO",
    etiqueta: "Llegó dañado",
    paraLaMarca: "Volvieron con tu repartidor el mismo día. Mandá otras y listo.",
  },
  {
    clave: "VENCIDO",
    etiqueta: "Vencido o por vencer",
    paraLaMarca: "No se puede poner en góndola. Volvieron con tu repartidor.",
  },
  {
    clave: "NO_ES_LO_PEDIDO",
    etiqueta: "No es el producto anunciado",
    paraLaMarca: "Llegó otra cosa. Volvió con tu repartidor.",
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
