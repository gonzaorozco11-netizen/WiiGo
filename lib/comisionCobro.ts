import type { SupabaseClient } from "@supabase/supabase-js";
import { CLAVE_COMISION_COBRO, POSNET_POR_DEFECTO } from "@/lib/formasPago";

/**
 * La comisión (sin IVA) que cobra Mercado Pago o el posnet por una forma de
 * pago, cargada en Configuración, y el IVA general. Si la del posnet todavía
 * no se cargó, usa la de Nave del 2026-11-04 (ver lib/formasPago.ts).
 */
export async function tasaComisionCobro(supabase: SupabaseClient, formaPago: string) {
  const clave = CLAVE_COMISION_COBRO[formaPago];
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", clave ? [clave, "IVA_GENERAL_PORCENTAJE"] : ["IVA_GENERAL_PORCENTAJE"]);
  const cfg = new Map((data ?? []).map((r) => [r.parametro as string, Number(r.valor ?? 0)]));
  const porDefecto =
    formaPago === "POSNET_DEBITO" ? POSNET_POR_DEFECTO.debito : formaPago === "POSNET_CREDITO" ? POSNET_POR_DEFECTO.credito : 0;
  return {
    base: clave && cfg.has(clave) ? cfg.get(clave)! : porDefecto,
    ivaGeneral: cfg.get("IVA_GENERAL_PORCENTAJE") ?? 21,
  };
}
