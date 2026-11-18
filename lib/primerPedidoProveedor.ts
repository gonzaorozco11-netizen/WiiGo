import type { SupabaseClient } from "@supabase/supabase-js";

// El primer pedido a Alifrut (Gonzalo, 17/11).
//
// No pasó por Compras: la mercadería ya estaba en el local cuando arrancó el
// sistema. Se registró después como una orden + recepción del 11/11 con los
// costos de la lista del 17/11 (scratchpad/pedido1-registrar.cjs), y su
// resumen quedó en configuracion.PRIMER_PEDIDO_ALIFRUT.
//
// Lo que falta pagarle de ese pedido es lo que todavía no se liquidó: lo que
// queda en sus lotes (cantidad_disponible_fifo × costo). Cada liquidación
// consume primero los lotes más viejos —este— así que se resta sola. Lo que
// no tiene producto todavía (las chocobolitas) se cuenta aparte, entero.
//
// No es deuda nueva: el «le debés» del proveedor sigue siendo lo liquidado sin
// pagar. Esto dice cuánto de ese pedido falta liquidar.

export const CLAVE_PRIMER_PEDIDO = "PRIMER_PEDIDO_ALIFRUT";

export type PrimerPedido = {
  fecha: string;
  /** Total del pedido, sin IVA. */
  neto: number;
  /** Lo que todavía no se liquidó, sin IVA. */
  pendienteNeto: number;
  ivaPorcentaje: number;
};

export async function primerPedidoDe(supabase: SupabaseClient, idProveedor: string): Promise<PrimerPedido | null> {
  try {
    const { data: cfg } = await supabase.from("configuracion").select("valor").eq("parametro", CLAVE_PRIMER_PEDIDO).maybeSingle();
    if (!cfg?.valor) return null;
    const r = JSON.parse(cfg.valor as string) as { idRecepcion: string; fecha: string; neto: number; iva?: number; extras?: { neto: number }[] };
    const { data: rec } = await supabase.from("recepciones_proveedor").select("id_proveedor").eq("id_recepcion", r.idRecepcion).maybeSingle();
    if (!rec || rec.id_proveedor !== idProveedor) return null;

    let pendiente = 0;
    for (let i = 0; ; i += 1000) {
      const { data, error } = await supabase
        .from("detalle_recepcion_proveedor")
        .select("cantidad_disponible_fifo, costo_unitario")
        .eq("id_recepcion", r.idRecepcion)
        .range(i, i + 999);
      if (error) return null;
      for (const l of data ?? []) pendiente += Number(l.cantidad_disponible_fifo ?? 0) * Number(l.costo_unitario ?? 0);
      if ((data ?? []).length < 1000) break;
    }
    pendiente += (r.extras ?? []).reduce((a, e) => a + Number(e.neto || 0), 0);
    const redondo = (v: number) => Math.round(v * 100) / 100;
    // Los costos por gramo tienen muchos decimales: unos centavos de diferencia no son algo liquidado.
    const pend = Math.abs(r.neto - pendiente) < 1 ? r.neto : Math.min(r.neto, pendiente);
    return { fecha: r.fecha, neto: redondo(r.neto), pendienteNeto: redondo(pend), ivaPorcentaje: r.iva ?? 21 };
  } catch {
    return null;
  }
}
