import type { SupabaseClient } from "@supabase/supabase-js";
import { DESCUENTA_DEFECTO, MEDIOS, type ConfigPrecios, type Descuenta, type Medio } from "@/lib/calculoPrecio";

// La configuración del módulo Precios, en la tabla `configuracion`.
//
// Los impuestos, las comisiones de Mercado Pago y el redondeo son los MISMOS
// parámetros que ya usaban Rentabilidad, el resultado del mes y la ficha del
// producto: cambiarlos acá los cambia en todos lados (decisión de Gonzalo,
// 2026-10-28: "usá las que están en Configuración"). Lo demás es propio del módulo.

export const CLAVES_PRECIOS = {
  ivaGeneral: "IVA_GENERAL_PORCENTAJE",
  iibb: "IIBB_PORCENTAJE",
  cheque: "IMP_CREDITOS_PORCENTAJE",
  sircreb: "SIRCREB_PORCENTAJE",
  sircrebDescontable: "PRECIOS_SIRCREB_DESCONTABLE",
  comisionQr: "MP_COMISION_DINERO_CUENTA",
  comisionDebito: "MP_COMISION_DEBITO",
  comisionCredito: "MP_COMISION_CREDITO",
  descuenta: "PRECIOS_DESCUENTA",
  escenario: "PRECIOS_ESCENARIO",
  margenDefecto: "PRECIOS_MARGEN_DEFECTO",
  gastosFijos: "PRECIOS_GASTOS_FIJOS",
  ventas: "PRECIOS_VENTAS_MES",
  colchon: "PRECIOS_COLCHON",
  redondeo: "REDONDEO_PRECIO",
  merma: "PRECIOS_MERMA",
  descuentoEfectivo: "PRECIOS_DESCUENTO_EFECTIVO",
  tolerancia: "PRECIOS_TOLERANCIA",
} as const;

export const DEFECTOS_PRECIOS: ConfigPrecios = {
  ivaGeneral: 21,
  iibb: 3,
  cheque: 0.6,
  sircreb: 5,
  sircrebDescontable: true,
  comisiones: { efectivo: 0, qr: 0.8, debito: 0.88, credito: 6.15 },
  descuenta: DESCUENTA_DEFECTO,
  escenario: "credito",
  margenDefecto: 35,
  gastosFijos: 0,
  ventas: 0,
  colchon: 5,
  redondeo: 100,
  merma: 3,
  descuentoEfectivo: 10,
  tolerancia: 3,
};

const numero = (v: string | undefined, defecto: number) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : defecto;
};

/** Lee lo guardado; lo que falta (o vino roto) queda con su valor por defecto. */
export function leerDescuenta(valor: string | undefined): Record<Medio, Descuenta> {
  const salida = structuredClone(DESCUENTA_DEFECTO);
  try {
    const guardado = valor ? (JSON.parse(valor) as Partial<Record<Medio, Partial<Descuenta>>>) : {};
    for (const { clave } of MEDIOS) {
      for (const k of Object.keys(salida[clave]) as (keyof Descuenta)[]) {
        const v = guardado?.[clave]?.[k];
        if (typeof v === "boolean") salida[clave][k] = v;
      }
    }
  } catch {
    // Un valor roto no tiene que frenar la pantalla: quedan los de siempre.
  }
  return salida;
}

export async function leerConfigPrecios(supabase: SupabaseClient): Promise<ConfigPrecios> {
  const { data } = await supabase.from("configuracion").select("parametro, valor").in("parametro", Object.values(CLAVES_PRECIOS));
  const v = new Map((data ?? []).map((f) => [f.parametro as string, String(f.valor ?? "")]));
  const d = DEFECTOS_PRECIOS;
  const escenario = v.get(CLAVES_PRECIOS.escenario) as Medio | undefined;
  return {
    ivaGeneral: numero(v.get(CLAVES_PRECIOS.ivaGeneral), d.ivaGeneral),
    iibb: numero(v.get(CLAVES_PRECIOS.iibb), d.iibb),
    cheque: numero(v.get(CLAVES_PRECIOS.cheque), d.cheque),
    sircreb: numero(v.get(CLAVES_PRECIOS.sircreb), d.sircreb),
    sircrebDescontable: (v.get(CLAVES_PRECIOS.sircrebDescontable) ?? "true") !== "false",
    comisiones: {
      efectivo: 0,
      qr: numero(v.get(CLAVES_PRECIOS.comisionQr), d.comisiones.qr),
      debito: numero(v.get(CLAVES_PRECIOS.comisionDebito), d.comisiones.debito),
      credito: numero(v.get(CLAVES_PRECIOS.comisionCredito), d.comisiones.credito),
    },
    descuenta: leerDescuenta(v.get(CLAVES_PRECIOS.descuenta)),
    escenario: escenario && MEDIOS.some((m) => m.clave === escenario) ? escenario : d.escenario,
    margenDefecto: numero(v.get(CLAVES_PRECIOS.margenDefecto), d.margenDefecto),
    gastosFijos: numero(v.get(CLAVES_PRECIOS.gastosFijos), d.gastosFijos),
    ventas: numero(v.get(CLAVES_PRECIOS.ventas), d.ventas),
    colchon: numero(v.get(CLAVES_PRECIOS.colchon), d.colchon),
    redondeo: numero(v.get(CLAVES_PRECIOS.redondeo), d.redondeo) || d.redondeo,
    merma: numero(v.get(CLAVES_PRECIOS.merma), d.merma),
    descuentoEfectivo: numero(v.get(CLAVES_PRECIOS.descuentoEfectivo), d.descuentoEfectivo),
    tolerancia: numero(v.get(CLAVES_PRECIOS.tolerancia), d.tolerancia),
  };
}
