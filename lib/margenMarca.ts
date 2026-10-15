// Cuánto le queda a una marca de una venta, según cómo pague el cliente.
//
// Las mismas seis deducciones y las mismas cuentas que construirLineas() en
// liquidaciones/actions.ts — que es el motor que de verdad le paga. Si esto
// dijera otra cosa, la marca vería un número en su portal y cobraría otro, y
// la discusión la perdemos nosotros.
//
// La diferencia es el para qué: construirLineas liquida ventas que ya pasaron;
// esto simula una venta que todavía no ocurrió, para poder mostrar "si te pagan
// con crédito te queda esto" antes de que pase.
import type { SupabaseClient } from "@supabase/supabase-js";

export type MedioSimulado = "EFECTIVO" | "DINERO_CUENTA" | "DEBITO" | "CREDITO";

export const MEDIOS_SIMULADOS: { clave: MedioSimulado; etiqueta: string }[] = [
  { clave: "EFECTIVO", etiqueta: "Efectivo" },
  { clave: "DINERO_CUENTA", etiqueta: "QR · dinero en cuenta" },
  { clave: "DEBITO", etiqueta: "Tarjeta de débito" },
  { clave: "CREDITO", etiqueta: "Tarjeta de crédito" },
];

export type CondicionesMarca = {
  royalty: number;
  ivaRoyalty: number;
  trasladarIvaComision: boolean;
  trasladarIvaComisionEfectivo: boolean;
  trasladarComisionCobro: boolean;
  trasladarSircreb: boolean;
  trasladarImpCreditos: boolean;
  trasladarImpDebitos: boolean;
};

export type TasasGenerales = {
  impCreditos: number;
  impDebitos: number;
  sircreb: number;
  ivaGeneral: number;
  mpPorMedio: Record<string, number>;
};

export type MargenSimulado = {
  medio: MedioSimulado;
  etiqueta: string;
  precio: number;
  comisionWiigo: number;
  ivaComision: number;
  comisionMp: number;
  impCreditos: number;
  impDebitos: number;
  /** Retenido, no es un costo: se devuelve o se compensa. */
  sircreb: number;
  /** Lo que WiiGo le transfiere. */
  leTransferimos: number;
  /** Lo que dijo que le cuesta el producto. Null si no lo cargó. */
  costo: number | null;
  /** leTransferimos − costo. Null si no hay costo cargado. */
  leQueda: number | null;
  /** Qué % de lo que pagó el cliente termina siendo suyo. */
  porcentaje: number | null;
};

function r2(v: number) {
  return Math.round(v * 100) / 100;
}

/**
 * Cómo se llama SIRCREB en las pantallas que ve la marca.
 *
 * "SIRCREB" es el nombre del régimen y es el correcto para hablar con un
 * contador, pero del otro lado hay alguien que fabrica suplementos: un
 * acrónimo que no significa nada se saltea, y lo que no se entiende no se
 * discute. Adentro de WiiGo —Liquidaciones, Configuración, la ficha de la
 * marca— sigue diciendo SIRCREB, que es donde esa precisión sirve.
 *
 * Las dos formas son el mismo concepto: la corta es para encabezados de
 * columna, donde la larga no entra.
 */
export const ETIQUETA_RETENCION = "Retenciones impositivas";
export const ETIQUETA_RETENCION_CORTA = "Retenciones";

/**
 * Redondear un precio para arriba, al múltiplo configurado.
 *
 * Para arriba y no al más cercano: un cartel de góndola con centavos no
 * existe, y redondear para abajo le come margen a la marca en cada venta.
 * Con múltiplo 0 queda como está.
 */
export function redondearPrecio(valor: number, multiplo: number): number {
  if (!Number.isFinite(valor) || valor <= 0) return 0;
  if (!Number.isFinite(multiplo) || multiplo <= 0) return r2(valor);
  return Math.ceil(valor / multiplo) * multiplo;
}

/**
 * Qué precio hay que poner para que a la marca le quede un % determinado.
 *
 * Es la cuenta al revés de `simularMargen`, y es la que la marca necesita de
 * verdad: nadie elige un precio mirando el precio, lo elige mirando cuánto le
 * queda.
 *
 * El porcentaje es sobre LO QUE PAGA EL CLIENTE, no sobre el costo. Es la
 * medida que se usa en retail y la única que hace comparable un producto con
 * otro; sobre el costo el mismo precio daría un número bastante más grande y
 * la marca creería que gana más de lo que gana.
 *
 * Todas las deducciones son proporcionales al precio, así que la tasa total
 * se saca simulando a un precio cualquiera en vez de volver a escribir la
 * fórmula. Si mañana cambia cómo se descuenta algo, esto lo sigue solo.
 */
export function precioParaMargen(params: {
  margenDeseado: number;
  costo: number;
  marca: CondicionesMarca;
  tasas: TasasGenerales;
  medio?: MedioSimulado;
}): number | null {
  const { margenDeseado, costo, marca, tasas, medio = "CREDITO" } = params;
  if (!Number.isFinite(costo) || costo <= 0) return null;
  if (!Number.isFinite(margenDeseado) || margenDeseado < 0 || margenDeseado >= 100) return null;

  const base = 10000;
  const sim = simularMargen({ precio: base, costo: null, marca, tasas }).find((m) => m.medio === medio);
  if (!sim) return null;

  // Cuánto del precio le queda después de comisiones e impuestos.
  const queda = sim.leTransferimos / base;
  const m = margenDeseado / 100;

  // precio × queda − costo = m × precio  →  precio = costo / (queda − m)
  const divisor = queda - m;
  // Pedir más margen del que deja el precio entero es imposible: no hay
  // precio que lo cumpla, por alto que sea.
  if (divisor <= 0.0001) return null;

  return r2(costo / divisor);
}

const CLAVE_MP: Record<MedioSimulado, string> = {
  EFECTIVO: "",
  DINERO_CUENTA: "MP_COMISION_DINERO_CUENTA",
  DEBITO: "MP_COMISION_DEBITO",
  CREDITO: "MP_COMISION_CREDITO",
};

export async function tasasGeneralesParaSimular(supabase: SupabaseClient): Promise<TasasGenerales> {
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", [
      "IMP_CREDITOS_PORCENTAJE",
      "IMP_DEBITOS_PORCENTAJE",
      "SIRCREB_PORCENTAJE",
      "IVA_GENERAL_PORCENTAJE",
      "MP_COMISION_DINERO_CUENTA",
      "MP_COMISION_DEBITO",
      "MP_COMISION_CREDITO",
    ]);
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.parametro, Number(r.valor ?? 0)]));
  return {
    impCreditos: cfg.IMP_CREDITOS_PORCENTAJE ?? 0,
    impDebitos: cfg.IMP_DEBITOS_PORCENTAJE ?? 0,
    sircreb: cfg.SIRCREB_PORCENTAJE ?? 0,
    ivaGeneral: cfg.IVA_GENERAL_PORCENTAJE ?? 21,
    mpPorMedio: {
      MP_COMISION_DINERO_CUENTA: cfg.MP_COMISION_DINERO_CUENTA ?? 0,
      MP_COMISION_DEBITO: cfg.MP_COMISION_DEBITO ?? 0,
      MP_COMISION_CREDITO: cfg.MP_COMISION_CREDITO ?? 0,
    },
  };
}

export async function condicionesDeMarca(
  supabase: SupabaseClient,
  idMarca: string
): Promise<CondicionesMarca | null> {
  const { data } = await supabase
    .from("marcas")
    .select(
      "royalty_porcentaje, iva_royalty_porcentaje, trasladar_iva_comision, trasladar_iva_comision_efectivo, trasladar_comision_cobro, trasladar_sircreb, trasladar_imp_creditos, trasladar_imp_debitos"
    )
    .eq("id_marca", idMarca)
    .maybeSingle();
  if (!data) return null;
  return {
    royalty: (data.royalty_porcentaje as number) ?? 0,
    ivaRoyalty: (data.iva_royalty_porcentaje as number) ?? 0,
    trasladarIvaComision: Boolean(data.trasladar_iva_comision),
    // Si la columna no existe todavía, se asume true: es lo que el sistema
    // hacía antes y lo que sigue haciendo la liquidación.
    trasladarIvaComisionEfectivo: (data.trasladar_iva_comision_efectivo as boolean | null) ?? true,
    trasladarComisionCobro: Boolean(data.trasladar_comision_cobro),
    trasladarSircreb: Boolean(data.trasladar_sircreb),
    trasladarImpCreditos: Boolean(data.trasladar_imp_creditos),
    trasladarImpDebitos: Boolean(data.trasladar_imp_debitos),
  };
}

/**
 * La cuenta de una venta, medio por medio.
 *
 * El efectivo no paga nada bancario — ni comisión de Mercado Pago, ni impuesto
 * al cheque, ni SIRCREB — porque esa plata no pasa por una cuenta. Es la razón
 * por la que a la marca le conviene tanto que le paguen en efectivo, y la que
 * justifica tener un precio de contado más barato.
 */
export function simularMargen(params: {
  precio: number;
  costo: number | null;
  marca: CondicionesMarca;
  tasas: TasasGenerales;
}): MargenSimulado[] {
  const { precio, costo, marca, tasas } = params;

  return MEDIOS_SIMULADOS.map(({ clave, etiqueta }) => {
    const esEfectivo = clave === "EFECTIVO";

    const comisionWiigo = r2(precio * (marca.royalty / 100));
    const cobraIva =
      marca.trasladarIvaComision && !(esEfectivo && !marca.trasladarIvaComisionEfectivo);
    const ivaComision = cobraIva ? r2(comisionWiigo * (marca.ivaRoyalty / 100)) : 0;

    const tasaMp = esEfectivo ? 0 : tasas.mpPorMedio[CLAVE_MP[clave]] ?? 0;
    const comisionMp =
      !esEfectivo && marca.trasladarComisionCobro
        ? r2(precio * ((tasaMp * (1 + tasas.ivaGeneral / 100)) / 100))
        : 0;

    const impCreditos =
      !esEfectivo && marca.trasladarImpCreditos ? r2(precio * (tasas.impCreditos / 100)) : 0;
    const impDebitos =
      !esEfectivo && marca.trasladarImpDebitos ? r2(precio * (tasas.impDebitos / 100)) : 0;
    const sircreb = !esEfectivo && marca.trasladarSircreb ? r2(precio * (tasas.sircreb / 100)) : 0;

    const leTransferimos = r2(
      precio - comisionWiigo - ivaComision - comisionMp - impCreditos - impDebitos - sircreb
    );
    const leQueda = costo != null ? r2(leTransferimos - costo) : null;

    return {
      medio: clave,
      etiqueta,
      precio,
      comisionWiigo,
      ivaComision,
      comisionMp,
      impCreditos,
      impDebitos,
      sircreb,
      leTransferimos,
      costo,
      leQueda,
      porcentaje: leQueda != null && precio > 0 ? r2((leQueda / precio) * 100) : null,
    };
  });
}
