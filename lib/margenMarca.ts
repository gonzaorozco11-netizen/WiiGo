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
