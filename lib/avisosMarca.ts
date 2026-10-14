// Qué avisos existen y cómo se le explican a la marca.
//
// Datos puros: lo usan el server action que manda los mails y la pantalla de
// preferencias, que es de cliente. Mismo criterio que lib/planesMarca.ts.

export const TIPOS_AVISO = [
  "venta",
  "agotado",
  "solicitud",
  "liquidacion",
  "evento",
  "resumen",
] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];

/**
 * Cada aviso dicho en lo que le cambia a la marca, no en lo que hace el
 * sistema. "Notificación de cambio de estado de solicitud" no le dice nada a
 * nadie; "te respondimos lo que mandaste", sí.
 */
export const AVISOS: {
  tipo: TipoAviso;
  titulo: string;
  detalle: string;
  /** Prendido de fábrica. Lo que molesta arranca apagado. */
  porDefecto: boolean;
  /** Todavía no está conectado: se muestra, pero no llega nada. */
  proximamente?: boolean;
}[] = [
  {
    tipo: "venta",
    titulo: "Cada vez que vendés algo",
    detalle:
      "En el momento, con el producto y lo que te queda. Es el aviso lindo: te enterás de que tu marca se está moviendo sin entrar a mirar.",
    porDefecto: false,
  },
  {
    tipo: "agotado",
    titulo: "Se agotó un producto tuyo",
    detalle:
      "En el momento, con la cantidad que conviene mandar. Es el que más plata te hace perder si te enterás tarde.",
    porDefecto: true,
  },
  {
    tipo: "solicitud",
    titulo: "Te respondimos una solicitud",
    detalle: "Aprobada o no. Si la rechazamos, el motivo va en el mismo mail.",
    porDefecto: true,
  },
  {
    tipo: "liquidacion",
    titulo: "Hay una liquidación nueva",
    detalle: "Cuando cerramos el período y cuando sale el pago.",
    porDefecto: true,
    proximamente: true,
  },
  {
    tipo: "evento",
    titulo: "Se viene un evento donde podés estar",
    detalle: "Con los días que faltan, para que llegues con stock.",
    porDefecto: true,
    proximamente: true,
  },
  {
    tipo: "resumen",
    titulo: "Tu resumen del mes",
    detalle: "El día 1, con tus números del mes cerrado. Listo para reenviar.",
    porDefecto: true,
    proximamente: true,
  },
];

/**
 * Cuántos mails de un mismo tipo como mucho por día.
 *
 * Un sábado bueno no puede ser veinte mails: el aviso que cansa termina en
 * spam, y ahí se pierden también los que importan. Al llegar al tope se deja
 * de mandar ese tipo hasta el día siguiente.
 */
export const TOPE_DIARIO: Record<TipoAviso, number> = {
  venta: 12,
  agotado: 4,
  solicitud: 10,
  liquidacion: 3,
  evento: 3,
  resumen: 2,
};

/** Hasta cuántas direcciones puede cargar una marca. */
export const MAX_MAILS = 3;

/** ¿Está prendido este aviso? Lo que no está guardado vale el de fábrica. */
export function avisoPrendido(avisos: Record<string, unknown>, tipo: TipoAviso): boolean {
  const guardado = avisos?.[tipo];
  if (typeof guardado === "boolean") return guardado;
  return AVISOS.find((a) => a.tipo === tipo)?.porDefecto ?? false;
}

/** Un mail con forma de mail. Sin esto se cargan nombres y no llega nada. */
export function mailValido(m: string): boolean {
  const limpio = m.trim();
  return limpio.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio);
}
