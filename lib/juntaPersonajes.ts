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
    zona: { x: 31.3, y: 29.5, w: 10, h: 27 }, cartel: 58, cara: { x: 35.4, y: 37 } },
  { id: "bruno", nombre: "Bruno", area: "Finanzas", color: "#3d5a3a", rasgo: "Cuida cada peso. Siempre pregunta cuánto rinde.",
    zona: { x: 21, y: 28.5, w: 10.3, h: 33 }, cartel: 50, cara: { x: 27, y: 37 } },
  { id: "ines", nombre: "Inés", area: "Contabilidad e impuestos", color: "#56688c", rasgo: "Prolija. Te avisa vencimientos y qué facturar.",
    zona: { x: 8.3, y: 26.5, w: 12.7, h: 56 }, cartel: 44, cara: { x: 16, y: 38 } },
  { id: "facu", nombre: "Facu", area: "Ventas", color: "#b07a2f", rasgo: "Vive en el salón: ticket, góndola y tótem.",
    zona: { x: 59, y: 28.5, w: 10.7, h: 27 }, cartel: 58, cara: { x: 65.6, y: 37 } },
  { id: "carmen", nombre: "Carmen", area: "Personal", color: "#7a5a8c", rasgo: "Mira al equipo: turnos, clima y cumplimiento.",
    zona: { x: 69.7, y: 30.5, w: 9.8, h: 33 }, cartel: 50, cara: { x: 74.6, y: 38 } },
  { id: "julian", nombre: "Julián", area: "Marcas", color: "#2f7f7a", rasgo: "El comercial con las marcas: quién rinde y quién falta.",
    zona: { x: 79.5, y: 26, w: 15, h: 56 }, cartel: 44, cara: { x: 84.8, y: 36 } },
];

export const ES_ENCARGADO = (id: string): id is IdEncargado => ENCARGADOS.some((e) => e.id === id);

/** Una lámina de la pantalla del fondo: un número grande o unas barras. */
export type Lamina = {
  titulo: string;
  grande?: string;
  detalle?: string;
  barras?: { etiqueta: string; valor: number }[];
};

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
