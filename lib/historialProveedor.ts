import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularLiquidacionProveedor } from "@/lib/liquidacionesProveedor";
import { costoDelDiaPorGramo } from "@/lib/granel";
import { CLAVE_PRIMER_PEDIDO } from "@/lib/primerPedidoProveedor";
import { fechaHoraArgentina } from "@/lib/horarios";

// Historial de pedidos y cuenta corriente de un proveedor que se paga por lo
// vendido, como Alifrut (Gonzalo, 19/11, maqueta aprobada).
//
// De cada pedido: lo que llegó (lotes de su recepción, a su costo), lo ya
// liquidado (detalle_liquidacion_proveedor, lote por lote), lo vendido que
// todavía no se liquidó (el mismo cálculo FIFO de la liquidación) y lo que sigue
// sin vender. Lo pagado se reparte entre los pedidos en orden, primero el más
// viejo, porque así se consumen los lotes.
//
// La cuenta corriente es la de Proveedores (movimientos_cuenta_proveedor): cada
// liquidación suma, cada pago resta. Arriba se le agrega lo vendido sin liquidar,
// que también se le debe aunque todavía no esté en una liquidación.

export type EstadoPedido = "ARMADO" | "PEDIDO" | "RECIBIDO";

export type PedidoHistorial = {
  idOrden: string;
  numero: number;
  fecha: string;
  estado: EstadoPedido;
  unidades: number;
  /** Lo que llegó (o, si no llegó, lo pedido al costo de hoy), sin IVA. */
  total: number;
  estimado: boolean;
  liquidado: number;
  vendidoSinLiquidar: number;
  pagado: number;
  debe: number;
  sinVender: number;
  nota: string | null;
};

export type MovimientoCuenta = {
  fecha: string;
  tipo: "LIQUIDACION" | "PAGO" | "SIN_LIQUIDAR" | "OTRO";
  detalle: string;
  pedidos: number[];
  debe: number;
  haber: number;
  saldo: number;
  medio: string | null;
};

export type HistorialProveedor = {
  proveedor: { id: string; nombre: string };
  ivaPorcentaje: number;
  pedidos: PedidoHistorial[];
  movimientos: MovimientoCuenta[];
  totales: { debeHoy: number; sinVender: number; pagado: number; totalPedido: number; sinLiquidar: number };
};

const r2 = (n: number) => Math.round(n * 100) / 100;

async function todos<T>(consulta: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const salida: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await consulta(i, i + 999);
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    salida.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return salida;
}

export async function historialProveedor(supabase: SupabaseClient, idProveedor: string): Promise<HistorialProveedor> {
  const [{ data: prov }, { data: ordenesData }, { data: recepciones }, { data: cfg }, { data: ivaCfg }] = await Promise.all([
    supabase.from("proveedores").select("id_proveedor, nombre").eq("id_proveedor", idProveedor).single(),
    supabase.from("ordenes_compra_proveedor").select("id_orden, estado, total_unidades, observaciones, fecha_alta, enviada_el").eq("id_proveedor", idProveedor).order("fecha_alta", { ascending: true }),
    supabase.from("recepciones_proveedor").select("id_recepcion, id_orden, fecha").eq("id_proveedor", idProveedor),
    supabase.from("configuracion").select("valor").eq("parametro", CLAVE_PRIMER_PEDIDO).maybeSingle(),
    supabase.from("configuracion").select("valor").eq("parametro", "IVA_GENERAL_PORCENTAJE").maybeSingle(),
  ]);
  const ordenes = (ordenesData ?? []).filter((o) => o.estado !== "CANCELADA");
  const ivaPorcentaje = Number(ivaCfg?.valor ?? 21) || 21;

  // Lotes de cada recepción → su pedido.
  const ordenDeRecepcion = new Map((recepciones ?? []).map((r) => [r.id_recepcion as string, r.id_orden as string]));
  const idsRecepcion = [...ordenDeRecepcion.keys()];
  type Lote = { id_detalle: string; id_recepcion: string; cantidad_recibida: number | null; costo_unitario: number | null; cantidad_disponible_fifo: number | null };
  const lotes: Lote[] = [];
  for (let i = 0; i < idsRecepcion.length; i += 50) {
    const tanda = idsRecepcion.slice(i, i + 50);
    lotes.push(
      ...(await todos<Lote>((a, b) =>
        supabase.from("detalle_recepcion_proveedor").select("id_detalle, id_recepcion, cantidad_recibida, costo_unitario, cantidad_disponible_fifo").in("id_recepcion", tanda).range(a, b)
      ))
    );
  }
  const ordenDeLote = new Map(lotes.map((l) => [l.id_detalle, ordenDeRecepcion.get(l.id_recepcion) ?? null]));

  // Lo que no tiene producto todavía (las chocobolitas del primer pedido) va entero, sin vender.
  let extras: { idOrden: string; neto: number } | null = null;
  try {
    const p = cfg?.valor ? (JSON.parse(cfg.valor as string) as { idOrden?: string; extras?: { neto: number }[] }) : null;
    if (p?.idOrden) extras = { idOrden: p.idOrden, neto: (p.extras ?? []).reduce((a, e) => a + Number(e.neto || 0), 0) };
  } catch {
    // config mal escrita: sin extras
  }

  const porOrden = new Map<string, { total: number; liquidado: number; sinLiquidar: number }>();
  const de = (id: string) => {
    let x = porOrden.get(id);
    if (!x) porOrden.set(id, (x = { total: 0, liquidado: 0, sinLiquidar: 0 }));
    return x;
  };
  for (const l of lotes) {
    const id = ordenDeLote.get(l.id_detalle);
    if (id) de(id).total += Number(l.cantidad_recibida ?? 0) * Number(l.costo_unitario ?? 0);
  }
  if (extras && extras.neto > 0) de(extras.idOrden).total += extras.neto;

  // Lo liquidado, lote por lote.
  const { data: liquidaciones } = await supabase
    .from("liquidaciones_proveedor")
    .select("id_liquidacion, fecha_desde, fecha_hasta, monto_final, fecha_generacion, estado")
    .eq("id_proveedor", idProveedor)
    .order("fecha_generacion", { ascending: true });
  const idsLiq = (liquidaciones ?? []).map((l) => l.id_liquidacion as string);
  type DetLiq = { id_liquidacion: string; id_detalle_recepcion: string | null; subtotal: number | null };
  const detLiq: DetLiq[] = [];
  for (let i = 0; i < idsLiq.length; i += 50) {
    const tanda = idsLiq.slice(i, i + 50);
    detLiq.push(...(await todos<DetLiq>((a, b) => supabase.from("detalle_liquidacion_proveedor").select("id_liquidacion, id_detalle_recepcion, subtotal").in("id_liquidacion", tanda).range(a, b))));
  }
  const pedidosDeLiq = new Map<string, Set<string>>();
  for (const d of detLiq) {
    const id = d.id_detalle_recepcion ? ordenDeLote.get(d.id_detalle_recepcion) : null;
    if (!id) continue;
    de(id).liquidado += Number(d.subtotal ?? 0);
    const s = pedidosDeLiq.get(d.id_liquidacion) ?? new Set<string>();
    s.add(id);
    pedidosDeLiq.set(d.id_liquidacion, s);
  }

  // Lo vendido que todavía no se liquidó: el mismo FIFO de la liquidación.
  const manana = fechaHoraArgentina(new Date(Date.now() + 86400000)).fecha;
  const pendiente = await calcularLiquidacionProveedor(supabase, idProveedor, "2020-01-01", manana).catch(() => ({ lineas: [], total: 0 }));
  let sinLiquidarSinPedido = 0;
  for (const linea of pendiente.lineas) {
    for (const c of linea.lotes) {
      const id = ordenDeLote.get(c.idDetalleRecepcion);
      const monto = c.cantidad * c.costoUnitario;
      if (id) de(id).sinLiquidar += monto;
      else sinLiquidarSinPedido += monto;
    }
  }
  const totalSinLiquidar = r2(pendiente.total);

  // Lo pagado, repartido entre los pedidos en orden (primero lo liquidado de los más viejos).
  const movs = await todos<Record<string, unknown>>((a, b) =>
    supabase.from("movimientos_cuenta_proveedor").select("*").eq("id_proveedor", idProveedor).order("fecha", { ascending: true }).range(a, b)
  );
  const totalPagado = movs.filter((m) => m.tipo_movimiento === "PAGO").reduce((a, m) => a + Math.abs(Number(m.importe ?? 0)), 0);
  const numeroDe = new Map(ordenes.map((o, i) => [o.id_orden as string, i + 1]));
  let resto = totalPagado;
  const pagadoDe = new Map<string, number>();
  for (const o of ordenes) {
    const x = porOrden.get(o.id_orden as string);
    if (!x) continue;
    const va = Math.min(resto, x.liquidado);
    pagadoDe.set(o.id_orden as string, va);
    resto -= va;
  }

  // Lo pedido que todavía no llegó: al costo de hoy (estimado).
  const sinRecibir = ordenes.filter((o) => !porOrden.has(o.id_orden as string) && o.estado !== "RECIBIDA");
  const estimadoDe = new Map<string, number>();
  if (sinRecibir.length) {
    const { data: det } = await supabase.from("detalle_orden_compra").select("id_orden, id_variante, cantidad_solicitada").in("id_orden", sinRecibir.map((o) => o.id_orden as string));
    const ids = [...new Set((det ?? []).map((d) => d.id_variante as string))];
    const porGramo = await costoDelDiaPorGramo(supabase, ids).catch(() => new Map<string, number>());
    const { data: vars } = ids.length ? await supabase.from("variantes_producto").select("id_variante, productos(costo_informado)").in("id_variante", ids) : { data: [] };
    const costoDe = new Map(
      (vars ?? []).map((v) => [v.id_variante as string, porGramo.get(v.id_variante as string) ?? Number((v.productos as unknown as { costo_informado: number | null } | null)?.costo_informado ?? 0)])
    );
    for (const d of det ?? []) estimadoDe.set(d.id_orden as string, (estimadoDe.get(d.id_orden as string) ?? 0) + Number(d.cantidad_solicitada ?? 0) * (costoDe.get(d.id_variante as string) ?? 0));
  }

  const pedidos: PedidoHistorial[] = ordenes
    .map((o) => {
      const id = o.id_orden as string;
      const x = porOrden.get(id);
      const recibido = Boolean(x) || o.estado === "RECIBIDA";
      const total = r2(x ? x.total : estimadoDe.get(id) ?? 0);
      const liquidado = r2(x?.liquidado ?? 0);
      const sinLiq = r2(x?.sinLiquidar ?? 0);
      const pagado = r2(pagadoDe.get(id) ?? 0);
      return {
        idOrden: id,
        numero: numeroDe.get(id) ?? 0,
        fecha: o.fecha_alta as string,
        estado: (recibido ? "RECIBIDO" : o.enviada_el ? "PEDIDO" : "ARMADO") as EstadoPedido,
        unidades: Number(o.total_unidades ?? 0),
        total,
        estimado: !x,
        liquidado,
        vendidoSinLiquidar: sinLiq,
        pagado,
        debe: r2(Math.max(0, liquidado - pagado) + sinLiq),
        sinVender: recibido ? r2(Math.max(0, total - liquidado - sinLiq)) : 0,
        nota: (o.observaciones as string | null) ?? null,
      };
    })
    .reverse();

  // La cuenta corriente: liquidaciones y pagos, con el saldo que va quedando.
  let saldo = 0;
  const movimientos: MovimientoCuenta[] = [];
  // Tramos de lo liquidado de cada pedido, uno detrás del otro (el más viejo primero):
  // un pago cubre los pedidos cuyo tramo cae entre lo pagado antes y lo pagado después.
  const tramos: { numero: number; desde: number; hasta: number }[] = [];
  let acumulado = 0;
  for (const o of ordenes) {
    const x = porOrden.get(o.id_orden as string);
    if (!x || x.liquidado <= 0) continue;
    tramos.push({ numero: numeroDe.get(o.id_orden as string) ?? 0, desde: acumulado, hasta: acumulado + x.liquidado });
    acumulado += x.liquidado;
  }
  let pagadoAntes = 0;
  const liqPorFecha = [...(liquidaciones ?? [])];
  for (const m of movs) {
    const importe = Number(m.importe ?? 0);
    saldo = r2(saldo + importe);
    const tipo = m.tipo_movimiento === "LIQUIDACION" ? "LIQUIDACION" : m.tipo_movimiento === "PAGO" ? "PAGO" : "OTRO";
    let pedidosMov: number[] = [];
    if (tipo === "LIQUIDACION") {
      // La liquidación de ese movimiento: la de igual monto más cercana en el tiempo.
      const i = liqPorFecha.findIndex((l) => Math.abs(Number(l.monto_final ?? 0) - importe) < 1);
      const liq = i >= 0 ? liqPorFecha.splice(i, 1)[0] : null;
      pedidosMov = liq ? [...(pedidosDeLiq.get(liq.id_liquidacion as string) ?? [])].map((id) => numeroDe.get(id) ?? 0).filter(Boolean).sort((a, b) => a - b) : [];
    } else if (tipo === "PAGO") {
      // A qué pedidos va este pago, en orden.
      const despues = pagadoAntes + Math.abs(importe);
      pedidosMov = tramos.filter((t) => t.hasta > pagadoAntes + 0.5 && t.desde < despues - 0.5).map((t) => t.numero);
      pagadoAntes = despues;
    }
    movimientos.push({
      fecha: m.fecha as string,
      tipo,
      detalle: (m.observaciones as string | null) ?? (tipo === "PAGO" ? "Pago" : "Movimiento"),
      pedidos: pedidosMov,
      debe: importe > 0 ? r2(importe) : 0,
      haber: importe < 0 ? r2(-importe) : 0,
      saldo,
      medio: (m.medio_pago as string | null) ?? null,
    });
  }
  if (totalSinLiquidar > 0) {
    saldo = r2(saldo + totalSinLiquidar);
    movimientos.push({
      fecha: new Date().toISOString(),
      tipo: "SIN_LIQUIDAR",
      detalle: `Vendido, todavía sin liquidar${sinLiquidarSinPedido > 0.5 ? " (una parte sin pedido registrado: costo estimado)" : ""}`,
      pedidos: pedidos.filter((p) => p.vendidoSinLiquidar > 0).map((p) => p.numero).sort((a, b) => a - b),
      debe: totalSinLiquidar,
      haber: 0,
      saldo,
      medio: null,
    });
  }

  const recibidos = pedidos.filter((p) => p.estado === "RECIBIDO");
  return {
    proveedor: { id: idProveedor, nombre: (prov?.nombre as string) ?? "Proveedor" },
    ivaPorcentaje,
    pedidos,
    movimientos: movimientos.reverse(),
    totales: {
      debeHoy: saldo,
      sinVender: r2(recibidos.reduce((a, p) => a + p.sinVender, 0)),
      pagado: r2(totalPagado),
      totalPedido: r2(recibidos.reduce((a, p) => a + p.total, 0)),
      sinLiquidar: totalSinLiquidar,
    },
  };
}
