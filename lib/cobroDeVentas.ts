import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaDeCobro, type Cobro } from "@/lib/fechaCobro";

// Cuándo entró (o va a entrar) la plata de cada venta: la regla está en
// lib/fechaCobro.ts; acá se buscan la forma de pago y lo que Mercado Pago ya
// liberó (cobros_digitales). Lo usan las liquidaciones de marcas y de Alifrut.

export type VentaParaCobro = { id_venta: string; fecha: string; medio_pago: string | null; id_pago: string | null };

export async function cobroDeVentas(supabase: SupabaseClient, ventas: VentaParaCobro[]): Promise<Map<string, Cobro>> {
  const salida = new Map<string, Cobro>();
  if (ventas.length === 0) return salida;

  const idsPago = [...new Set(ventas.map((v) => v.id_pago).filter((x): x is string => Boolean(x)))];
  const formaDePago = new Map<string, string | null>();
  for (let i = 0; i < idsPago.length; i += 200) {
    const { data } = await supabase.from("pagos").select("id_pago, forma_pago_cliente").in("id_pago", idsPago.slice(i, i + 200));
    for (const p of data ?? []) formaDePago.set(p.id_pago as string, (p.forma_pago_cliente as string | null) ?? null);
  }

  // Lo que Mercado Pago ya liberó: la primera liberación del cobro de esa venta.
  const liberada = new Map<string, string>();
  const idsMp = ventas.filter((v) => v.medio_pago === "MERCADO_PAGO").map((v) => v.id_venta);
  for (let i = 0; i < idsMp.length; i += 200) {
    const { data, error } = await supabase
      .from("cobros_digitales")
      .select("id_venta, fecha")
      .eq("tipo", "payment")
      .in("id_venta", idsMp.slice(i, i + 200));
    if (error) break; // sin sql/cobros-digitales.sql: todo calculado
    for (const c of data ?? []) {
      const id = c.id_venta as string;
      const f = c.fecha as string;
      if (!liberada.has(id) || f < liberada.get(id)!) liberada.set(id, f);
    }
  }

  for (const v of ventas) {
    salida.set(
      v.id_venta,
      fechaDeCobro({
        fecha: v.fecha,
        medio: v.medio_pago,
        forma: v.id_pago ? formaDePago.get(v.id_pago) ?? null : null,
        liberacionMp: liberada.get(v.id_venta) ?? null,
      })
    );
  }
  return salida;
}
