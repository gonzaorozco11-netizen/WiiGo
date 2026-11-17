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

import type { BolsitaDeGranel, GranelVista } from "@/lib/fraccionado";

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
