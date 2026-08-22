// Compensación manual entre las tres cuentas de una marca (Liquidaciones,
// Comercial, Retenciones) — nunca automática. Comercial y Retenciones ya
// tienen su propio ledger, así que compensar ahí es un movimiento más
// (tipo COMPENSACION) con importe negativo. Liquidaciones no tiene ledger
// propio (es una lista de liquidaciones cerradas, no una cuenta corriente),
// así que lo compensado contra ella se guarda acá y se resta del total
// pendiente de transferir al mostrarlo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarMovimientoComercial } from "./cuentaComercialMarca";
import { registrarMovimientoRetencion, saldosRetencionPorMarca } from "./retencionesMarca";

export type CuentaMarca = "LIQUIDACIONES" | "COMERCIAL" | "RETENCIONES";

export async function historialCompensaciones(supabase: SupabaseClient, idMarca: string) {
  const { data, error } = await supabase
    .from("compensaciones_marca")
    .select("*")
    .eq("id_marca", idMarca)
    .order("fecha", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function totalCompensadoLiquidaciones(supabase: SupabaseClient, idMarca: string) {
  const { data, error } = await supabase
    .from("compensaciones_marca")
    .select("importe")
    .eq("id_marca", idMarca)
    .or("cuenta_a.eq.LIQUIDACIONES,cuenta_b.eq.LIQUIDACIONES");
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((acc, c) => acc + (c.importe ?? 0), 0);
}

// Registra la compensación y, para las cuentas que tienen ledger propio
// (Comercial y Retenciones), un movimiento negativo que baja su saldo real
// — así el saldo de esas cuentas siempre sale de sumar sus movimientos, sin
// casos especiales. Retenciones se lleva por tipo (SIRCREB, etc.): si hay
// más de un tipo con saldo, se descuenta primero del que tenga más saldo.
export async function registrarCompensacion(
  supabase: SupabaseClient,
  params: {
    idMarca: string;
    cuentaA: CuentaMarca;
    cuentaB: CuentaMarca;
    importe: number;
    usuario: string | null;
    observaciones: string | null;
  }
) {
  const { idMarca, cuentaA, cuentaB, importe, usuario, observaciones } = params;

  const { error } = await supabase.from("compensaciones_marca").insert({
    id_marca: idMarca,
    cuenta_a: cuentaA,
    cuenta_b: cuentaB,
    importe,
    usuario,
    observaciones,
  });
  if (error) throw new Error(error.message);

  for (const [cuenta, otra] of [
    [cuentaA, cuentaB],
    [cuentaB, cuentaA],
  ] as [CuentaMarca, CuentaMarca][]) {
    if (cuenta === "COMERCIAL") {
      await registrarMovimientoComercial(supabase, {
        idMarca,
        tipoCargo: "COMPENSACION",
        importe: -importe,
        usuario,
        observaciones: observaciones ?? `Compensación con ${otra}`,
      });
    } else if (cuenta === "RETENCIONES") {
      let restante = importe;
      const saldos = (await saldosRetencionPorMarca(supabase, idMarca)).filter((s) => s.saldo > 0).sort((a, b) => b.saldo - a.saldo);
      for (const s of saldos) {
        if (restante <= 0) break;
        const aplicar = Math.min(restante, s.saldo);
        await registrarMovimientoRetencion(supabase, {
          idMarca,
          tipoRetencion: s.tipoRetencion,
          tipoMovimiento: "COMPENSACION",
          importe: -aplicar,
          usuario,
          observaciones: observaciones ?? `Compensación con ${otra}`,
        });
        restante -= aplicar;
      }
    }
    // LIQUIDACIONES no tiene ledger propio — ya quedó registrado arriba en
    // compensaciones_marca, y totalCompensadoLiquidaciones lo resta al mostrar.
  }
}
