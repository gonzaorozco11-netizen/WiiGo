// Cuenta corriente comercial por marca — lo que la marca le debe a WiiGo
// (fee de ingreso, gasto fijo mensual por el espacio, otros cargos), nunca
// lo que WiiGo le debe a ella (eso es la cuenta de liquidaciones). Mismo
// principio que lib/retencionesMarca.ts: el saldo siempre se deriva de la
// suma de movimientos, nunca se guarda un número suelto.
import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoCargoComercial =
  | "FEE_INGRESO"
  | "GASTO_FIJO_MENSUAL"
  | "OTRO_CARGO"
  | "CARGO_RECURRENTE"
  | "PAGO"
  | "AJUSTE"
  | "COMPENSACION";

export async function saldoCuentaComercial(supabase: SupabaseClient, idMarca: string) {
  const { data } = await supabase.from("movimientos_cuenta_comercial_marca").select("importe").eq("id_marca", idMarca);
  return (data ?? []).reduce((acc, m) => acc + (m.importe ?? 0), 0);
}

export async function historialCuentaComercial(supabase: SupabaseClient, idMarca: string) {
  const { data, error } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("*")
    .eq("id_marca", idMarca)
    .order("fecha", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Si ya se generó el cargo de ese período para esa marca, no lo vuelve a
// crear — evita cobrar el gasto fijo mensual dos veces por accidente.
export async function yaTieneCargoDelPeriodo(supabase: SupabaseClient, idMarca: string, tipoCargo: TipoCargoComercial, periodo: string) {
  const { data } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("id_movimiento")
    .eq("id_marca", idMarca)
    .eq("tipo_cargo", tipoCargo)
    .eq("periodo", periodo)
    .maybeSingle();
  return !!data;
}

export async function registrarMovimientoComercial(
  supabase: SupabaseClient,
  params: {
    idMarca: string;
    idLocal?: string | null;
    tipoCargo: TipoCargoComercial;
    importe: number;
    periodo?: string | null;
    idFee?: string | null;
    idCategoria?: string | null;
    idSubcategoria?: string | null;
    // Desglose opcional del importe (neto + iva = importe) — permite
    // sumar el IVA por separado más adelante para un reporte de IVA a
    // pagar, sin cambiar cómo se calcula el saldo (que sigue siendo la
    // suma de "importe", el total real que afecta la deuda de la marca).
    neto?: number | null;
    iva?: number | null;
    usuario?: string | null;
    observaciones?: string | null;
  }
) {
  const saldoAnterior = await saldoCuentaComercial(supabase, params.idMarca);
  const saldoNuevo = saldoAnterior + params.importe;
  const { error } = await supabase.from("movimientos_cuenta_comercial_marca").insert({
    id_marca: params.idMarca,
    id_local: params.idLocal ?? null,
    tipo_cargo: params.tipoCargo,
    importe: params.importe,
    neto: params.neto ?? null,
    iva: params.iva ?? null,
    saldo_anterior: saldoAnterior,
    saldo_nuevo: saldoNuevo,
    periodo: params.periodo ?? null,
    id_fee: params.idFee ?? null,
    id_categoria: params.idCategoria ?? null,
    id_subcategoria: params.idSubcategoria ?? null,
    usuario: params.usuario ?? null,
    observaciones: params.observaciones ?? null,
  });
  if (error) throw new Error(error.message);
  return saldoNuevo;
}
