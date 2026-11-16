// Combos (Gonzalo, 2026-11-16). Un combo NO es un producto ni tiene stock propio:
// es una regla de precio. Si en la compra están los productos del combo, el
// precio baja solo. El stock baja de cada producto, como siempre.
//
// Reglas acordadas:
// - Cualquier sabor (variante) del producto entra; lo que se lista son productos.
// - El descuento lo pone la marca que armó el combo: se reparte entre los
//   renglones del combo, así la liquidación le rinde sobre el precio del combo y
//   el royalty de WiiGo sale de lo cobrado (sale solo, porque se liquida sobre
//   detalle_ventas.subtotal).
// - Con combo no se suma el descuento ni la comisión de profesional: los
//   renglones del combo quedan fuera del referido (`idCombo`).
// - Si alcanza para dos combos, se aplica dos veces.
//
// Este archivo es solo la cuenta (sin base de datos): la usan la caja y el
// tótem en la pantalla, y el servidor al cobrar, así lo que se ve es lo que se
// cobra. La tienda online tiene la misma cuenta escrita en public/tienda/app.js
// (`aplicarCombos`): si se cambia acá, cambiarla allá también.
// Los combos se leen de la tabla `combos` (sql/combos.sql) con lib/combosServidor.ts.

export type GrupoCombo = { cantidad: number; productos: string[] };

export type Combo = {
  id: string;
  nombre: string;
  /** Texto de la marca para mostrar ("Star Nutrition"). */
  marca: string | null;
  /** Precio del combo con tarjeta, QR o transferencia. */
  precio: number;
  /** Precio del combo en efectivo. Sin cargar: el mismo de arriba. */
  precioEfectivo: number | null;
  imagen: string | null;
  grupos: GrupoCombo[];
  orden: number;
};

/** Un renglón de la compra: `precio` es el unitario que se cobra con el medio elegido. */
export type LineaCombo = { clave: string; idProducto: string; cantidad: number; precio: number };

/** Cuántas unidades de un renglón entraron en un combo y cuánto se les descontó en total. */
export type PorcionCombo = { clave: string; idCombo: string; unidades: number; descuento: number };

export type ComboAplicado = { combo: Combo; veces: number; descuento: number };

export type ResultadoCombos = { aplicados: ComboAplicado[]; porciones: PorcionCombo[]; descuento: number };

export type ModoPrecio = "EFECTIVO" | "LISTA";

export function precioDelCombo(combo: Combo, modo: ModoPrecio): number {
  return modo === "EFECTIVO" && combo.precioEfectivo != null && combo.precioEfectivo > 0 ? combo.precioEfectivo : combo.precio;
}

/** Una vez de un combo con lo que queda libre: qué unidades toma y cuánto ahorra (o null si no entra). */
function probarUnaVez(combo: Combo, lineas: LineaCombo[], libres: Map<string, number>, modo: ModoPrecio) {
  if (!combo.grupos.length) return null;
  const prueba = new Map(libres);
  const elegidas: LineaCombo[] = [];
  for (const g of combo.grupos) {
    let faltan = g.cantidad;
    for (const l of lineas) {
      if (faltan <= 0) break;
      if (g.productos.indexOf(l.idProducto) < 0) continue;
      const hay = prueba.get(l.clave) ?? 0;
      const toma = Math.min(hay, faltan);
      if (toma <= 0) continue;
      prueba.set(l.clave, hay - toma);
      for (let k = 0; k < toma; k++) elegidas.push(l);
      faltan -= toma;
    }
    if (faltan > 0) return null;
  }
  const suma = elegidas.reduce((t, l) => t + l.precio, 0);
  const descuento = suma - precioDelCombo(combo, modo);
  if (!(descuento > 0) || !(suma > 0)) return null;
  return { prueba, elegidas, suma, descuento };
}

/**
 * Arma todos los combos que entran en la compra. Cada vez elige el combo que
 * más le ahorra al cliente con lo que queda suelto (así, whey + 2 creatinas
 * arma whey + creatina y no las 2 creatinas), y repite mientras entre alguno.
 * Solo se aplica si de verdad le baja el precio.
 */
export function aplicarCombos(lineas: LineaCombo[], combos: Combo[], modo: ModoPrecio): ResultadoCombos {
  const libres = new Map<string, number>();
  for (const l of lineas) libres.set(l.clave, (libres.get(l.clave) ?? 0) + Math.max(0, Math.floor(l.cantidad)));

  const porCombo = new Map<string, ComboAplicado>();
  const porciones = new Map<string, PorcionCombo>();
  const ordenados = combos.slice().sort((a, b) => a.orden - b.orden);

  for (let vuelta = 0; vuelta < 100; vuelta++) {
    let mejor: { combo: Combo; r: NonNullable<ReturnType<typeof probarUnaVez>> } | null = null;
    for (const combo of ordenados) {
      const r = probarUnaVez(combo, lineas, libres, modo);
      if (r && (!mejor || r.descuento > mejor.r.descuento)) mejor = { combo, r };
    }
    if (!mejor) break;
    const { combo, r } = mejor;

    // El descuento se reparte en proporción al precio de cada unidad, en pesos
    // enteros; la última unidad se lleva lo que sobra del redondeo.
    let repartido = 0;
    r.elegidas.forEach((l, i) => {
      const parte = i === r.elegidas.length - 1 ? r.descuento - repartido : Math.round((r.descuento * l.precio) / r.suma);
      repartido += parte;
      const clave = `${l.clave}|${combo.id}`;
      const p = porciones.get(clave) ?? { clave: l.clave, idCombo: combo.id, unidades: 0, descuento: 0 };
      p.unidades += 1;
      p.descuento += parte;
      porciones.set(clave, p);
    });
    r.prueba.forEach((v, k) => libres.set(k, v));
    const a = porCombo.get(combo.id) ?? { combo, veces: 0, descuento: 0 };
    a.veces += 1;
    a.descuento += r.descuento;
    porCombo.set(combo.id, a);
  }

  const aplicados = ordenados.map((c) => porCombo.get(c.id)).filter((a): a is ComboAplicado => Boolean(a));
  return { aplicados, porciones: Array.from(porciones.values()), descuento: aplicados.reduce((t, a) => t + a.descuento, 0) };
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * Parte cada renglón en lo que va suelto (a su precio) y lo que entró en cada
 * combo (con el descuento repartido). `subtotal` es lo que se cobra de ese
 * pedazo; `precioUnitario` es ese subtotal dividido las unidades.
 */
export function partirEnCombos<T extends { cantidad: number; precioUnitario: number }>(
  items: T[],
  claveDe: (item: T) => string,
  porciones: PorcionCombo[]
): (T & { subtotal: number; idCombo: string | null })[] {
  const salida: (T & { subtotal: number; idCombo: string | null })[] = [];
  for (const item of items) {
    const suyas = porciones.filter((p) => p.clave === claveDe(item));
    const enCombo = suyas.reduce((t, p) => t + p.unidades, 0);
    const sueltas = item.cantidad - enCombo;
    if (sueltas > 0) salida.push({ ...item, cantidad: sueltas, subtotal: redondear(item.precioUnitario * sueltas), idCombo: null });
    for (const p of suyas) {
      const subtotal = redondear(item.precioUnitario * p.unidades - p.descuento);
      salida.push({ ...item, cantidad: p.unidades, precioUnitario: redondear(subtotal / p.unidades), subtotal, idCombo: p.idCombo });
    }
  }
  return salida;
}
