import type { SupabaseClient } from "@supabase/supabase-js";
import { COLUMNAS_PEDIDO, ESTADOS_ABIERTOS, avisarCliente, cuantosHay, itemsDe, totalesDe, type FilaPedidoOnline } from "@/lib/pedidosOnline";
import { consultarPagoNave, consultarPedidoNave, crearPagoNave, naveConfigurado, secretoAviso } from "@/lib/nave";
import { baseUrlPublica, urlTienda } from "@/lib/urlPublica";

// El pago con tarjeta de un pedido de la tienda (Gonzalo, 18/11). Ver lib/nave.ts.
//   - linkDePagoTarjeta: arma el cobro en Nave y devuelve a dónde mandar al cliente.
//   - registrarPagoTarjeta: cuando Nave avisa (o al revisar), le pregunta a Nave por el
//     pago y, si está aprobado, deja el pedido pagado y le manda el mail al cliente.
// El pedido queda pagado igual que con una transferencia confirmada: el equipo lo ve
// en «Nuevos» listo para aceptar, sin tocar nada.

export async function linkDePagoTarjeta(supabase: SupabaseClient, idPedido: string): Promise<{ url?: string; error?: string }> {
  if (!naveConfigurado()) return { error: "El pago con tarjeta todavía no está habilitado." };
  const { data } = await supabase.from("pedidos_online").select(COLUMNAS_PEDIDO).eq("id_pedido", idPedido).maybeSingle();
  const p = data as FilaPedidoOnline | null;
  if (!p || p.pago !== "TARJETA") return { error: "Ese pedido no se paga con tarjeta." };
  if (p.pago_ok_at) return { error: "Ese pedido ya está pago." };
  if (!ESTADOS_ABIERTOS.includes(p.estado)) return { error: "Ese pedido ya está cerrado." };
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
    });
    await supabase.from("pedidos_online").update({ nave_pedido_id: r.id }).eq("id_pedido", idPedido);
    return { url: r.checkoutUrl };
  } catch (e) {
    console.error("[nave] link de pago", p.numero, e);
    return { error: "No pudimos abrir el pago con tarjeta. Probá de nuevo en un momento." };
  }
}

/** Nave dice que hubo un pago: se le pregunta a Nave por él antes de creerle. */
export async function registrarPagoTarjeta(supabase: SupabaseClient, idPedido: string, idPagoNave: string): Promise<{ estado: string }> {
  const pago = await consultarPagoNave(idPagoNave);
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
  // Solo el primero que lo marca manda el mail (Nave puede avisar dos veces).
  if (data) await avisarCliente(supabase, idPedido, "PAGO_OK");
  return { estado: pago.crudo };
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
