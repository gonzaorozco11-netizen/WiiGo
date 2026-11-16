import type { SupabaseClient } from "@supabase/supabase-js";

// Devoluciones por transferencia que todavía nadie mandó (Gonzalo, 2026-11-16).
//
// Cuando se devuelve una venta cobrada por Mercado Pago, el sistema le pide el
// reintegro solo a Mercado Pago si la venta tiene el id del pago (las de QR).
// Las que entraron por TRANSFERENCIA (la tienda online) no lo tienen: la plata
// se la manda a mano el operativo desde la app de Mercado Pago. Al devolver se
// le pregunta «¿ya le enviaste la transferencia?»; si dice que no, queda acá y
// la caja del local no se puede cerrar hasta que la marque como enviada.
//
// Solo cuentan las de este momento en adelante: las devoluciones viejas no se
// preguntaron y no tienen que trabar ninguna caja.
// Columnas: sql/devoluciones-transferencia.sql. Si faltan, no se traba nada.
export const DESDE_CONTROL_TRANSFERENCIAS = "2026-11-16T14:00:00Z";

export type TransferenciaPendiente = {
  idDevolucion: string;
  numeroVenta: number;
  monto: number;
  cliente: string | null;
  fecha: string;
};

export async function transferenciasPendientes(supabase: SupabaseClient, idLocal: string): Promise<TransferenciaPendiente[]> {
  const { data, error } = await supabase
    .from("devoluciones")
    .select("id_devolucion, monto_devuelto, fecha, ventas!inner(numero, id_local, id_cliente)")
    .eq("medio", "MERCADO_PAGO")
    .is("mp_refund_id", null)
    .is("transferencia_enviada_en", null)
    .gt("monto_devuelto", 0)
    .gte("fecha", DESDE_CONTROL_TRANSFERENCIAS)
    .eq("ventas.id_local", idLocal)
    .order("fecha", { ascending: true });
  if (error || !data?.length) return [];

  const idsCliente = [...new Set(data.map((d) => (d.ventas as unknown as { id_cliente: string | null }).id_cliente).filter(Boolean))] as string[];
  const { data: clientes } = idsCliente.length
    ? await supabase.from("clientes").select("id_cliente, nombre, apellido").in("id_cliente", idsCliente)
    : { data: [] as { id_cliente: string; nombre: string | null; apellido: string | null }[] };
  const nombre = new Map((clientes ?? []).map((c) => [c.id_cliente as string, [c.nombre, c.apellido].filter(Boolean).join(" ") || null]));

  return data.map((d) => {
    const v = d.ventas as unknown as { numero: number; id_cliente: string | null };
    return {
      idDevolucion: d.id_devolucion as string,
      numeroVenta: v.numero,
      monto: Number(d.monto_devuelto) || 0,
      cliente: v.id_cliente ? nombre.get(v.id_cliente) ?? null : null,
      fecha: d.fecha as string,
    };
  });
}
