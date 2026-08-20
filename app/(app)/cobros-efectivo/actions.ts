"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

export async function confirmarCobro(idVenta: string, montoRecibido: number) {
  const supabase = getSupabaseServerClient();

  const { data: venta, error: errorVenta } = await supabase
    .from("ventas")
    .select("id_venta, id_cliente, id_local, total, estado")
    .eq("id_venta", idVenta)
    .maybeSingle();
  if (errorVenta) throw new Error(friendlyDbError(errorVenta));
  if (!venta) throw new Error("No se encontró el pedido");
  if (venta.estado !== "PENDIENTE_PAGO") throw new Error("Este pedido ya no está pendiente de pago");

  const total = venta.total ?? 0;
  if (montoRecibido < total) throw new Error("El monto recibido es menor al total del pedido");

  const usuario = await usuarioActual();
  const vuelto = montoRecibido - total;

  // El efectivo no tiene comisión ni conciliación externa: neto = bruto,
  // y queda acreditado en el momento (a diferencia de una liquidación de
  // Mercado Pago, que se concilia después).
  const { data: pago, error: errorPago } = await supabase
    .from("pagos")
    .insert({
      id_venta: idVenta,
      medio: "EFECTIVO",
      forma_pago_cliente: "EFECTIVO",
      importe_bruto: total,
      neto_acreditado: total,
      fecha_pago: new Date().toISOString(),
      fecha_acreditacion: new Date().toISOString(),
      estado: "ACREDITADO",
      estado_conciliacion: "CONCILIADO",
      observaciones: `Confirmado por ${usuario ?? "personal"} · Pagó con $${montoRecibido} · Vuelto $${vuelto}`,
    })
    .select("id_pago")
    .single();
  if (errorPago) throw new Error(friendlyDbError(errorPago));

  const { error: errorVentaUpdate } = await supabase
    .from("ventas")
    .update({ estado: "PAGADA", id_pago: pago.id_pago, total_cobrado: montoRecibido })
    .eq("id_venta", idVenta);
  if (errorVentaUpdate) throw new Error(friendlyDbError(errorVentaUpdate));

  const { data: detalle, error: errorDetalle } = await supabase
    .from("detalle_ventas")
    .select("id_detalle, id_variante, cantidad")
    .eq("id_venta", idVenta);
  if (errorDetalle) throw new Error(friendlyDbError(errorDetalle));

  let puntosGenerados = 0;

  for (const linea of detalle ?? []) {
    const { data: variante } = await supabase
      .from("variantes_producto")
      .select("id_producto")
      .eq("id_variante", linea.id_variante)
      .maybeSingle();
    const { data: producto } = variante
      ? await supabase.from("productos").select("puntos").eq("id_producto", variante.id_producto).maybeSingle()
      : { data: null };
    const puntosLinea = (producto?.puntos ?? 0) * linea.cantidad;
    puntosGenerados += puntosLinea;

    if (puntosLinea > 0) {
      await supabase.from("detalle_ventas").update({ puntos_generados: puntosLinea }).eq("id_detalle", linea.id_detalle);
    }

    const { data: stockActual } = await supabase
      .from("stock")
      .select("cantidad")
      .eq("id_variante", linea.id_variante)
      .eq("id_local", venta.id_local)
      .maybeSingle();
    const nuevaCantidad = Math.max((stockActual?.cantidad ?? 0) - linea.cantidad, 0);

    const { error: errorStock } = await supabase
      .from("stock")
      .upsert(
        {
          id_variante: linea.id_variante,
          id_local: venta.id_local,
          cantidad: nuevaCantidad,
          fecha_actualizacion: new Date().toISOString(),
        },
        { onConflict: "id_variante,id_local" }
      );
    if (errorStock) throw new Error(friendlyDbError(errorStock));

    await supabase.from("movimientos_stock").insert({
      id_variante: linea.id_variante,
      id_local: venta.id_local,
      tipo: "VENTA",
      cantidad: -linea.cantidad,
      motivo: "Venta Self Checkout",
      id_referencia: idVenta,
      usuario,
    });
  }

  if (venta.id_cliente && puntosGenerados > 0) {
    const { data: cliente } = await supabase
      .from("clientes")
      .select("puntos")
      .eq("id_cliente", venta.id_cliente)
      .maybeSingle();
    await supabase
      .from("clientes")
      .update({ puntos: (cliente?.puntos ?? 0) + puntosGenerados })
      .eq("id_cliente", venta.id_cliente);
  }

  revalidatePath("/cobros-efectivo");
}

export async function cancelarPedido(idVenta: string, motivo: string) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("ventas")
    .update({
      estado: "CANCELADA",
      motivo_cancelacion: motivo || "Cancelado por el personal",
      fecha_cancelacion: new Date().toISOString(),
    })
    .eq("id_venta", idVenta)
    .eq("estado", "PENDIENTE_PAGO");
  if (error) throw new Error(friendlyDbError(error));
  revalidatePath("/cobros-efectivo");
}
