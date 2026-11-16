import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { COOKIE_CLIENTE, leerCliente } from "@/lib/tiendaCuenta";
import { precioDe } from "@/lib/precios";
import {
  COLUMNAS_PEDIDO,
  ESTADOS_ABIERTOS,
  avisarCliente,
  avisarPedidoNuevoAlDueno,
  codigoRetiro,
  datosTransferencia,
  itemsDe,
  palabraSecreta,
  pasoCliente,
  reservadoPorVariante,
  totalesDe,
  vencerPedidosOnline,
  venceDe,
  type FilaPedidoOnline,
  type PagoOnline,
} from "@/lib/pedidosOnline";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aplicarCombos } from "@/lib/combos";
import { traerCombos } from "@/lib/combosServidor";

/**
 * Comprar en la tienda online (public/tienda/app.js). Ver lib/pedidosOnline.ts.
 *
 * GET  → los pedidos del cliente que está adentro: los abiertos y los que se
 *        cerraron en los últimos dos días (para el seguimiento).
 * POST → { items: [{ id, v, q }], pago: "TRANSFERENCIA" | "AL_RETIRAR" }: arma el pedido.
 *
 * Pública (vive bajo /api), pero todo pide la cookie del cliente
 * (lib/tiendaCuenta.ts): sin entrar con el DNI y el código no se compra.
 * Los precios y el stock se vuelven a calcular acá: lo que manda el navegador
 * es solo qué productos y cuántos.
 */
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };
const mal = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status, headers: sinCache });

/** Lo que ve el cliente de su pedido. Nada del equipo (quién lo armó, ubicaciones). */
async function vistaCliente(supabase: SupabaseClient, p: FilaPedidoOnline) {
  const items = itemsDe(p);
  const t = totalesDe(items);
  const transferencia = p.pago === "TRANSFERENCIA" && !p.pago_ok_at && ESTADOS_ABIERTOS.includes(p.estado) ? await datosTransferencia(supabase) : null;
  return {
    num: p.numero,
    codigo: p.codigo,
    // Para retirar: su DNI y esta palabra (lib/pedidosOnline.ts).
    palabra: palabraSecreta(p.codigo),
    estado: p.estado,
    paso: pasoCliente(p.estado, items),
    pago: p.pago === "TRANSFERENCIA" ? "transf" : "retiro",
    pagoOk: Boolean(p.pago_ok_at),
    total: t.lista,
    efectivo: t.efectivo,
    original: t.original,
    devolver: Number(p.devolver) || 0,
    devuelto: Boolean(p.devuelto_at),
    motivo: p.motivo_cancelacion,
    creado: p.creado,
    vence: p.vence,
    items: items.map((i) => ({ id: i.idProducto, n: i.nombre, v: i.variante, q: i.cantidad, hay: i.hay, p: i.precioLista, e: i.precioEfectivo })),
    transferencia,
  };
}

export async function GET(req: NextRequest) {
  const idCliente = await leerCliente(req.cookies.get(COOKIE_CLIENTE)?.value);
  if (!idCliente) return NextResponse.json({ pedidos: [] }, { headers: sinCache });
  const supabase = getSupabaseServerClient();
  await vencerPedidosOnline(supabase);
  const hace2Dias = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
  const { data, error } = await supabase
    .from("pedidos_online")
    .select(COLUMNAS_PEDIDO)
    .eq("id_cliente", idCliente)
    .gte("creado", new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
    .order("creado", { ascending: false })
    .limit(10);
  if (error) return NextResponse.json({ pedidos: [] }, { headers: sinCache });
  const filas = ((data ?? []) as FilaPedidoOnline[]).filter(
    (p) => ESTADOS_ABIERTOS.includes(p.estado) || (p.entregado_at ?? p.cancelado_at ?? p.creado) >= hace2Dias
  );
  const pedidos = await Promise.all(filas.slice(0, 5).map((p) => vistaCliente(supabase, p)));
  return NextResponse.json({ pedidos }, { headers: sinCache });
}

type LineaPedida = { id: string; v: string | null; q: number };

export async function POST(req: NextRequest) {
  const idCliente = await leerCliente(req.cookies.get(COOKIE_CLIENTE)?.value);
  if (!idCliente) return mal("Entrá con tu DNI para hacer el pedido.", 401);

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return mal("Pedido inválido.");
  }
  const pago: PagoOnline | null = b.pago === "TRANSFERENCIA" ? "TRANSFERENCIA" : b.pago === "AL_RETIRAR" ? "AL_RETIRAR" : null;
  if (!pago) return mal("Elegí cómo pagás.");

  // Solo qué y cuántos. Las líneas repetidas (mismo producto y sabor) se suman.
  const crudas = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : [];
  const porClave = new Map<string, LineaPedida>();
  for (const c of crudas.slice(0, 60)) {
    const id = typeof c?.id === "string" ? c.id : "";
    const v = typeof c?.v === "string" && c.v.trim() ? c.v.trim() : null;
    const q = Math.floor(Number(c?.q));
    if (!/^[0-9a-f-]{36}$/i.test(id) || !(q > 0) || q > 50) continue;
    const clave = `${id}|${v ?? ""}`;
    const l = porClave.get(clave) ?? { id, v, q: 0 };
    l.q = Math.min(50, l.q + q);
    porClave.set(clave, l);
  }
  const lineas = [...porClave.values()];
  if (lineas.length === 0) return mal("Tu pedido está vacío.");

  const supabase = getSupabaseServerClient();
  try {
    const { data: cliente } = await supabase.from("clientes").select("id_cliente, nombre, apellido, dni, email, estado").eq("id_cliente", idCliente).maybeSingle();
    if (!cliente || cliente.estado === "INACTIVO") return mal("Volvé a entrar con tu DNI.", 401);
    const email = ((cliente.email as string | null) ?? "").trim();
    if (!email) return mal("Tu cuenta no tiene mail. Volvé a entrar con tu DNI.", 401);

    // Un cliente no acumula pedidos sin pagar: con 3 abiertos, que retire o cancele alguno.
    const { count: abiertos } = await supabase
      .from("pedidos_online")
      .select("id_pedido", { count: "exact", head: true })
      .eq("id_cliente", idCliente)
      .in("estado", ESTADOS_ABIERTOS);
    if ((abiertos ?? 0) >= 3) return mal("Ya tenés 3 pedidos en curso. Retirá alguno antes de hacer otro.");

    // La estación: hoy hay una sola (la misma que usa el catálogo para el stock).
    const { data: local } = await supabase.from("locales").select("id_local").eq("estado", "ACTIVO").order("nombre").limit(1).maybeSingle();
    if (!local) return mal("La tienda no está disponible ahora.", 503);

    const idsProducto = [...new Set(lineas.map((l) => l.id))];
    const [{ data: productos }, { data: variantes }] = await Promise.all([
      supabase.from("productos").select("id_producto, id_marca, nombre, precio_venta, precio_efectivo, descuento_porcentaje, estado").in("id_producto", idsProducto),
      supabase.from("variantes_producto").select("id_variante, id_producto, nombre, precio_venta, precio_efectivo, estado, orden").in("id_producto", idsProducto).eq("estado", "ACTIVO"),
    ]);
    const prodPorId = new Map((productos ?? []).map((p) => [p.id_producto as string, p]));

    type Armada = { linea: LineaPedida; idVariante: string; idProducto: string; idMarca: string | null; nombre: string; variante: string | null; lista: number; efectivo: number };
    const armadas: Armada[] = [];
    for (const l of lineas) {
      const p = prodPorId.get(l.id);
      if (!p || p.estado !== "ACTIVO" || !(Number(p.precio_venta) > 0)) return mal("Un producto de tu pedido ya no está a la venta. Sacalo y probá de nuevo.", 409);
      const suyas = (variantes ?? []).filter((v) => v.id_producto === l.id).sort((a, b) => (Number(a.orden ?? 9999) - Number(b.orden ?? 9999)));
      const variante = l.v ? suyas.find((v) => v.nombre === l.v) : suyas.find((v) => v.nombre === "Único") ?? (suyas.length === 1 ? suyas[0] : undefined);
      if (!variante) return mal(`Elegí el sabor de ${p.nombre}.`, 409);
      const lista = precioDe(p as never, variante as never, "OTRO");
      const efectivo = precioDe(p as never, variante as never, "EFECTIVO");
      if (!(lista > 0)) return mal("Un producto de tu pedido no tiene precio. Sacalo y probá de nuevo.", 409);
      armadas.push({
        linea: l,
        idVariante: variante.id_variante as string,
        idProducto: l.id,
        idMarca: (p.id_marca as string | null) ?? null,
        nombre: p.nombre as string,
        variante: variante.nombre !== "Único" ? (variante.nombre as string) : null,
        lista,
        efectivo,
      });
    }

    // Stock del local menos lo que ya está pedido online y todavía no salió.
    const idsVariante = armadas.map((a) => a.idVariante);
    const [{ data: stock }, reservado] = await Promise.all([
      supabase.from("stock").select("id_variante, cantidad").eq("id_local", local.id_local).in("id_variante", idsVariante),
      reservadoPorVariante(supabase, idsVariante),
    ]);
    const hay = new Map<string, number>();
    for (const s of stock ?? []) hay.set(s.id_variante as string, (hay.get(s.id_variante as string) ?? 0) + Math.max(0, Number(s.cantidad) || 0));
    const faltan: { id: string; v: string | null; quedan: number; n: string }[] = [];
    for (const a of armadas) {
      const quedan = Math.max(0, (hay.get(a.idVariante) ?? 0) - (reservado.get(a.idVariante) ?? 0));
      if (a.linea.q > quedan) faltan.push({ id: a.idProducto, v: a.linea.v, quedan, n: a.nombre });
    }
    if (faltan.length) {
      const f = faltan[0];
      return mal(
        f.quedan === 0 ? `Se nos terminó ${f.n}. Sacalo del pedido y probá de nuevo.` : `De ${f.n} nos quedan ${f.quedan}. Ajustá la cantidad y probá de nuevo.`,
        409,
        { faltan }
      );
    }

    // Combos (lib/combos.ts): si el pedido tiene los productos de un combo, baja
    // solo, con tarjeta/transferencia y en efectivo. El pedido guarda un precio por
    // renglón, así que lo del combo queda repartido en el precio de cada uno. La
    // caja, al cobrarlo, no lo vuelve a aplicar (venderPos con `sinCombos`).
    const combos = await traerCombos(supabase);
    if (combos.length > 0) {
      const precioConCombo = (modo: "LISTA" | "EFECTIVO") => {
        const r = aplicarCombos(
          armadas.map((a) => ({ clave: a.idVariante, idProducto: a.idProducto, cantidad: a.linea.q, precio: modo === "LISTA" ? a.lista : a.efectivo })),
          combos,
          modo
        );
        const descuentoDe = new Map<string, number>();
        for (const p of r.porciones) descuentoDe.set(p.clave, (descuentoDe.get(p.clave) ?? 0) + p.descuento);
        return descuentoDe;
      };
      const dLista = precioConCombo("LISTA");
      const dEfectivo = precioConCombo("EFECTIVO");
      for (const a of armadas) {
        const q = a.linea.q;
        a.lista = Math.round(((a.lista * q - (dLista.get(a.idVariante) ?? 0)) / q) * 100) / 100;
        a.efectivo = Math.round(((a.efectivo * q - (dEfectivo.get(a.idVariante) ?? 0)) / q) * 100) / 100;
      }
    }

    const totalLista = armadas.reduce((t, a) => t + a.lista * a.linea.q, 0);
    const totalEfectivo = armadas.reduce((t, a) => t + a.efectivo * a.linea.q, 0);
    const nombre = [cliente.nombre, cliente.apellido].filter(Boolean).join(" ");

    // El código es único: si justo sale uno repetido, se prueba otro.
    let fila: { id_pedido: string } | null = null;
    for (let intento = 0; intento < 5 && !fila; intento++) {
      const { data, error } = await supabase
        .from("pedidos_online")
        .insert({
          codigo: codigoRetiro(),
          id_cliente: idCliente,
          id_local: local.id_local,
          nombre,
          dni: cliente.dni,
          email,
          pago,
          total_lista: totalLista,
          total_efectivo: totalEfectivo,
          vence: venceDe(),
        })
        .select("id_pedido")
        .single();
      if (error && error.code !== "23505") return mal(/pedidos_online|schema cache/i.test(error.message) ? "La compra online todavía no está habilitada." : "No pudimos guardar el pedido. Probá de nuevo.", 503);
      fila = data as { id_pedido: string } | null;
    }
    if (!fila) return mal("No pudimos guardar el pedido. Probá de nuevo.", 503);

    const { error: errorItems } = await supabase.from("pedidos_online_items").insert(
      armadas.map((a) => ({
        id_pedido: fila!.id_pedido,
        id_variante: a.idVariante,
        id_producto: a.idProducto,
        id_marca: a.idMarca,
        nombre: a.nombre,
        variante: a.variante,
        cantidad: a.linea.q,
        precio_lista: a.lista,
        precio_efectivo: a.efectivo,
      }))
    );
    if (errorItems) {
      await supabase.from("pedidos_online").delete().eq("id_pedido", fila.id_pedido);
      return mal("No pudimos guardar el pedido. Probá de nuevo.", 503);
    }

    // Los dos mails a la par: al cliente (con el código y cómo pagar) y al Dueño.
    await Promise.all([avisarCliente(supabase, fila.id_pedido, "RECIBIDO"), avisarPedidoNuevoAlDueno(supabase, fila.id_pedido)]);

    const { data: creado } = await supabase.from("pedidos_online").select(COLUMNAS_PEDIDO).eq("id_pedido", fila.id_pedido).single();
    return NextResponse.json({ pedido: await vistaCliente(supabase, creado as FilaPedidoOnline) }, { headers: sinCache });
  } catch (e) {
    console.error("[tienda/pedido]", e);
    return mal("Algo falló. Probá de nuevo en un momento.", 500);
  }
}
