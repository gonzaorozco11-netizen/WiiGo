import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COLUMNAS_PEDIDO,
  ESTADOS_ABIERTOS,
  MOTIVO_PAGO_INCOMPLETO,
  MOTIVO_TARJETA_SIN_PAGAR,
  avisarCliente,
  avisarPedidoNuevoAlDueno,
  cuantosHay,
  itemsDe,
  totalesDe,
  type FilaPedidoOnline,
} from "@/lib/pedidosOnline";
import { consultarPagoNave, consultarPedidoNave, crearPagoNave, datosPagoEmbebido, naveConfigurado, referenciasDelPago, secretoAviso } from "@/lib/nave";
import { baseUrlPublica, urlTienda } from "@/lib/urlPublica";

// El pago con tarjeta de un pedido de la tienda (Gonzalo, 18/11). Ver lib/nave.ts.
//   - linkDePagoTarjeta: arma el cobro en Nave y devuelve a dónde mandar al cliente.
//   - registrarPagoTarjeta: cuando Nave avisa (o al revisar), le pregunta a Nave por el
//     pago y, si está aprobado, deja el pedido pagado y le manda el mail al cliente.
// El pedido queda pagado igual que con una transferencia confirmada: el equipo lo ve
// en «Nuevos» listo para aceptar, sin tocar nada.

/** Lo que necesita la tienda para mostrar el pago de Nave adentro de «Finalizar compra». */
export type PagoEmbebido = { id: string; clave: string; env: "production" | "sandbox" };

export async function linkDePagoTarjeta(supabase: SupabaseClient, idPedido: string): Promise<{ url?: string; nave?: PagoEmbebido; error?: string }> {
  if (!naveConfigurado()) return { error: "El pago con tarjeta todavía no está habilitado." };
  const { data } = await supabase.from("pedidos_online").select(COLUMNAS_PEDIDO).eq("id_pedido", idPedido).maybeSingle();
  const p = data as FilaPedidoOnline | null;
  if (!p || p.pago !== "TARJETA") return { error: "Ese pedido no se paga con tarjeta." };
  if (p.pago_ok_at) return { error: "Ese pedido ya está pago." };
  if (!ESTADOS_ABIERTOS.includes(p.estado) && p.estado !== "PAGANDO") return { error: "Ese pedido ya está cerrado." };
  const items = itemsDe(p).filter((i) => cuantosHay(i) > 0);
  const total = totalesDe(items).lista;
  if (!(total > 0)) return { error: "Ese pedido no tiene nada para cobrar." };

  const tienda = urlTienda();
  const base = baseUrlPublica("https://app.wiigo.com.ar");
  try {
    const r = await crearPagoNave({
      referencia: p.codigo,
      total,
      productos: items.map((i) => ({ nombre: `${i.nombre}${i.variante ? ` — ${i.variante}` : ""}`, cantidad: cuantosHay(i), precio: i.precioLista })),
      comprador: { id: p.id_cliente, nombre: p.nombre, email: p.email ?? "", dni: p.dni },
      volverA: `${tienda}?pedido=${encodeURIComponent(p.codigo)}`,
      avisarA: `${base}/api/tienda/nave/aviso?pedido=${encodeURIComponent(p.id_pedido)}&s=${secretoAviso(p.id_pedido)}`,
      // 15 min: el pedido sin pagar se cancela a los 20 (lib/pedidosOnline.ts, 20/11).
      segundos: 900,
    });
    await supabase.from("pedidos_online").update({ nave_pedido_id: r.id }).eq("id_pedido", idPedido);
    // Con la clave pública cargada, la tienda muestra el pago adentro; si no, usa la página de Nave.
    const sdk = datosPagoEmbebido();
    return { url: r.checkoutUrl, nave: sdk ? { id: r.id, ...sdk } : undefined };
  } catch (e) {
    console.error("[nave] link de pago", p.numero, e);
    return { error: "No pudimos abrir el pago con tarjeta. Probá de nuevo en un momento." };
  }
}

/** Nave dice que hubo un pago: se le pregunta a Nave por él antes de creerle. */
export async function registrarPagoTarjeta(
  supabase: SupabaseClient,
  idPedido: string,
  idPagoNave: string,
  yaConsultado?: Awaited<ReturnType<typeof consultarPagoNave>>
): Promise<{ estado: string }> {
  const pago = yaConsultado ?? (await consultarPagoNave(idPagoNave));
  if (pago.estado !== "APROBADO") {
    console.log(`[nave] pago ${idPagoNave} del pedido ${idPedido}: ${pago.crudo}`);
    return { estado: pago.crudo };
  }
  const { data } = await supabase
    .from("pedidos_online")
    .update({ pago_ok_at: new Date().toISOString(), pago_ok_por: "Nave (tarjeta)", nave_pago_id: idPagoNave, nave_forma: pago.forma ?? "POSNET_CREDITO" })
    .eq("id_pedido", idPedido)
    .eq("pago", "TARJETA")
    .is("pago_ok_at", null)
    .select("id_pedido")
    .maybeSingle();
  // Solo el primero que lo marca sigue (Nave puede avisar dos veces).
  if (!data) return { estado: pago.crudo };
  // Pagó dentro de la tienda (PAGANDO, 24/11): recién ahora el pedido existe para todos.
  // Pasa a «Nuevos», le llega al cliente el mail con su palabra secreta (ya pago) y al Dueño
  // el aviso de pedido nuevo, igual que cualquier otro pedido.
  const { data: nacio } = await supabase
    .from("pedidos_online")
    .update({ estado: "NUEVO" })
    .eq("id_pedido", idPedido)
    .eq("estado", "PAGANDO")
    .select("id_pedido")
    .maybeSingle();
  // Si se canceló solo por no pagar a tiempo y el pago entró igual (pagó en el último
  // minuto), vuelve a «Nuevos» pagado: el equipo lo arma o lo cancela devolviendo.
  const { data: revivio } = await supabase
    .from("pedidos_online")
    .update({ estado: "NUEVO", cancelado_at: null, motivo_cancelacion: null })
    .eq("id_pedido", idPedido)
    .eq("estado", "CANCELADO")
    .in("motivo_cancelacion", [MOTIVO_TARJETA_SIN_PAGAR, MOTIVO_PAGO_INCOMPLETO])
    .select("id_pedido, motivo_cancelacion")
    .maybeSingle();
  if (nacio || (revivio && (revivio as { motivo_cancelacion?: string | null }).motivo_cancelacion === MOTIVO_PAGO_INCOMPLETO)) {
    await Promise.all([avisarCliente(supabase, idPedido, "RECIBIDO"), avisarPedidoNuevoAlDueno(supabase, idPedido)]);
  } else {
    await avisarCliente(supabase, idPedido, "PAGO_OK");
  }
  return { estado: pago.crudo };
}

/**
 * El cliente cerró el pago sin terminarlo: el pedido que estaba pagando se cancela en
 * silencio (nunca se mostró). Si el pago entra igual, registrarPagoTarjeta lo revive.
 */
export async function abandonarPagoTarjeta(supabase: SupabaseClient, idPedido: string): Promise<void> {
  await supabase
    .from("pedidos_online")
    .update({ estado: "CANCELADO", cancelado_at: new Date().toISOString(), motivo_cancelacion: MOTIVO_PAGO_INCOMPLETO })
    .eq("id_pedido", idPedido)
    .eq("estado", "PAGANDO")
    .is("pago_ok_at", null);
}

/**
 * Aviso que llega a la dirección fija que se le dio a Nave en el alta (sin ?pedido):
 * se le pregunta a Nave por el pago y el pedido sale de lo que Nave dice del pago
 * (nuestro código o el id de la intención), nunca del aviso.
 */
export async function registrarPagoTarjetaSinPedido(supabase: SupabaseClient, idPagoNave: string): Promise<{ estado: string; idPedido: string | null }> {
  const pago = await consultarPagoNave(idPagoNave);
  const refs = referenciasDelPago(pago.datos);
  if (!refs.length) {
    console.error(`[nave] pago ${idPagoNave} sin referencia de pedido`, JSON.stringify(pago.datos).slice(0, 500));
    return { estado: pago.crudo, idPedido: null };
  }
  const lista = refs.join(",");
  const { data } = await supabase
    .from("pedidos_online")
    .select("id_pedido")
    .eq("pago", "TARJETA")
    .or(`codigo.in.(${lista}),nave_pedido_id.in.(${lista})`)
    .limit(2);
  const filas = (data ?? []) as { id_pedido: string }[];
  if (filas.length !== 1) {
    console.error(`[nave] pago ${idPagoNave}: ${filas.length} pedidos para ${lista}`);
    return { estado: pago.crudo, idPedido: null };
  }
  const r = await registrarPagoTarjeta(supabase, filas[0].id_pedido, idPagoNave, pago);
  return { estado: r.estado, idPedido: filas[0].id_pedido };
}

/**
 * Por si el aviso de Nave no llegó: cuando el cliente mira su pedido sin pagar, se le
 * pregunta a Nave por la intención de pago. Nunca tira.
 */
export async function revisarPagoTarjeta(supabase: SupabaseClient, p: FilaPedidoOnline): Promise<boolean> {
  if (p.pago !== "TARJETA" || p.pago_ok_at || !p.nave_pedido_id || !naveConfigurado()) return false;
  try {
    const r = await consultarPedidoNave(p.nave_pedido_id);
    if (!r.idPago) return false;
    const { estado } = await registrarPagoTarjeta(supabase, p.id_pedido, r.idPago);
    return estado === "APPROVED";
  } catch (e) {
    console.error("[nave] revisar pago", p.numero, e);
    return false;
  }
}
