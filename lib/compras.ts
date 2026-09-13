import { getSupabaseServerClient } from "@/lib/supabase";

// Los contadores de las tres etapas de Compras.
//
// Compras funciona como una cinta: cada pedido está en UNA etapa a la vez.
// Emitido y sin mandar es trabajo de administración; ya enviado y sin llegar
// es trabajo del local; recibido y sin precio vuelve a administración.
//
// Por eso cada contador cuenta lo suyo y no lo mismo que el de al lado: si
// los tres mostraran el total de pedidos abiertos, los números mentirían
// sobre quién tiene qué hacer hoy.

function diasDesde(iso: string) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export async function contadoresCompras(): Promise<{
  ordenesAbiertas: number;
  esperandoRecepcion: number;
  sinCostear: number;
  sinCostearVencidos: number;
}> {
  const supabase = getSupabaseServerClient();

  const [repSinEnviar, provSinEnviar, repEnviadas, provEnviadas, sinCostear] = await Promise.all([
    supabase
      .from("ordenes_reposicion")
      .select("id_orden", { count: "exact", head: true })
      .eq("estado", "PENDIENTE")
      .is("enviada_el", null),
    supabase
      .from("ordenes_compra_proveedor")
      .select("id_orden", { count: "exact", head: true })
      .eq("estado", "PENDIENTE")
      .is("enviada_el", null),
    supabase
      .from("ordenes_reposicion")
      .select("id_orden", { count: "exact", head: true })
      .eq("estado", "PENDIENTE")
      .not("enviada_el", "is", null),
    supabase
      .from("ordenes_compra_proveedor")
      .select("id_orden", { count: "exact", head: true })
      .eq("estado", "PENDIENTE")
      .not("enviada_el", "is", null),
    supabase.from("recepciones_proveedor").select("id_recepcion, fecha").eq("facturada", false).limit(100),
  ]);

  const filas = sinCostear.data ?? [];
  // Más de tres días sin costear ya distorsiona la liquidación del mes.
  const vencidos = filas.filter((r) => diasDesde(r.fecha as string) > 3).length;

  return {
    ordenesAbiertas: (repSinEnviar.count ?? 0) + (provSinEnviar.count ?? 0),
    esperandoRecepcion: (repEnviadas.count ?? 0) + (provEnviadas.count ?? 0),
    sinCostear: filas.length,
    sinCostearVencidos: vencidos,
  };
}
