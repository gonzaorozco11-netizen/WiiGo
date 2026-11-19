// Qué fraccionar (Gonzalo, 17/11, maqueta «Qué fraccionar hoy» v2).
//
// «Se vendió uno, se fracciona uno»: cada bolsita tiene que quedar con su
// máximo en el local —5 en el blistero y 3 en el cajón de abajo = 8—, así que
// lo que hay que hacer es lo que falta para llegar ahí. Se fracciona al final
// del turno. Si conviene cerrar la bolsa entera (el depósito es chico), se
// puede: el producto queda con más de 8 y no vuelve a aparecer hasta que baje.
//
// Sin nada del servidor: lo usan la pantalla Fraccionar, la guía y el Inicio.
// Al equipo no se le nombra al proveedor: «no hay granel» y listo.

import type { BolsitaDeGranel, EnCursoVista, GranelVista } from "@/lib/fraccionado";

/**
 * El paso de fraccionados_en_curso que quiere decir «fraccionado, falta la
 * etiqueta» (17/11): las etiquetas se imprimen todas juntas al final de la
 * tanda, y recién ahí entran al stock.
 */
export const PASO_PARA_ETIQUETAR = 5;

/**
 * Las etiquetas ya se imprimieron; falta pegarlas y sumarlas al stock (19/11:
 * Florencia imprimió a la mañana, no sumó, y Tomás a la tarde volvió a imprimir
 * todo porque el sistema no sabía que ya estaban). Una vez impresas no se piden de nuevo.
 */
export const PASO_IMPRESAS = 6;

/** Las etiquetas ya están pegadas: falta solo «Sumar al stock» (19/11). */
export const PASO_PEGADAS = 7;

/** Qué le falta a lo de la tanda, por el paso más atrasado (para el aviso del Inicio). */
export function loQueFalta(pendientes: EnCursoVista[]): "IMPRIMIR" | "PEGAR" | "SUMAR" | null {
  if (pendientes.length === 0) return null;
  const min = Math.min(...pendientes.map((e) => e.paso));
  return min < PASO_IMPRESAS ? "IMPRIMIR" : min < PASO_PEGADAS ? "PEGAR" : "SUMAR";
}

/** Lo de la tanda que ya está fraccionado y espera la etiqueta. */
export function paraEtiquetar(enCurso: EnCursoVista[]): EnCursoVista[] {
  return enCurso.filter((e) => e.paso >= PASO_PARA_ETIQUETAR && (e.bolsitas ?? 0) > 0);
}

/**
 * Los graneles como quedan contando lo ya fraccionado que espera la etiqueta:
 * esas bolsitas todavía no entraron al stock, pero ya están hechas, así que no
 * tienen que volver a aparecer en «Para fraccionar», y ese granel ya se usó.
 */
export function conLoYaFraccionado(graneles: GranelVista[], pendientes: EnCursoVista[]): GranelVista[] {
  if (pendientes.length === 0) return graneles;
  return graneles.map((g) => {
    const suyos = pendientes.filter((e) => e.idVarianteGranel === g.idVariante);
    if (suyos.length === 0) return g;
    let gramos = g.gramos;
    const bolsitas = g.bolsitas.map((b) => {
      const hechas = suyos.filter((e) => e.idVarianteBolsa === b.idVariante).reduce((a, e) => a + (e.bolsitas ?? 0), 0);
      gramos -= hechas * b.peso;
      return hechas ? { ...b, enGondola: b.enGondola + hechas } : b;
    });
    // Si pesaron lo que quedó (o se terminó), eso manda.
    const ultimo = suyos[0];
    if (ultimo.seTermino) gramos = 0;
    else if (ultimo.gramosQuedan != null) gramos = ultimo.gramosQuedan;
    return { ...g, gramos: Math.max(0, gramos), bolsitas };
  });
}

/** Bolsitas que faltan para llegar al máximo (5 + 3). */
export function faltanBolsitas(b: BolsitaDeGranel): number {
  return Math.max(0, b.objetivo - b.enGondola);
}

/** Ya no llena el blistero: va primero. */
export function esUrgente(b: BolsitaDeGranel): boolean {
  return b.minimo > 0 ? b.enGondola < b.minimo : b.enGondola <= 2;
}

/** «Lo que falta», sin pasarse de lo que alcanza el granel. */
export function cuantasLoQueFalta(g: GranelVista, b: BolsitaDeGranel): number {
  return Math.min(faltanBolsitas(b), Math.floor(g.gramos / b.peso));
}

/** «Toda la bolsa»: una bolsa cerrada (o lo que quede, si hay menos). */
export function cuantasTodaLaBolsa(g: GranelVista, b: BolsitaDeGranel): { bolsitas: number; gramos: number } {
  const gramos = Math.min(g.gramos, g.gramosBolsa > 0 ? g.gramosBolsa : g.gramos);
  return { bolsitas: Math.floor(gramos / b.peso), gramos };
}

export type ParaFraccionar = {
  granel: GranelVista;
  bolsita: BolsitaDeGranel;
  /** Las que faltan para llegar al máximo. */
  faltan: number;
  /** Las que se pueden hacer ya con el granel que hay (0 si no hay). */
  hacer: number;
  urgente: boolean;
  sinGranel: boolean;
};

/**
 * La lista de «Para fraccionar antes de cerrar el turno»: todo lo que está por
 * debajo del máximo y tiene granel. Lo que no tiene granel aparece solo si ya
 * no llena el blistero (ahí ya entró en la lista para pedir). Primero lo urgente.
 */
export function paraFraccionar(graneles: GranelVista[]): ParaFraccionar[] {
  const salida: ParaFraccionar[] = [];
  for (const g of graneles) {
    for (const b of g.bolsitas) {
      const faltan = faltanBolsitas(b);
      if (faltan <= 0) continue;
      const hacer = cuantasLoQueFalta(g, b);
      const sinGranel = hacer <= 0;
      const urgente = esUrgente(b);
      if (sinGranel && b.enGondola > b.minimo) continue;
      salida.push({ granel: g, bolsita: b, faltan, hacer, urgente, sinGranel });
    }
  }
  return salida.sort(
    (a, b) =>
      Number(a.sinGranel) - Number(b.sinGranel) ||
      Number(b.urgente) - Number(a.urgente) ||
      b.faltan - a.faltan ||
      a.bolsita.nombre.localeCompare(b.bolsita.nombre, "es")
  );
}
