// Cuenta corriente de retenciones por marca (SIRCREB, y a futuro otros
// conceptos fiscales) — nunca se guarda un saldo suelto: el saldo siempre
// se deriva de la suma de movimientos, y cada movimiento queda con su
// saldo anterior/nuevo para que el historial sea 100% auditable. Mismo
// principio que lib/canjesProfesionales.ts, aplicado acá a lo fiscal.
import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoRetencion = "SIRCREB" | "IMP_DEBITO_CREDITO" | "OTRO";
export type TipoMovimientoRetencion =
  | "RETENCION"
  | "COMPENSACION"
  | "DEVOLUCION"
  | "AJUSTE_POSITIVO"
  | "AJUSTE_NEGATIVO"
  | "ANULACION";

export type SaldoRetencion = { tipoRetencion: TipoRetencion; saldo: number };

export async function saldoRetencion(supabase: SupabaseClient, idMarca: string, tipoRetencion: TipoRetencion) {
  const { data } = await supabase
    .from("movimientos_retencion_marca")
    .select("importe")
    .eq("id_marca", idMarca)
    .eq("tipo_retencion", tipoRetencion);
  return (data ?? []).reduce((acc, m) => acc + (m.importe ?? 0), 0);
}

export async function saldosRetencionPorMarca(supabase: SupabaseClient, idMarca: string): Promise<SaldoRetencion[]> {
  const { data } = await supabase.from("movimientos_retencion_marca").select("tipo_retencion, importe").eq("id_marca", idMarca);
  const porTipo = new Map<string, number>();
  for (const m of data ?? []) {
    porTipo.set(m.tipo_retencion, (porTipo.get(m.tipo_retencion) ?? 0) + (m.importe ?? 0));
  }
  return [...porTipo.entries()].map(([tipoRetencion, saldo]) => ({ tipoRetencion: tipoRetencion as TipoRetencion, saldo }));
}

export async function historialRetencionMarca(supabase: SupabaseClient, idMarca: string) {
  const { data, error } = await supabase
    .from("movimientos_retencion_marca")
    .select("*")
    .eq("id_marca", idMarca)
    .order("fecha", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// El importe va con signo: positivo suma al saldo (ej. RETENCION), negativo
// lo baja (ej. COMPENSACION, DEVOLUCION). Así el saldo siempre es
// saldoAnterior + importe, sin casos especiales por tipo de movimiento.
export async function registrarMovimientoRetencion(
  supabase: SupabaseClient,
  params: {
    idMarca: string;
    tipoRetencion: TipoRetencion;
    tipoMovimiento: TipoMovimientoRetencion;
    importe: number;
    idVenta?: string | null;
    idLiquidacion?: string | null;
    usuario?: string | null;
    observaciones?: string | null;
  }
) {
  const saldoAnterior = await saldoRetencion(supabase, params.idMarca, params.tipoRetencion);
  const saldoNuevo = saldoAnterior + params.importe;
  const { error } = await supabase.from("movimientos_retencion_marca").insert({
    id_marca: params.idMarca,
    tipo_retencion: params.tipoRetencion,
    tipo_movimiento: params.tipoMovimiento,
    id_venta: params.idVenta ?? null,
    id_liquidacion: params.idLiquidacion ?? null,
    importe: params.importe,
    saldo_anterior: saldoAnterior,
    saldo_nuevo: saldoNuevo,
    usuario: params.usuario ?? null,
    observaciones: params.observaciones ?? null,
  });
  if (error) throw new Error(error.message);
  return saldoNuevo;
}
