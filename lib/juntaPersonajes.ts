// Los seis encargados de la Junta: quiénes son y dónde se sientan.
//
// Sin nada de servidor a propósito: lo usa la pantalla (fotos, colores,
// lugares en la mesa) y también el servidor (lib/junta.ts, que les arma las
// instrucciones). Los nombres no coinciden con nadie del equipo real, para
// que no se mezclen.

export type IdEncargado = "lola" | "bruno" | "ines" | "facu" | "carmen" | "julian";
export type DestinoJunta = IdEncargado | "junta";

export type Encargado = {
  id: IdEncargado;
  nombre: string;
  area: string;
  /** Color de su ropa en la foto: el de su cartel y sus mensajes. */
  color: string;
  rasgo: string;
  /** Dónde está en la foto de la sala, en % (zona que se toca). */
  zona: { x: number; y: number; w: number; h: number };
  /** Altura del cartel con el nombre, en % de la zona. */
  cartel: number;
  /** La cara, para el foco de luz cuando se habla solo con él. */
  cara: { x: number; y: number };
};

export const ENCARGADOS: Encargado[] = [
  { id: "lola", nombre: "Lola", area: "Marketing", color: "#b8566f", rasgo: "Creativa. Piensa en contenido y en que te conozcan.",
    zona: { x: 29.8, y: 32, w: 11.2, h: 28 }, cartel: 70, cara: { x: 35.6, y: 39 } },
  { id: "bruno", nombre: "Bruno", area: "Finanzas", color: "#3d5a3a", rasgo: "Cuida cada peso. Siempre pregunta cuánto rinde.",
    zona: { x: 20.5, y: 29, w: 9.3, h: 37 }, cartel: 62, cara: { x: 26.2, y: 36 } },
  { id: "ines", nombre: "Inés", area: "Contabilidad e impuestos", color: "#56688c", rasgo: "Prolija. Te avisa vencimientos y qué facturar.",
    zona: { x: 6, y: 26, w: 14.5, h: 56 }, cartel: 56, cara: { x: 14.6, y: 37 } },
  { id: "facu", nombre: "Facu", area: "Ventas", color: "#b07a2f", rasgo: "Vive en el salón: ticket, góndola y tótem.",
    zona: { x: 57.6, y: 30.5, w: 14.2, h: 30.5 }, cartel: 70, cara: { x: 65.2, y: 37.5 } },
  { id: "carmen", nombre: "Carmen", area: "Personal", color: "#7a5a8c", rasgo: "Mira al equipo: turnos, clima y cumplimiento.",
    zona: { x: 71.8, y: 31.5, w: 8.2, h: 35 }, cartel: 64, cara: { x: 75.2, y: 39 } },
  { id: "julian", nombre: "Julián", area: "Marcas", color: "#2f7f7a", rasgo: "El comercial con las marcas: quién rinde y quién falta.",
    zona: { x: 80, y: 25, w: 17.6, h: 62 }, cartel: 48, cara: { x: 85.9, y: 34 } },
];

export const ES_ENCARGADO = (id: string): id is IdEncargado => ENCARGADOS.some((e) => e.id === id);

/** Una lámina de la pantalla del fondo: un número grande o unas barras. */
export type Lamina = {
  titulo: string;
  grande?: string;
  detalle?: string;
  barras?: { etiqueta: string; valor: number }[];
};

/**
 * Lo que dijo un encargado, listo para leer. Las primeras respuestas se
 * guardaron con el formato interno a la vista ({"respuesta": "...") y a veces
 * cortadas: acá se rescata el texto, y si quedó cortado se marca con "…".
 */
export function textoLegible(texto: string): string {
  const t = texto.trim();
  if (!t.startsWith("{")) return t;
  try {
    const r = JSON.parse(t) as { respuesta?: unknown };
    if (typeof r.respuesta === "string") return r.respuesta.trim();
  } catch {
    // Sigue abajo.
  }
  const m = t.match(/"respuesta"\s*:\s*"((?:[^"\\]|\\[\s\S])*)("?)/);
  if (!m) return t;
  const limpio = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
  return m[2] ? limpio : `${limpio}…`;
}

/** Un mensaje de la conversación. `autor`: "gonzalo", un encargado o "resumen". */
export type MensajeJunta = {
  id: string;
  hilo: DestinoJunta;
  autor: "gonzalo" | "resumen" | IdEncargado;
  texto: string;
  /** Solo el resumen: los puntos de lo que conviene hacer. */
  puntos?: string[];
  lamina?: Lamina | null;
  creado: string;
};
