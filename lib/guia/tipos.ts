// Tipos de la Guía WiiGo (el botón "¿Alguna duda?"). Sin imports de
// servidor: los usa también el panel, que corre en el navegador.

export type Audiencia = "interno" | "marca" | "profesional";

export type Tabla = { titulo: string; cab: string[]; filas: string[][] };

/**
 * Una guía tal como se escribe en lib/guia/contenido.ts. Los textos pueden
 * llevar marcadores como {pctCliente} o {meses}: se completan con la
 * configuración real al armar la guía (lib/guia/armar.ts), así no quedan
 * viejos cuando cambia un número.
 */
export type Guia = {
  id: string;
  audiencias: Audiencia[];
  tema: string;
  titulo: string;
  /** Dónde se hace, en palabras ("Productos → + Nuevo producto"). */
  donde: string;
  /** Pasos en orden: se muestran numerados. */
  pasos?: string[];
  /** Puntos sueltos, cuando no es una secuencia (cómo funciona algo). */
  puntos?: string[];
  tip?: string;
  tabla?: Tabla;
  rel?: string[];
  /** Fecha (AAAA-MM-DD) desde la que es nueva: lleva la etiqueta "Nuevo" 30 días. */
  nueva?: string;
  /** Equipo interno: solo la ve quien tiene esta pantalla (clave de lib/pantallas.ts). */
  pantalla?: string;
  /** Equipo interno: solo el Dueño. */
  soloAdmin?: boolean;
  /**
   * Dónde va primero ("En esta pantalla"). Una ruta vale para ella y las de
   * abajo; con "=" adelante, solo esa exacta ("=/portal").
   */
  rutas?: string[];
};

export type Termino = { audiencias: Audiencia[]; termino: string; definicion: string; soloAdmin?: boolean; pantalla?: string };

export type Novedad = { audiencias: Audiencia[]; fecha: string; titulo: string; detalle: string; soloAdmin?: boolean; pantalla?: string };

/** Una guía ya armada para quien la mira: textos completos, sin marcadores. */
export type GuiaLista = Omit<Guia, "audiencias" | "pantalla" | "soloAdmin" | "nueva"> & { esNueva: boolean };

export type PreguntaFrecuente = { id: string; pregunta: string; respuesta: string };

export type MiPregunta = { id: string; pregunta: string; respuesta: string | null; fecha: string };

export type PreguntaPendiente = { id: string; pregunta: string; quien: string; audiencia: Audiencia; pantalla: string | null; fecha: string };

export type DatosGuia = {
  audiencia: Audiencia;
  quien: string;
  esAdmin: boolean;
  guias: GuiaLista[];
  glosario: { termino: string; definicion: string }[];
  novedades: { fecha: string; titulo: string; detalle: string }[];
  frecuentes: PreguntaFrecuente[];
  misPreguntas: MiPregunta[];
  /** Solo el Dueño: lo que preguntaron y espera respuesta. */
  pendientes: PreguntaPendiente[];
  /** false si falta correr sql/guia-preguntas.sql: no se pueden mandar preguntas. */
  preguntasDisponibles: boolean;
};
