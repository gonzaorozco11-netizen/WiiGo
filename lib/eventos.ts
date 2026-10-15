// El calendario de eventos del local: tipos, etiquetas y las dos reglas que
// deciden qué ve y qué puede hacer cada marca.
//
// Datos puros, sin `next/headers`: lo importan tanto los server actions como
// los componentes de cliente. Mismo criterio que lib/planesMarca.ts.

import { NIVEL, type PlanMarca } from "@/lib/planesMarca";
import { feriadosEntre } from "@/lib/feriados";

/** Qué es lo que pasa ese día. */
export const TIPOS = ["EVENTO", "COMERCIAL", "HORARIO", "CERRADO"] as const;
export type TipoEvento = (typeof TIPOS)[number];

export const ETIQUETA_TIPO: Record<TipoEvento, string> = {
  EVENTO: "Evento WiiGo",
  COMERCIAL: "Fecha comercial",
  HORARIO: "Horario especial",
  CERRADO: "Local cerrado",
};

/** La clase del color, para el chip y para el día del almanaque. */
export const CLASE_TIPO: Record<TipoEvento, string> = {
  EVENTO: "ev",
  COMERCIAL: "com",
  HORARIO: "esp",
  CERRADO: "cerr",
};

/** Quiénes participan. */
export const ALCANCES = ["AVISO", "ABIERTO", "INVITACION"] as const;
export type AlcanceEvento = (typeof ALCANCES)[number];

export const ETIQUETA_ALCANCE: Record<AlcanceEvento, string> = {
  AVISO: "Es solo un aviso",
  ABIERTO: "Abierto, con cupo",
  INVITACION: "Solo las que yo invite",
};

export const EXPLICA_ALCANCE: Record<AlcanceEvento, string> = {
  AVISO: "Nadie se anota. Para feriados, Navidad, o algo que quiero que todas sepan.",
  ABIERTO: "Se anotan las que quieran, hasta llenar la góndola.",
  INVITACION: "Elijo las marcas y les llega la invitación.",
};

export const ORDENES = ["GOLD_PRIMERO", "LLEGADA", "SOLO_GOLD"] as const;
export type OrdenEntrada = (typeof ORDENES)[number];

export const ETIQUETA_ORDEN: Record<OrdenEntrada, string> = {
  GOLD_PRIMERO: "Las Gold entran primero",
  LLEGADA: "Por orden de llegada",
  SOLO_GOLD: "Solo Gold",
};

/** Estado de la marca dentro de un evento. */
export type EstadoParticipacion =
  | "INVITADA"
  | "ANOTADA"
  | "CONFIRMADA"
  | "RECHAZADA"
  | "NO_VA";

export const ETIQUETA_PARTICIPACION: Record<EstadoParticipacion, string> = {
  INVITADA: "Te invitamos",
  ANOTADA: "Esperando respuesta",
  CONFIRMADA: "Estás adentro",
  RECHAZADA: "No entraste esta vez",
  NO_VA: "Dijiste que no",
};

/**
 * ¿Esta marca puede anotarse sola?
 *
 * Un evento por invitación no se pide: o te invitaron o no. Y SOLO_GOLD es el
 * único caso donde el plan cierra la puerta de entrada en vez de ordenar la
 * fila — se usa poco, justamente porque un "no podés" sin alternativa no
 * vende plan, molesta.
 */
export function puedeAnotarse(
  evento: { alcance: AlcanceEvento; ordenEntrada: OrdenEntrada },
  plan: PlanMarca
): boolean {
  if (evento.alcance !== "ABIERTO") return false;
  if (evento.ordenEntrada === "SOLO_GOLD") return NIVEL[plan] >= NIVEL.GOLD;
  return true;
}

/**
 * ¿Esta marca puede proponer un evento propio?
 *
 * Solo Gold. No es por mezquindad: un evento de marca ocupa la góndola de
 * entrada, las pantallas y un rato del operativo, y eso es exactamente lo que
 * se está pagando. Si lo pudiera pedir cualquiera, el plan dejaría de valer.
 *
 * Igual el botón se le muestra a todas, apagado y con el motivo: esconderlo
 * haría que una Bronce ni se entere de que existe, y nadie paga por algo que
 * no sabe que hay.
 */
export function puedeProponerEvento(plan: PlanMarca): boolean {
  return NIVEL[plan] >= NIVEL.GOLD;
}

/**
 * Una marca que se anota, ¿queda confirmada sola o esperando?
 *
 * Las Gold quedan confirmadas en el momento: es lo que están pagando. Al resto
 * las confirma WiiGo cuando sabe cuánta góndola le queda, que es una decisión
 * que no se puede automatizar sin saber el espacio real.
 */
export function entraDeUna(
  evento: { ordenEntrada: OrdenEntrada },
  plan: PlanMarca
): boolean {
  if (evento.ordenEntrada === "LLEGADA") return true;
  return NIVEL[plan] >= NIVEL.GOLD;
}

/** Días que faltan para una fecha ISO, contra el día de hoy en ISO. */
export function diasHasta(desdeISO: string, hoyISO: string): number {
  const a = Date.UTC(
    Number(hoyISO.slice(0, 4)),
    Number(hoyISO.slice(5, 7)) - 1,
    Number(hoyISO.slice(8, 10))
  );
  const b = Date.UTC(
    Number(desdeISO.slice(0, 4)),
    Number(desdeISO.slice(5, 7)) - 1,
    Number(desdeISO.slice(8, 10))
  );
  return Math.round((b - a) / 86400000);
}

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIA_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "27–29 nov" o "8 dic". */
export function rangoCorto(desdeISO: string, hastaISO: string): string {
  const d1 = Number(desdeISO.slice(8, 10));
  const m1 = MES_CORTO[Number(desdeISO.slice(5, 7)) - 1];
  if (desdeISO === hastaISO) return `${d1} ${m1}`;
  const d2 = Number(hastaISO.slice(8, 10));
  const m2 = MES_CORTO[Number(hastaISO.slice(5, 7)) - 1];
  return m1 === m2 ? `${d1}–${d2} ${m1}` : `${d1} ${m1} – ${d2} ${m2}`;
}

/** "lunes" / "vie a dom" / "dos semanas". */
export function cuandoCorto(desdeISO: string, hastaISO: string): string {
  const dias = diasHasta(desdeISO, hastaISO) + 1;
  if (dias === 1) return DIA_LARGO[diaDeSemana(desdeISO)];
  if (dias <= 7) {
    return `${DIA_LARGO[diaDeSemana(desdeISO)].slice(0, 3)} a ${DIA_LARGO[diaDeSemana(hastaISO)].slice(0, 3)}`;
  }
  const semanas = Math.round(dias / 7);
  return semanas === 2 ? "dos semanas" : `${semanas} semanas`;
}

/** 0 = domingo, como getUTCDay. */
export function diaDeSemana(iso: string): number {
  return new Date(
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  ).getUTCDay();
}

/**
 * "de 11 a 17" — el horario, cuando el evento no dura todo el día.
 *
 * Las horas en punto se escriben sin ":00": "de 11 a 17" se lee más rápido
 * que "de 11:00 a 17:00", y es como lo diría cualquiera en voz alta.
 */
export function horario(desde: string | null, hasta: string | null): string | null {
  if (!desde && !hasta) return null;
  const limpia = (h: string) => (h.slice(3, 5) === "00" ? h.slice(0, 2) : h.slice(0, 5));
  if (desde && hasta) return `de ${limpia(desde)} a ${limpia(hasta)}`;
  return desde ? `desde las ${limpia(desde)}` : `hasta las ${limpia(hasta!)}`;
}

/** "lunes 26 al viernes 30 de octubre" — para el evento destacado. */
const MES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function rangoLargo(desdeISO: string, hastaISO: string): string {
  const d1 = Number(desdeISO.slice(8, 10));
  const mes1 = Number(desdeISO.slice(5, 7)) - 1;
  const dia1 = DIA_LARGO[diaDeSemana(desdeISO)];
  if (desdeISO === hastaISO) return `${dia1} ${d1} de ${MES_LARGO[mes1]}`;

  const d2 = Number(hastaISO.slice(8, 10));
  const mes2 = Number(hastaISO.slice(5, 7)) - 1;
  const dia2 = DIA_LARGO[diaDeSemana(hastaISO)];
  return mes1 === mes2
    ? `${dia1} ${d1} al ${dia2} ${d2} de ${MES_LARGO[mes1]}`
    : `${dia1} ${d1} de ${MES_LARGO[mes1]} al ${dia2} ${d2} de ${MES_LARGO[mes2]}`;
}

export type CeldaAlmanaque = { t: string; clase: string };
export type MesAlmanaque = {
  nombre: string;
  celdas: CeldaAlmanaque[];
  /**
   * Los feriados de ese mes, con su nombre.
   *
   * Listados y no solo marcados en la grilla: un puntito avisa que ese día
   * pasa algo, pero para armar una promo hay que saber QUÉ pasa. Y en el
   * teléfono no hay dónde pasar el mouse por encima.
   */
  feriados: { dia: number; nombre: string }[];
};

/**
 * Los próximos `cuantos` meses, con cada día pintado del color de su evento.
 *
 * La semana arranca el lunes, que es como se lee un almanaque acá. Si un día
 * cae en dos eventos gana el primero de la lista, que viene ordenada por
 * fecha: el que arranca antes es el que la marca ya tenía en la cabeza.
 *
 * Los feriados nacionales van siempre, sin que nadie los cargue: salen
 * calculados de lib/feriados.ts. Un evento de WiiGo le gana al feriado en el
 * color de la celda —es lo que pide una decisión— pero el feriado se nombra
 * igual en la lista de abajo.
 */
export function armarAlmanaque(
  hoyISO: string,
  cuantos: number,
  eventos: { tipo: TipoEvento; fechaDesde: string; fechaHasta: string }[]
): MesAlmanaque[] {
  const pintado = new Map<string, string>();
  for (const e of eventos) {
    const dias = diasHasta(e.fechaDesde, e.fechaHasta);
    for (let i = 0; i <= dias; i++) {
      const d = new Date(
        Date.UTC(
          Number(e.fechaDesde.slice(0, 4)),
          Number(e.fechaDesde.slice(5, 7)) - 1,
          Number(e.fechaDesde.slice(8, 10)) + i
        )
      );
      const llave = d.toISOString().slice(0, 10);
      if (!pintado.has(llave)) pintado.set(llave, CLASE_TIPO[e.tipo]);
    }
  }

  const anio0 = Number(hoyISO.slice(0, 4));
  const mes0 = Number(hoyISO.slice(5, 7)) - 1;
  // Hasta el año siguiente: tres meses contados desde noviembre cruzan a
  // enero, y pedir solo los de este año dejaría ese enero en blanco.
  const feriados = feriadosEntre(anio0, anio0 + 1);

  const meses: MesAlmanaque[] = [];
  for (let k = 0; k < cuantos; k++) {
    const anio = anio0 + Math.floor((mes0 + k) / 12);
    const mes = (mes0 + k) % 12;
    const diasDelMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
    // getUTCDay da 0 para domingo; la semana arranca el lunes.
    const primero = (new Date(Date.UTC(anio, mes, 1)).getUTCDay() + 6) % 7;

    const celdas: CeldaAlmanaque[] = [];
    const feriadosDelMes: { dia: number; nombre: string }[] = [];
    for (let i = 0; i < primero; i++) celdas.push({ t: "", clase: "dia vacio" });
    for (let d = 1; d <= diasDelMes; d++) {
      const iso = `${anio}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const tipo = pintado.get(iso);
      const feriado = feriados.get(iso);
      if (feriado) feriadosDelMes.push({ dia: d, nombre: feriado });
      celdas.push({
        t: String(d),
        // El evento gana el color; el feriado marca igual, con su propia
        // clase, para que un día que es las dos cosas no pierda ninguna.
        clase: `dia${tipo ? ` ${tipo}` : ""}${feriado ? " feriado" : ""}${iso === hoyISO ? " hoy" : ""}`,
      });
    }
    meses.push({
      nombre: `${MES_LARGO[mes][0].toUpperCase()}${MES_LARGO[mes].slice(1)} ${anio}`,
      celdas,
      feriados: feriadosDelMes,
    });
  }
  return meses;
}
