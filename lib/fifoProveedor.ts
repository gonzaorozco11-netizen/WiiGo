// FIFO para proveedores en modo LIQUIDACION_VENTA (caso Alifrut): cada lote
// recibido (una línea de una recepción) guarda su propio costo real y
// cuánto le queda disponible. Ventas y devoluciones se descuentan siempre
// del lote más viejo con saldo, así la liquidación paga exactamente lo que
// costó cada unidad que salió — no un promedio ni el último costo cargado.
import type { SupabaseClient } from "@supabase/supabase-js";

export type ConsumoLote = { idDetalleRecepcion: string; cantidad: number; costoUnitario: number };
export type ResultadoFifo = { consumos: ConsumoLote[]; costoTotal: number; estimado: boolean };

/** Un lote con su saldo, para consumir de a poco sin volver a la base. */
export type LoteFifo = {
  idDetalleRecepcion: string;
  idRecepcion: string;
  fechaRecepcion: string;
  costoUnitario: number;
  disponible: number;
};

/**
 * Los lotes de una variante, del más viejo al más nuevo, con su saldo.
 *
 * Se expone para poder consumir venta por venta en orden cronológico (ver
 * calcularLiquidacionProveedor). Cuando se consume de a una venta, cada
 * línea se lleva el costo del lote que realmente le tocó — que es lo que
 * permite después mostrar "5 al costo viejo, 7 al nuevo" en vez de un
 * promedio.
 */
export async function lotesDeVariante(
  supabase: SupabaseClient,
  idProveedor: string,
  idVariante: string
): Promise<LoteFifo[]> {
  const { data: recepciones } = await supabase
    .from("recepciones_proveedor")
    .select("id_recepcion, fecha")
    .eq("id_proveedor", idProveedor)
    .order("fecha", { ascending: true });
  const idsRecepcion = (recepciones ?? []).map((r) => r.id_recepcion as string);
  if (idsRecepcion.length === 0) return [];

  const orden = new Map(idsRecepcion.map((id, i) => [id, i]));
  const fecha = new Map((recepciones ?? []).map((r) => [r.id_recepcion as string, r.fecha as string]));

  const { data: lotes } = await supabase
    .from("detalle_recepcion_proveedor")
    .select("id_detalle, id_recepcion, cantidad_disponible_fifo, costo_unitario")
    .eq("id_variante", idVariante)
    .in("id_recepcion", idsRecepcion)
    .gt("cantidad_disponible_fifo", 0)
    .not("costo_unitario", "is", null);

  return (lotes ?? [])
    .slice()
    .sort((a, b) => (orden.get(a.id_recepcion as string) ?? 0) - (orden.get(b.id_recepcion as string) ?? 0))
    .map((l) => ({
      idDetalleRecepcion: l.id_detalle as string,
      idRecepcion: l.id_recepcion as string,
      fechaRecepcion: fecha.get(l.id_recepcion as string) ?? "",
      costoUnitario: (l.costo_unitario as number) ?? 0,
      disponible: (l.cantidad_disponible_fifo as number) ?? 0,
    }));
}

/**
 * Consume una cantidad de una lista de lotes en memoria, bajándoles el saldo.
 *
 * No toca la base: sirve para recorrer las ventas del período en orden sin
 * pisar los saldos reales hasta que la liquidación se confirme.
 */
export function consumirEnMemoria(
  lotes: LoteFifo[],
  cantidad: number,
  costoDeReserva: number
): { consumos: (ConsumoLote & { fechaRecepcion: string })[]; estimado: boolean } {
  const consumos: (ConsumoLote & { fechaRecepcion: string })[] = [];
  let restante = cantidad;
  let ultimoCosto = costoDeReserva;

  for (const lote of lotes) {
    if (restante <= 0) break;
    if (lote.disponible <= 0) continue;
    const tomar = Math.min(lote.disponible, restante);
    lote.disponible -= tomar;
    restante -= tomar;
    ultimoCosto = lote.costoUnitario;
    consumos.push({
      idDetalleRecepcion: lote.idDetalleRecepcion,
      cantidad: tomar,
      costoUnitario: lote.costoUnitario,
      fechaRecepcion: lote.fechaRecepcion,
    });
  }

  if (restante > 0) {
    consumos.push({ idDetalleRecepcion: "ESTIMADO", cantidad: restante, costoUnitario: ultimoCosto, fechaRecepcion: "" });
  }
  return { consumos, estimado: restante > 0 };
}

async function lotesDisponibles(supabase: SupabaseClient, idProveedor: string, idVariante: string) {
  const { data: recepciones } = await supabase
    .from("recepciones_proveedor")
    .select("id_recepcion")
    .eq("id_proveedor", idProveedor)
    .order("fecha", { ascending: true });
  const idsRecepcion = (recepciones ?? []).map((r) => r.id_recepcion as string);
  if (idsRecepcion.length === 0) return [];

  const orden = new Map(idsRecepcion.map((id, i) => [id, i]));
  const { data: lotes } = await supabase
    .from("detalle_recepcion_proveedor")
    .select("id_detalle, id_recepcion, cantidad_disponible_fifo, costo_unitario")
    .eq("id_variante", idVariante)
    .in("id_recepcion", idsRecepcion)
    .gt("cantidad_disponible_fifo", 0)
    .not("costo_unitario", "is", null);

  return (lotes ?? []).slice().sort((a, b) => (orden.get(a.id_recepcion) ?? 0) - (orden.get(b.id_recepcion) ?? 0));
}

// Solo calcula, no escribe nada en la base — para vistas previas (el cálculo
// de la liquidación antes de confirmarla).
export async function simularConsumoFifo(
  supabase: SupabaseClient,
  idProveedor: string,
  idVariante: string,
  cantidad: number,
  costoDeReserva: number | null
): Promise<ResultadoFifo> {
  const lotes = await lotesDisponibles(supabase, idProveedor, idVariante);
  const consumos: ConsumoLote[] = [];
  let restante = cantidad;
  let costoTotal = 0;
  let ultimoCosto = costoDeReserva ?? 0;

  for (const lote of lotes) {
    if (restante <= 0) break;
    const disponible = (lote.cantidad_disponible_fifo as number) ?? 0;
    const costo = lote.costo_unitario as number;
    const tomar = Math.min(disponible, restante);
    if (tomar <= 0) continue;
    consumos.push({ idDetalleRecepcion: lote.id_detalle as string, cantidad: tomar, costoUnitario: costo });
    costoTotal += tomar * costo;
    restante -= tomar;
    ultimoCosto = costo;
  }

  // Si no alcanza con los lotes registrados (stock de antes de este sistema,
  // o algún desajuste puntual), el resto se cubre al último costo conocido
  // — mejor una estimación razonable que romper la liquidación o bloquear
  // una devolución.
  const estimado = restante > 0;
  if (restante > 0) {
    consumos.push({ idDetalleRecepcion: "ESTIMADO", cantidad: restante, costoUnitario: ultimoCosto });
    costoTotal += restante * ultimoCosto;
  }

  return { consumos, costoTotal, estimado };
}

// Descuenta de verdad cantidad_disponible_fifo de los lotes que ya se
// calcularon con simularConsumoFifo — se usa recién al confirmar, nunca en
// una vista previa.
export async function aplicarConsumoLotes(supabase: SupabaseClient, consumos: ConsumoLote[]) {
  for (const consumo of consumos) {
    if (consumo.idDetalleRecepcion === "ESTIMADO") continue;
    const { data: lote } = await supabase
      .from("detalle_recepcion_proveedor")
      .select("cantidad_disponible_fifo")
      .eq("id_detalle", consumo.idDetalleRecepcion)
      .maybeSingle();
    const actual = (lote?.cantidad_disponible_fifo as number | undefined) ?? 0;
    await supabase
      .from("detalle_recepcion_proveedor")
      .update({ cantidad_disponible_fifo: Math.max(actual - consumo.cantidad, 0) })
      .eq("id_detalle", consumo.idDetalleRecepcion);
  }
}

// Simula y aplica en un solo paso — para cuando no hace falta mostrar un
// preview antes de confirmar (como una devolución).
export async function consumirFifo(
  supabase: SupabaseClient,
  idProveedor: string,
  idVariante: string,
  cantidad: number,
  costoDeReserva: number | null
): Promise<ResultadoFifo> {
  const resultado = await simularConsumoFifo(supabase, idProveedor, idVariante, cantidad, costoDeReserva);
  await aplicarConsumoLotes(supabase, resultado.consumos);
  return resultado;
}
