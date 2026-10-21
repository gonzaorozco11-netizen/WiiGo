import { minutosDeHora } from "@/lib/horarios";

// Los tramos de un día: cada entrada con su salida.
//
// Antes las horas del día se contaban de la PRIMERA entrada a la ÚLTIMA
// salida. Con dos turnos el mismo día (9 a 13 y 17 a 21) eso daba 12 horas
// en vez de 8: se pagaban las horas del medio. Ahora se suma cada tramo.
//
// Una entrada sin salida queda como tramo abierto (no suma horas: es el
// "sin salida" que hay que corregir, o el "trabajando ahora" de hoy). Una
// salida sin entrada no suma nada.

export type MarcaDia<T> = { tipo: string; hora: string; dato: T };
export type Tramo<T> = { entrada: MarcaDia<T> | null; salida: MarcaDia<T> | null; horas: number | null };

/** marcas: las del día, ordenadas por hora. */
export function armarTramos<T>(marcas: MarcaDia<T>[]): Tramo<T>[] {
  const tramos: Tramo<T>[] = [];
  let abierta: MarcaDia<T> | null = null;
  for (const m of marcas) {
    if (m.tipo === "ENTRADA") {
      if (abierta) tramos.push({ entrada: abierta, salida: null, horas: null });
      abierta = m;
    } else if (m.tipo === "SALIDA") {
      if (abierta) {
        const minutos = Math.max(0, minutosDeHora(m.hora) - minutosDeHora(abierta.hora));
        tramos.push({ entrada: abierta, salida: m, horas: Math.round((minutos / 60) * 100) / 100 });
        abierta = null;
      } else {
        tramos.push({ entrada: null, salida: m, horas: null });
      }
    }
  }
  if (abierta) tramos.push({ entrada: abierta, salida: null, horas: null });
  return tramos;
}

/** Horas del día: la suma de los tramos completos. null si no hay ninguno completo. */
export function horasDeTramos<T>(tramos: Tramo<T>[]): number | null {
  const completos = tramos.filter((t) => t.horas !== null);
  if (completos.length === 0) return null;
  return Math.round(completos.reduce((a, t) => a + (t.horas ?? 0), 0) * 100) / 100;
}

/** Si el día terminó con una entrada sin su salida. */
export function quedoSinSalida<T>(tramos: Tramo<T>[]) {
  const ultimo = tramos[tramos.length - 1];
  return Boolean(ultimo && ultimo.entrada && !ultimo.salida);
}
