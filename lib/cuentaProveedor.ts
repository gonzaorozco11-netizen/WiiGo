// Cuenta corriente de un proveedor propio (Tipo B: insumos/mercadería para
// marca propia) — a diferencia de la cuenta comercial de una marca en
// consignación (lib/cuentaComercialMarca.ts), acá la relación es de un solo
// sentido: WiiGo le debe al proveedor, nunca al revés. La deuda nace con la
// factura, nunca con la orden de compra ni con la recepción (eso es solo
// control físico de stock) — ver detalle_orden_compra/recepciones_proveedor.
// Mismo principio que el resto de los ledgers del proyecto: el saldo siempre
// se deriva de la suma de movimientos, nunca se guarda un número suelto.
import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoMovimientoProveedor = "FACTURA_COMPRA" | "PAGO" | "NOTA_CREDITO" | "AJUSTE";

export async function saldoCuentaProveedor(supabase: SupabaseClient, idProveedor: string) {
  const { data } = await supabase.from("movimientos_cuenta_proveedor").select("importe").eq("id_proveedor", idProveedor);
  return (data ?? []).reduce((acc, m) => acc + (m.importe ?? 0), 0);
}

export async function saldosPorProveedor(supabase: SupabaseClient, idsProveedor: string[]) {
  if (idsProveedor.length === 0) return new Map<string, number>();
  const { data } = await supabase.from("movimientos_cuenta_proveedor").select("id_proveedor, importe").in("id_proveedor", idsProveedor);
  const saldos = new Map<string, number>();
  for (const m of data ?? []) {
    saldos.set(m.id_proveedor, (saldos.get(m.id_proveedor) ?? 0) + (m.importe ?? 0));
  }
  return saldos;
}

export async function historialCuentaProveedor(supabase: SupabaseClient, idProveedor: string) {
  const { data, error } = await supabase
    .from("movimientos_cuenta_proveedor")
    .select("*")
    .eq("id_proveedor", idProveedor)
    .order("fecha", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function registrarMovimientoProveedor(
  supabase: SupabaseClient,
  params: {
    idProveedor: string;
    tipoMovimiento: TipoMovimientoProveedor;
    importe: number;
    idFactura?: string | null;
    usuario?: string | null;
    observaciones?: string | null;
  }
) {
  const saldoAnterior = await saldoCuentaProveedor(supabase, params.idProveedor);
  const saldoNuevo = saldoAnterior + params.importe;
  const { error } = await supabase.from("movimientos_cuenta_proveedor").insert({
    id_proveedor: params.idProveedor,
    tipo_movimiento: params.tipoMovimiento,
    importe: params.importe,
    saldo_anterior: saldoAnterior,
    saldo_nuevo: saldoNuevo,
    id_factura: params.idFactura ?? null,
    usuario: params.usuario ?? null,
    observaciones: params.observaciones ?? null,
  });
  if (error) throw new Error(error.message);
  return saldoNuevo;
}
