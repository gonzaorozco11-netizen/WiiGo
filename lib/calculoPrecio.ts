// El precio al público de lo que compra WiiGo (marcas PROPIAS), en un solo
// lugar. Lo usan el módulo Precios y, del lado del servidor, "Pasar a la
// venta" (que recalcula todo acá y no confía en lo que mandó la pantalla).
// Sin imports de servidor: corre igual en el navegador, mientras se escribe.
//
// La cuenta es la que definió Gonzalo (2026-10-28), en este orden:
//   1. Margen aplicado = el del producto, si no el del rubro, si no el por defecto.
//   2. CT (costos sobre el total cobrado) = comisión del medio + impuesto al
//      cheque (+ SIRCREB solo si no se descuenta de Ingresos Brutos), según lo
//      que esté tildado para ese medio.
//   3. Precio neto = costo ÷ (1 − margen − IIBB − (1 + IVA) × CT). Es una
//      división: el margen y los impuestos son un porcentaje del precio, no
//      del costo. El (1 + IVA) va porque la comisión y el cheque se cobran
//      sobre el total con IVA.
//   4. Con IVA = neto × (1 + IVA). El IVA se suma una sola vez, al final.
//   5. Al público = con IVA redondeado hacia arriba al múltiplo configurado.
// Su prueba (costo $1.150, 35 %, crédito 6,49 %, cheque 0,6 %, redondeo $50)
// da $2.152,71 / $2.604,78 / $2.650; ganancia $786,50 crédito, $937,28 QR,
// $974,38 efectivo. Ver PRUEBA_PRECIO más abajo.
//
// El IVA de la compra nunca va al costo (se recupera como crédito fiscal), y
// las retenciones y percepciones no van al precio.

export type Medio = "efectivo" | "qr" | "debito" | "credito";
export const MEDIOS: { clave: Medio; nombre: string }[] = [
  { clave: "efectivo", nombre: "Efectivo" },
  { clave: "qr", nombre: "QR con dinero en cuenta" },
  { clave: "debito", nombre: "Débito" },
  { clave: "credito", nombre: "Crédito" },
];

/** Qué se le resta a la ganancia en cada medio. Lo tilda Gonzalo en Configuración. */
export type Descuenta = { iva: boolean; iibb: boolean; com: boolean; cheque: boolean; sircreb: boolean };

export type ConfigPrecios = {
  ivaGeneral: number; // %
  iibb: number; // % sobre el precio sin IVA
  cheque: number; // % sobre el total cobrado
  sircreb: number; // % sobre el total cobrado
  sircrebDescontable: boolean; // si es un adelanto de IIBB, no es un costo
  comisiones: Record<Medio, number>; // % sin IVA
  descuenta: Record<Medio, Descuenta>;
  escenario: Medio; // para qué medio se calcula el precio de lista
  margenDefecto: number; // %
  gastosFijos: number; // $ por mes
  ventas: number; // $ por mes, con IVA
  colchon: number; // %
  redondeo: number; // $
  merma: number; // % de lo que viene a granel
  etiqueta: number; // $ por bolsita, aparte de la bolsita (0 = todavía no se sabe)
  descuentoEfectivo: number; // %
  tolerancia: number; // % de diferencia con el precio de hoy antes de avisar
};

export const DESCUENTA_DEFECTO: Record<Medio, Descuenta> = {
  efectivo: { iva: true, iibb: true, com: false, cheque: false, sircreb: false },
  qr: { iva: true, iibb: true, com: true, cheque: true, sircreb: true },
  debito: { iva: true, iibb: true, com: true, cheque: true, sircreb: true },
  credito: { iva: true, iibb: true, com: true, cheque: true, sircreb: true },
};

/**
 * Lo que se le compra al proveedor: el costo de su lista, por kg, por bolsa
 * (BULTO: kgBulto son los kg que trae) o por caja (CAJA: kgBulto son las
 * unidades que trae; cada producto que sale de ahí es una unidad).
 */
export type Granel = { id: string; nombre: string; costo: number; unidad: "KG" | "BULTO" | "CAJA"; kgBulto: number | null };
export type Envase = { id: string; nombre: string; costo: number };

export type ProductoPrecio = {
  id: string;
  /** Si sale de un granel, el costo es gramos × costo por kg (+ merma). */
  idGranel: string | null;
  gramos: number | null;
  /** Costo neto por unidad, para lo que viene envasado. */
  costoUnidad: number | null;
  idEnvase: string | null;
  /** Lo que estaba cargado como bolsita antes del módulo (costos_extra). */
  costoExtra: number;
  iva: number | null; // % de venta del producto; null = el general
  margen: number | null; // %
  descuentoEfectivo: number | null; // %
  rubro: { margen: number | null; descuentoEfectivo: number | null } | null;
};

export type Costo = { mercaderia: number; merma: number; envase: number; etiqueta: number; total: number; porKg: number | null };

/** Costo por kg; en una CAJA, costo por unidad. */
export function costoPorKg(g: Granel): number | null {
  if (g.unidad === "KG") return g.costo;
  return g.kgBulto && g.kgBulto > 0 ? g.costo / g.kgBulto : null;
}

/** Lo que cuesta la mercadería de un producto que sale de ese granel (sin merma ni bolsita). */
export function mercaderiaDe(g: Granel, gramos: number | null): number | null {
  const base = costoPorKg(g);
  if (base == null) return null;
  if (g.unidad === "CAJA") return base;
  return gramos && gramos > 0 ? (base * gramos) / 1000 : null;
}

export function costoDe(p: ProductoPrecio, cfg: ConfigPrecios, granel: Map<string, Granel>, envases: Map<string, Envase>): Costo | null {
  const envase = p.idEnvase ? envases.get(p.idEnvase)?.costo ?? 0 : p.costoExtra ?? 0;
  // La etiqueta va en todo lo que se embolsa acá; lo que viene envasado de
  // fábrica ya trae su rótulo.
  const etiqueta = p.idEnvase ? cfg.etiqueta : 0;
  if (p.idGranel) {
    const g = granel.get(p.idGranel);
    const porKg = g ? costoPorKg(g) : null;
    if (g && g.unidad === "CAJA" && porKg != null) {
      // Se vende de a una, como viene: no hay fraccionado ni merma.
      return { mercaderia: porKg, merma: 0, envase, etiqueta, total: porKg + envase + etiqueta, porKg: null };
    }
    if (porKg == null || !p.gramos || p.gramos <= 0) return null;
    const mercaderia = (porKg * p.gramos) / 1000;
    const merma = mercaderia * (cfg.merma / 100);
    return { mercaderia, merma, envase, etiqueta, total: mercaderia + merma + envase + etiqueta, porKg };
  }
  if (p.costoUnidad == null || p.costoUnidad <= 0) return null;
  return { mercaderia: p.costoUnidad, merma: 0, envase, etiqueta, total: p.costoUnidad + envase + etiqueta, porKg: null };
}

/** Costos sobre el total cobrado para un medio, según lo tildado. */
export function costosSobreTotal(medio: Medio, cfg: ConfigPrecios): number {
  const d = cfg.descuenta[medio];
  return (
    (d.com ? (cfg.comisiones[medio] ?? 0) / 100 : 0) +
    (d.cheque ? cfg.cheque / 100 : 0) +
    (d.sircreb && !cfg.sircrebDescontable ? cfg.sircreb / 100 : 0)
  );
}

/** Gastos fijos ÷ ventas sin IVA + colchón. Sin datos, 10 %. */
export function margenMinimo(cfg: ConfigPrecios): number {
  const ventasNetas = cfg.ventas / (1 + cfg.ivaGeneral / 100);
  return cfg.gastosFijos > 0 && ventasNetas > 0 ? cfg.gastosFijos / ventasNetas + cfg.colchon / 100 : 0.1;
}

export function redondearArriba(n: number, multiplo: number) {
  const m = multiplo > 0 ? multiplo : 1;
  // Se redondea a centavos antes para que 2.650,0000001 no salte a 2.700.
  return Math.ceil(Math.round(n * 100) / 100 / m) * m;
}

export function redondearAbajo(n: number, multiplo: number) {
  const m = multiplo > 0 ? multiplo : 1;
  return Math.floor(Math.round(n * 100) / 100 / m) * m;
}

export type Ganancia = { ganancia: number; margen: number };

export type ResultadoPrecio =
  | { ok: false; error: string; costo: Costo | null; margen: number; origenMargen: "producto" | "rubro" | "defecto" }
  | {
      ok: true;
      costo: Costo;
      margen: number; // fracción
      origenMargen: "producto" | "rubro" | "defecto";
      iva: number; // fracción
      divisor: number;
      neto: number;
      conIva: number;
      publico: number;
      descuentoEfectivo: number; // fracción
      efectivo: number;
      porMedio: Record<Medio, Ganancia>;
      enEfectivo: Ganancia; // al precio de efectivo
      enEscenario: Ganancia;
      margenMinimo: number;
      descuentoMaximoEfectivo: number; // fracción
    };

export function calcularPrecio(p: ProductoPrecio, cfg: ConfigPrecios, granel: Map<string, Granel>, envases: Map<string, Envase>): ResultadoPrecio {
  const origenMargen = p.margen != null ? "producto" : p.rubro?.margen != null ? "rubro" : "defecto";
  const margen = (p.margen ?? p.rubro?.margen ?? cfg.margenDefecto) / 100;
  const costo = costoDe(p, cfg, granel, envases);
  if (!costo) return { ok: false, error: p.idGranel ? "Faltan los gramos o el costo del granel." : "Falta el costo.", costo, margen, origenMargen };

  const iva = (p.iva ?? cfg.ivaGeneral) / 100;
  const iibb = cfg.iibb / 100;
  // El precio de lista se arma siempre con IVA e IIBB: es el que cobra la caja.
  const divisor = 1 - margen - iibb - (1 + iva) * costosSobreTotal(cfg.escenario, cfg);
  if (divisor <= 0) {
    return { ok: false, error: "El margen más los impuestos y las comisiones pasan el 100 %: no hay precio posible. Bajá el margen.", costo, margen, origenMargen };
  }
  const neto = costo.total / divisor;
  const conIva = neto * (1 + iva);
  const publico = redondearArriba(conIva, cfg.redondeo);

  // Lo que queda según cómo paga, restando solo lo tildado para ese medio.
  const ganancia = (medio: Medio, precio: number): Ganancia => {
    const d = cfg.descuenta[medio];
    const netoReal = d.iva ? precio / (1 + iva) : precio;
    const g = netoReal - costo.total - (d.iibb ? netoReal * iibb : 0) - precio * costosSobreTotal(medio, cfg);
    return { ganancia: g, margen: netoReal > 0 ? g / netoReal : 0 };
  };

  const descuentoEfectivo = (p.descuentoEfectivo ?? p.rubro?.descuentoEfectivo ?? cfg.descuentoEfectivo) / 100;
  // El de efectivo se redondea hacia ABAJO: hacia arriba, en lo barato el
  // redondeo se comía el descuento ($900 − 10 % = $810 volvía a $900). Así el
  // que paga en efectivo siempre tiene al menos el descuento que dice el
  // cartel (Gonzalo, 2026-10-29).
  const conDescuento = publico * (1 - descuentoEfectivo);
  const efectivo = descuentoEfectivo > 0 ? redondearAbajo(conDescuento, cfg.redondeo) || redondearArriba(conDescuento, 1) : publico;
  const minimo = margenMinimo(cfg);
  // El precio en efectivo que deja el margen real justo en el mínimo.
  const dEf = cfg.descuenta.efectivo;
  const factorNeto = dEf.iva ? 1 / (1 + iva) : 1;
  const denominador = factorNeto * (1 - (dEf.iibb ? iibb : 0) - minimo) - costosSobreTotal("efectivo", cfg);
  const precioMinimoEfectivo = denominador > 0 ? costo.total / denominador : Infinity;
  const porMedio = Object.fromEntries(MEDIOS.map((m) => [m.clave, ganancia(m.clave, publico)])) as Record<Medio, Ganancia>;

  return {
    ok: true,
    costo,
    margen,
    origenMargen,
    iva,
    divisor,
    neto,
    conIva,
    publico,
    descuentoEfectivo,
    efectivo,
    porMedio,
    enEfectivo: ganancia("efectivo", efectivo),
    enEscenario: porMedio[cfg.escenario],
    margenMinimo: minimo,
    descuentoMaximoEfectivo: Number.isFinite(precioMinimoEfectivo) ? 1 - precioMinimoEfectivo / publico : 0,
  };
}

/** ¿El precio de hoy está lejos del que da la cuenta? Con tolerancia, para no cambiar la góndola por $100. */
export function hayQueActualizar(publico: number, hoy: number | null, tolerancia: number) {
  if (!hoy || hoy <= 0) return true;
  return Math.abs(publico - hoy) / hoy > tolerancia / 100;
}

// La prueba de Gonzalo, con sus números fijos (aparte de la configuración).
export const PRUEBA_PRECIO = {
  cfg: {
    ivaGeneral: 21, iibb: 3, cheque: 0.6, sircreb: 5, sircrebDescontable: true,
    comisiones: { efectivo: 0, qr: 0.8, debito: 1.24, credito: 6.49 },
    descuenta: DESCUENTA_DEFECTO, escenario: "credito", margenDefecto: 35,
    gastosFijos: 0, ventas: 0, colchon: 5, redondeo: 50, merma: 0, etiqueta: 0, descuentoEfectivo: 0, tolerancia: 0,
  } satisfies ConfigPrecios,
  producto: {
    id: "prueba", idGranel: null, gramos: null, costoUnidad: 1150, idEnvase: null, costoExtra: 0, iva: 21,
    margen: 35, descuentoEfectivo: 0, rubro: null,
  } satisfies ProductoPrecio,
  esperado: { neto: 2152.71, conIva: 2604.78, publico: 2650, credito: 786.5, qr: 937.28, efectivo: 974.38 },
};
