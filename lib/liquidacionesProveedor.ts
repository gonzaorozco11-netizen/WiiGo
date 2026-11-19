// Liquidación por venta (modo LIQUIDACION_VENTA en proveedores, caso
// Alifrut): se le paga el costo de lo vendido en el período, nunca de lo
// entregado — mucho más simple que lib/cuentaComercialMarca.ts o el módulo
// Liquidaciones de marcas: sin royalty, sin comisión de Mercado Pago
// trasladada, sin SIRCREB. WiiGo se queda con todo el margen entre el
// precio de venta y este costo.
//
// El costo de cada unidad vendida se calcula por FIFO (ver
// lib/fifoProveedor.ts): se descuenta del lote/remito más viejo que todavía
// tenga saldo, así se paga exactamente lo que costó cada unidad real, no un
// promedio ni el último costo cargado.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  simularConsumoFifo,
  aplicarConsumoLotes,
  lotesDeVariante,
  consumirEnMemoria,
  type ConsumoLote,
} from "./fifoProveedor";
import { devueltoPorDetalle, netearRenglon } from "./devueltoPorDetalle";
import { leerConfigPrecios } from "./configPrecios";
import { costosSobreTotal, type Medio } from "./calculoPrecio";
import { cobroDeVentas } from "./cobroDeVentas";
import { cobradaAl, type Cobro } from "./fechaCobro";

// ===================== SOLO LO COBRADO (19/11) =====================
//
// A Alifrut se le paga por lo vendido, pero solo lo que ya le entró a WiiGo al
// corte (Gonzalo, 19/11: «que ese vendido ya lo tenga conmigo»). Lo vendido con
// la plata en camino (crédito, QR sin liberar) pasa al mes siguiente. No hay
// «desde» para las ventas: una de octubre que entró en noviembre va en noviembre.
// La merma no depende de ningún cobro: va hasta el corte.

type RenglonProveedor = {
  id_detalle: string;
  id_venta: string;
  id_variante: string;
  cantidad: number;
  costo_unitario: number | null;
  precio_unitario: number | null;
  subtotal: number | null;
};
type VentaProveedor = { id_venta: string; fecha: string; medio_pago: string | null; id_pago: string | null };

const finDelDia = (dia: string) => `${dia}T23:59:59.999-03:00`;
/** La merma sin liquidar va entera hasta el corte, sin «desde». */
const DESDE_SIEMPRE = "2000-01-01";

/** Los renglones sin liquidar de esas variantes, vendidos hasta el corte, separados por si la plata ya entró. */
async function renglonesHastaElCorte(
  supabase: SupabaseClient,
  varianteIds: string[],
  corte: string
): Promise<{ cobrados: RenglonProveedor[]; enCamino: RenglonProveedor[]; ventaPorId: Map<string, VentaProveedor>; cobro: Map<string, Cobro> }> {
  const renglones: RenglonProveedor[] = [];
  for (let i = 0; i < varianteIds.length; i += 150) {
    const { data } = await supabase
      .from("detalle_ventas")
      .select("id_detalle, id_venta, id_variante, cantidad, costo_unitario, precio_unitario, subtotal")
      .in("id_variante", varianteIds.slice(i, i + 150))
      .is("id_liquidacion_proveedor", null)
      .range(0, 49999);
    renglones.push(...((data ?? []) as RenglonProveedor[]));
  }
  const idsVenta = [...new Set(renglones.map((r) => r.id_venta))];
  const ventaPorId = new Map<string, VentaProveedor>();
  for (let i = 0; i < idsVenta.length; i += 200) {
    const { data } = await supabase
      .from("ventas")
      .select("id_venta, fecha, medio_pago, id_pago")
      .in("id_venta", idsVenta.slice(i, i + 200))
      .eq("estado", "PAGADA")
      .lte("fecha", finDelDia(corte));
    for (const v of data ?? []) ventaPorId.set(v.id_venta as string, v as VentaProveedor);
  }
  const cobro = await cobroDeVentas(supabase, [...ventaPorId.values()]);
  const cobrados: RenglonProveedor[] = [];
  const enCamino: RenglonProveedor[] = [];
  for (const r of renglones) {
    if (!ventaPorId.has(r.id_venta)) continue; // anulada o vendida después del corte
    const c = cobro.get(r.id_venta);
    (c && cobradaAl(c, corte) ? cobrados : enCamino).push(r);
  }
  return { cobrados, enCamino, ventaPorId, cobro };
}

/** Lo vendido de este proveedor con la plata en camino al corte: va en la próxima liquidación. */
export async function enCaminoProveedor(
  supabase: SupabaseClient,
  idProveedor: string,
  corte: string
): Promise<{ monto: number; unidades: number; ventas: number }> {
  const { data: productos } = await supabase.from("productos").select("id_producto, costo_informado").eq("id_proveedor_liquidacion", idProveedor);
  const costoProducto = new Map((productos ?? []).map((p) => [p.id_producto as string, Number(p.costo_informado ?? 0)]));
  if (!costoProducto.size) return { monto: 0, unidades: 0, ventas: 0 };
  const { data: variantes } = await supabase.from("variantes_producto").select("id_variante, id_producto").in("id_producto", [...costoProducto.keys()]);
  const productoDe = new Map((variantes ?? []).map((v) => [v.id_variante as string, v.id_producto as string]));
  const { enCamino } = await renglonesHastaElCorte(supabase, [...productoDe.keys()], corte);
  const devueltos = await devueltoPorDetalle(supabase, enCamino.map((d) => d.id_detalle));
  let monto = 0;
  let unidades = 0;
  for (const r of enCamino) {
    const cantidad = netearRenglon(r.cantidad, 0, devueltos.get(r.id_detalle)).cantidad;
    if (cantidad <= 0) continue;
    const costo = r.costo_unitario != null ? Number(r.costo_unitario) : costoProducto.get(productoDe.get(r.id_variante) ?? "") ?? 0;
    monto += costo * cantidad;
    unidades += cantidad;
  }
  return { monto: Math.round(monto), unidades, ventas: new Set(enCamino.map((r) => r.id_venta)).size };
}

// ===================== DETALLE PARA PANTALLA =====================
//
// Lo de abajo (calcularLiquidacionProveedor) da el número que hay que pagar.
// Esto da el detalle para mirarlo: abierto por medio de pago, por producto y
// por lote, con el IVA y el margen.
//
// Por qué en orden cronológico y no sumando cantidades por producto: si el
// mes tuvo dos recepciones a costos distintos, el lote que le tocó a cada
// venta depende de cuándo se hizo. Sumar primero y aplicar FIFO al total
// daría el mismo costo total, pero no permitiría decir qué venta salió de
// qué lote — que es justo lo que hay que mostrar.

// MERMA no es un medio de pago — es mercadería que se perdió y que igual hay
// que pagarle al proveedor. Viaja como un "medio" más porque recorre
// exactamente el mismo camino que una venta (consume lotes FIFO, suma costo,
// lleva IVA); lo único que cambia es que del otro lado no hay plata que entró.
// Meterla en un grupo propio es lo que permite verla separada en pantalla en
// vez de disfrazada de menor margen.
export type MedioLiquidacion = "ELECTRONICO" | "EFECTIVO" | "MERMA";

export type LoteDeLinea = {
  idDetalleRecepcion: string;
  fechaRecepcion: string;
  cantidad: number;
  costoUnitario: number;
};

export type LineaDetalle = {
  idVariante: string;
  nombreProducto: string;
  ivaPorcentaje: number;
  precioVenta: number;
  cantidad: number;
  costoNeto: number;
  iva: number;
  /**
   * La venta como la cuenta Precios: sin IVA solo si para esa forma de pago
   * está tildado "IVA" en Precios → Configuración (Gonzalo, 2026-11-02: "que
   * me quede igual a Precios").
   */
  ventaNeta: number;
  ventaTotal: number;
  /** Bolsita y etiqueta, más IIBB, comisión e impuesto al cheque si están tildados. */
  gastos: number;
  margen: number;
  lotes: LoteDeLinea[];
  /** Solo en las líneas de merma: por qué se perdió. "3 rotura · 1 vencimiento". */
  motivos?: string;
};

export type TotalesDetalle = {
  cantidad: number;
  costoNeto: number;
  iva: number;
  total: number;
  ventaNeta: number;
  ventaTotal: number;
  gastos: number;
  margen: number;
};

export type DetalleLiquidacion = {
  porMedio: { medio: MedioLiquidacion; lineas: LineaDetalle[]; totales: TotalesDetalle }[];
  totales: TotalesDetalle;
  estimado: boolean;
};

function totalesVacios(): TotalesDetalle {
  return { cantidad: 0, costoNeto: 0, iva: 0, total: 0, ventaNeta: 0, ventaTotal: 0, gastos: 0, margen: 0 };
}

// La forma de pago de Mercado Pago → el medio de Precios, para usar lo que
// Gonzalo tildó en cada uno (Precios → Configuración).
const MEDIO_PRECIOS: Record<string, Medio> = {
  EFECTIVO: "efectivo",
  DINERO_CUENTA: "qr",
  DEBITO: "debito",
  PREPAGA: "debito",
  CREDITO: "credito",
  CUOTAS_SIN_INTERES: "credito",
  // Transferencia al QR desde MODO o un banco: entra a la cuenta como el QR.
  TRANSFERENCIA: "qr",
  POSNET_DEBITO: "debito",
  POSNET_CREDITO: "credito",
};

function redondear2(v: number) {
  return Math.round(v * 100) / 100;
}

function acumular(t: TotalesDetalle, l: LineaDetalle) {
  t.cantidad += l.cantidad;
  t.costoNeto = redondear2(t.costoNeto + l.costoNeto);
  t.iva = redondear2(t.iva + l.iva);
  t.total = redondear2(t.costoNeto + t.iva);
  t.ventaNeta = redondear2(t.ventaNeta + l.ventaNeta);
  t.ventaTotal = redondear2(t.ventaTotal + l.ventaTotal);
  t.gastos = redondear2(t.gastos + l.gastos);
  t.margen = redondear2(t.margen + l.margen);
}

/**
 * Lo del granel (lib/granel.ts) se cuenta en gramos: en la liquidación es la
 * merma de fraccionado, y el renglón tiene que decir que el número son gramos.
 */
function conUnidadDeGranel(nombre: string) {
  return /·\s*a granel$/i.test(nombre) ? `${nombre} — merma de fraccionado, en gramos` : nombre;
}

/** Una merma pendiente de pagarle al proveedor. */
export type MermaPendiente = {
  idMerma: string;
  idVariante: string;
  cantidad: number;
  motivo: string;
  fecha: string;
  /** El costo del día en que se perdió, si quedó guardado. */
  costoUnitario: number | null;
};

/**
 * La merma sin liquidar de las variantes de un proveedor, dentro del período.
 *
 * Se filtra por fecha igual que las ventas: una merma de marzo no tiene por
 * qué aparecer en la liquidación de abril sin que nadie lo haya decidido.
 */
export async function mermasSinLiquidar(
  supabase: SupabaseClient,
  varianteIds: string[],
  fechaDesde: string,
  fechaHasta: string
): Promise<MermaPendiente[]> {
  if (varianteIds.length === 0) return [];
  const { data } = await supabase
    .from("mermas")
    .select("id_merma, id_variante, cantidad, motivo, fecha, costo_unitario")
    .in("id_variante", varianteIds)
    .is("id_liquidacion_proveedor", null)
    .gte("fecha", `${fechaDesde}T00:00:00`)
    .lte("fecha", `${fechaHasta}T23:59:59`)
    .order("fecha", { ascending: true });

  return (data ?? []).map((m) => ({
    idMerma: m.id_merma as string,
    idVariante: m.id_variante as string,
    cantidad: (m.cantidad as number) ?? 0,
    motivo: (m.motivo as string) ?? "OTRO",
    fecha: m.fecha as string,
    costoUnitario: m.costo_unitario == null ? null : Number(m.costo_unitario),
  }));
}

/** "3 rotura · 1 vencimiento", para mostrar al lado de la línea. */
function resumirMotivos(mermas: MermaPendiente[]) {
  const porMotivo = new Map<string, number>();
  for (const m of mermas) porMotivo.set(m.motivo, (porMotivo.get(m.motivo) ?? 0) + m.cantidad);
  return [...porMotivo.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([motivo, cantidad]) => `${cantidad} ${motivo.toLowerCase()}`)
    .join(" · ");
}

export type LineaLiquidacionProveedor = {
  idVariante: string;
  nombreProducto: string;
  cantidadVendida: number;
  costoUnitario: number; // promedio ponderado entre los lotes consumidos, para mostrar un solo número
  subtotal: number;
  lotes: ConsumoLote[]; // detalle por remito, para trazabilidad
  estimado: boolean; // true si algún tramo no tenía lote/costo registrado y se estimó
};

// Se marca por LÍNEA de venta (detalle_ventas.id_liquidacion_proveedor), no
// en toda la venta — un mismo carrito puede mezclar productos de este
// proveedor con otros de otro proveedor o de una marca, y no queremos que
// liquidar a uno tape la posibilidad de liquidar al otro.
export async function calcularLiquidacionProveedor(
  supabase: SupabaseClient,
  idProveedor: string,
  fechaDesde: string,
  fechaHasta: string,
  opciones: { incluirEnCamino?: boolean } = {}
): Promise<{ lineas: LineaLiquidacionProveedor[]; total: number; idsDetalle: string[]; idsMerma: string[] }> {
  void fechaDesde; // desde el 19/11 las ventas no tienen «desde»: todo lo cobrado al corte (ver arriba)
  const vacio = { lineas: [] as LineaLiquidacionProveedor[], total: 0, idsDetalle: [] as string[], idsMerma: [] as string[] };
  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre, costo_informado")
    .eq("id_proveedor_liquidacion", idProveedor);
  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto as string, p]));
  const productoIds = [...productoPorId.keys()];
  if (productoIds.length === 0) return vacio;

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_producto", productoIds);
  const varianteIds = (variantes ?? []).map((v) => v.id_variante as string);
  if (varianteIds.length === 0) return vacio;

  // La merma se paga igual que lo vendido, así que entra al mismo cálculo.
  // Se lee antes del corte por "no hay ventas": un mes sin una sola venta
  // pero con mercadería rota le debe plata a Alifrut lo mismo.
  const mermas = await mermasSinLiquidar(supabase, varianteIds, DESDE_SIEMPRE, fechaHasta);

  // Solo lo vendido cuya plata ya entró al corte (19/11). El historial pide todo
  // lo vendido (también lo en camino): para él salió del lote igual.
  const hastaCorte = await renglonesHastaElCorte(supabase, varianteIds, fechaHasta);
  const detalle = opciones.incluirEnCamino ? [...hastaCorte.cobrados, ...hastaCorte.enCamino] : hastaCorte.cobrados;

  if (detalle.length === 0 && mermas.length === 0) return vacio;

  // Lo que el cliente devolvió no se le paga: esa unidad volvió al stock y se
  // va a pagar cuando se venda de nuevo. Sin esto se pagaba dos veces.
  const devueltos = await devueltoPorDetalle(supabase, (detalle ?? []).map((d) => d.id_detalle as string));

  const nombrePorVariante = new Map<string, string>();
  const costoReservaPorVariante = new Map<string, number>();
  for (const v of variantes ?? []) {
    const producto = productoPorId.get(v.id_producto as string);
    const nombreBase = conUnidadDeGranel(producto?.nombre ?? "Producto");
    nombrePorVariante.set(v.id_variante as string, v.nombre !== "Único" ? `${nombreBase} — ${v.nombre}` : nombreBase);
    costoReservaPorVariante.set(v.id_variante as string, (producto?.costo_informado as number | null) ?? 0);
  }

  const cantidadPorVariante = new Map<string, number>();
  // A Alifrut se le paga el costo del DÍA DE LA VENTA (Gonzalo, 19/11): el que
  // quedó guardado en cada renglón (lib/costoAlVender.ts). Si la lista sube o
  // baja, lo que se vende desde ese día va con el costo nuevo; lo ya vendido
  // no cambia. Los lotes se siguen gastando por FIFO, pero solo para saber de
  // qué pedido salió cada cosa y cuánto queda sin vender: no ponen la plata.
  // Lo viejo sin costo guardado usa el de hoy.
  const montoPorVariante = new Map<string, number>();
  for (const d of detalle ?? []) {
    const cantidad = netearRenglon(d.cantidad, 0, devueltos.get(d.id_detalle as string)).cantidad;
    if (cantidad <= 0) continue;
    cantidadPorVariante.set(d.id_variante, (cantidadPorVariante.get(d.id_variante) ?? 0) + cantidad);
    const costo = d.costo_unitario != null ? Number(d.costo_unitario) : costoReservaPorVariante.get(d.id_variante) ?? 0;
    montoPorVariante.set(d.id_variante, (montoPorVariante.get(d.id_variante) ?? 0) + costo * cantidad);
  }
  // La merma también: al costo que tenía el día que se perdió (si quedó guardado), si no el de hoy.
  for (const m of mermas) {
    cantidadPorVariante.set(m.idVariante, (cantidadPorVariante.get(m.idVariante) ?? 0) + m.cantidad);
    const costo = m.costoUnitario != null ? m.costoUnitario : costoReservaPorVariante.get(m.idVariante) ?? 0;
    montoPorVariante.set(m.idVariante, (montoPorVariante.get(m.idVariante) ?? 0) + costo * m.cantidad);
  }

  const lineas: LineaLiquidacionProveedor[] = [];
  let total = 0;
  for (const [idVariante, cantidad] of cantidadPorVariante) {
    if (cantidad <= 0) continue;
    const monto = montoPorVariante.get(idVariante) ?? 0;
    const unitario = monto / cantidad;
    const resultado = await simularConsumoFifo(supabase, idProveedor, idVariante, cantidad, unitario);
    const subtotal = Math.round(monto);
    lineas.push({
      idVariante,
      nombreProducto: nombrePorVariante.get(idVariante) ?? "Producto",
      cantidadVendida: cantidad,
      costoUnitario: Math.round(unitario),
      subtotal,
      // Cada lote dice de qué pedido salió; la plata es la del costo al vender.
      lotes: resultado.consumos.map((c) => ({ ...c, costoUnitario: unitario })),
      estimado: false,
    });
    total += subtotal;
  }

  return { lineas, total, idsDetalle: detalle.map((d) => d.id_detalle), idsMerma: mermas.map((m) => m.idMerma) };
}

/**
 * El detalle de la liquidación, para la pantalla.
 *
 * Recorre las ventas del período en orden y va consumiendo los lotes en
 * memoria, así cada línea de venta se lleva el costo del lote que realmente
 * le tocó. No escribe nada: los saldos reales de los lotes se descuentan
 * recién al confirmar (ver generarLiquidacionProveedor).
 */
export async function detalleLiquidacionProveedor(
  supabase: SupabaseClient,
  idProveedor: string,
  fechaDesde: string,
  fechaHasta: string
): Promise<DetalleLiquidacion> {
  const vacio: DetalleLiquidacion = {
    porMedio: [
      { medio: "ELECTRONICO", lineas: [], totales: totalesVacios() },
      { medio: "EFECTIVO", lineas: [], totales: totalesVacios() },
      { medio: "MERMA", lineas: [], totales: totalesVacios() },
    ],
    totales: totalesVacios(),
    estimado: false,
  };

  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre, costo_informado, iva_porcentaje, id_envase, costos_extra")
    .eq("id_proveedor_liquidacion", idProveedor);
  if (!productos || productos.length === 0) return vacio;
  const productoPorId = new Map(productos.map((p) => [p.id_producto as string, p]));

  // El margen se calcula igual que en Precios: la misma configuración (qué se
  // descuenta en cada forma de pago) y los mismos costos de la bolsita.
  const [cfg, { data: envasesData }] = await Promise.all([
    leerConfigPrecios(supabase),
    supabase.from("envases").select("id_envase, costo"),
  ]);
  const costoEnvase = new Map((envasesData ?? []).map((e) => [e.id_envase as string, Number(e.costo ?? 0)]));
  // Bolsita y etiqueta por unidad, como en costoDe (lib/calculoPrecio.ts).
  const bolsitaDe = (p: Record<string, unknown>) =>
    p.id_envase ? (costoEnvase.get(p.id_envase as string) ?? 0) + cfg.etiqueta : Number(p.costos_extra ?? 0);

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_producto", [...productoPorId.keys()]);
  if (!variantes || variantes.length === 0) return vacio;
  const variantePorId = new Map(variantes.map((v) => [v.id_variante as string, v]));

  // Solo lo vendido cuya plata ya entró al corte (19/11), sin «desde».
  void fechaDesde;
  const corte = await renglonesHastaElCorte(supabase, [...variantePorId.keys()], fechaHasta);
  const ventaPorId = corte.ventaPorId;
  const ventas = [...ventaPorId.values()];

  // Cómo pagó cada venta electrónica (QR, débito, crédito): en Precios cada
  // una descuenta cosas distintas.
  const idsPago = [...new Set((ventas ?? []).map((v) => v.id_pago as string | null).filter((x): x is string => Boolean(x)))];
  const formaPorPago = new Map<string, string>();
  for (let i = 0; i < idsPago.length; i += 200) {
    const { data: pagos } = await supabase.from("pagos").select("id_pago, forma_pago_cliente").in("id_pago", idsPago.slice(i, i + 200));
    for (const pg of pagos ?? []) formaPorPago.set(pg.id_pago as string, (pg.forma_pago_cliente as string) ?? "");
  }
  const medioPrecios = (v: Record<string, unknown> | undefined): Medio => {
    if (!v || v.medio_pago === "EFECTIVO") return "efectivo";
    return MEDIO_PRECIOS[formaPorPago.get(v.id_pago as string) ?? ""] ?? cfg.escenario;
  };

  const mermas = await mermasSinLiquidar(supabase, [...variantePorId.keys()], DESDE_SIEMPRE, fechaHasta);

  const detalle = corte.cobrados as unknown as Record<string, unknown>[];

  if (detalle.length === 0 && mermas.length === 0) return vacio;

  // Ventas y mermas en una sola línea de tiempo.
  //
  // Van mezcladas y ordenadas por fecha porque el FIFO depende del orden: si
  // el día 3 se rompió una bolsa del lote viejo y el día 10 se vendió otra,
  // la rota salió del lote viejo y la vendida del nuevo. Procesando primero
  // todas las ventas y después todas las mermas, los costos se cruzarían.
  type Evento = {
    fecha: string;
    idVariante: string;
    cantidad: number;
    medio: MedioLiquidacion;
    /** Lo que entró por esa venta. En una merma es 0: no entró nada. */
    subtotalVenta: number;
    /** El medio de Precios (efectivo, qr, débito, crédito). En merma no se usa. */
    medioPrecios: Medio;
    /** El costo que tenía al venderse (null si es viejo o es merma): se usa si no aparece el lote. */
    costoAlVender: number | null;
  };

  const eventos: Evento[] = [
    ...(detalle ?? []).map((d) => {
      const venta = ventaPorId.get(d.id_venta as string);
      const cantidad = (d.cantidad as number) ?? 0;
      return {
        fecha: (venta?.fecha as string) ?? "",
        idVariante: d.id_variante as string,
        cantidad,
        medio: (venta?.medio_pago === "EFECTIVO" ? "EFECTIVO" : "ELECTRONICO") as MedioLiquidacion,
        subtotalVenta: (d.subtotal as number | null) ?? ((d.precio_unitario as number) ?? 0) * cantidad,
        medioPrecios: medioPrecios(venta as Record<string, unknown> | undefined),
        costoAlVender: d.costo_unitario == null ? null : Number(d.costo_unitario),
      };
    }),
    ...mermas.map((m) => ({
      fecha: m.fecha,
      idVariante: m.idVariante,
      cantidad: m.cantidad,
      medio: "MERMA" as MedioLiquidacion,
      subtotalVenta: 0,
      medioPrecios: "efectivo" as Medio,
      costoAlVender: m.costoUnitario,
    })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Los lotes se cargan una vez por variante y se van gastando en memoria.
  const lotesPorVariante = new Map<string, Awaited<ReturnType<typeof lotesDeVariante>>>();
  for (const idVariante of new Set(eventos.map((e) => e.idVariante))) {
    lotesPorVariante.set(idVariante, await lotesDeVariante(supabase, idProveedor, idVariante));
  }

  // Clave: medio + variante. Adentro se acumulan los lotes por recepción.
  const acumulado = new Map<string, LineaDetalle & { _lotes: Map<string, LoteDeLinea> }>();
  // Ya no se estima nada: la plata es siempre el costo al vender (19/11).
  const estimado = false;

  for (const ev of eventos) {
    const cantidad = ev.cantidad;
    if (cantidad <= 0) continue;

    const idVariante = ev.idVariante;
    const v = variantePorId.get(idVariante);
    const p = v ? productoPorId.get(v.id_producto as string) : undefined;
    if (!v || !p) continue;

    const medio = ev.medio;
    // Lo que se le paga: el costo del día de la venta (o de la merma); si es viejo y no quedó, el de hoy (19/11).
    const costoEvento = ev.costoAlVender ?? Number((p.costo_informado as number | null) ?? 0);

    // El lote solo dice de qué pedido salió; la plata es costoEvento.
    const r = consumirEnMemoria(lotesPorVariante.get(idVariante) ?? [], cantidad, costoEvento);

    const clave = `${medio}|${idVariante}`;
    let linea = acumulado.get(clave);
    if (!linea) {
      const nombreBase = conUnidadDeGranel((p.nombre as string) ?? "Producto");
      linea = {
        idVariante,
        nombreProducto: v.nombre !== "Único" ? `${nombreBase} — ${v.nombre}` : nombreBase,
        ivaPorcentaje: (p.iva_porcentaje as number | null) ?? 21,
        precioVenta: 0,
        cantidad: 0,
        costoNeto: 0,
        iva: 0,
        ventaNeta: 0,
        ventaTotal: 0,
        gastos: 0,
        margen: 0,
        lotes: [],
        _lotes: new Map(),
      };
      acumulado.set(clave, linea);
    }

    // La venta y sus gastos, como en Precios (ver ganancia en calcularPrecio):
    // el IVA y el IIBB se restan solo si están tildados para esa forma de
    // pago; la comisión y el cheque, sobre el total cobrado. Más la bolsita.
    if (medio !== "MERMA") {
      const d = cfg.descuenta[ev.medioPrecios];
      const ivaProducto = ((p.iva_porcentaje as number | null) ?? cfg.ivaGeneral) / 100;
      const netoReal = d.iva ? ev.subtotalVenta / (1 + ivaProducto) : ev.subtotalVenta;
      const impuestos = (d.iibb ? netoReal * (cfg.iibb / 100) : 0) + ev.subtotalVenta * costosSobreTotal(ev.medioPrecios, cfg);
      linea.ventaNeta = redondear2(linea.ventaNeta + netoReal);
      linea.gastos = redondear2(linea.gastos + impuestos + cantidad * bolsitaDe(p));
    }

    // El precio de venta se muestra como el unitario real de la línea. Si en
    // el período se vendió a distintos precios, queda el promedio ponderado
    // — el que importa para el margen. En una merma queda en 0, que es la
    // verdad: esa mercadería no se vendió a ningún precio.
    linea.cantidad += cantidad;
    linea.ventaTotal = redondear2(linea.ventaTotal + ev.subtotalVenta);
    linea.precioVenta = linea.cantidad > 0 ? redondear2(linea.ventaTotal / linea.cantidad) : 0;

    for (const c of r.consumos) {
      const k = c.idDetalleRecepcion;
      const ya = linea._lotes.get(k);
      if (ya) {
        // Promedio ponderado del costo al vender de lo que salió de ese lote.
        ya.costoUnitario = (ya.costoUnitario * ya.cantidad + costoEvento * c.cantidad) / (ya.cantidad + c.cantidad);
        ya.cantidad += c.cantidad;
      } else
        linea._lotes.set(k, {
          idDetalleRecepcion: k,
          fechaRecepcion: c.fechaRecepcion,
          cantidad: c.cantidad,
          costoUnitario: costoEvento,
        });
    }
    linea.costoNeto = redondear2(linea.costoNeto + cantidad * costoEvento);
  }

  // Los motivos de merma, agrupados por producto, para poder mostrar
  // "3 rotura · 1 vencimiento" al lado de la línea.
  const mermasPorVariante = new Map<string, MermaPendiente[]>();
  for (const m of mermas) {
    mermasPorVariante.set(m.idVariante, [...(mermasPorVariante.get(m.idVariante) ?? []), m]);
  }

  const porMedio = (["ELECTRONICO", "EFECTIVO", "MERMA"] as MedioLiquidacion[]).map((medio) => {
    const lineas: LineaDetalle[] = [];
    const totales = totalesVacios();

    for (const [clave, acc] of acumulado) {
      if (!clave.startsWith(`${medio}|`)) continue;
      // Se arma una línea limpia: `_lotes` es un Map de trabajo y no tiene
      // por qué viajar al navegador.
      const { _lotes, ...resto } = acc;
      const l: LineaDetalle = {
        ...resto,
        lotes: [..._lotes.values()].sort((a, b) => a.fechaRecepcion.localeCompare(b.fechaRecepcion)),
        iva: redondear2(acc.costoNeto * (acc.ivaPorcentaje / 100)),
        // ventaNeta y gastos ya vienen sumados venta por venta con la regla de
        // Precios. En merma son 0 y el margen queda en menos el costo entero,
        // que es exactamente lo que se perdió.
        margen: 0,
      };
      l.margen = redondear2(l.ventaNeta - l.costoNeto - l.gastos);
      if (medio === "MERMA") {
        l.motivos = resumirMotivos(mermasPorVariante.get(acc.idVariante) ?? []);
      }
      lineas.push(l);
      acumular(totales, l);
    }

    lineas.sort((a, b) => a.nombreProducto.localeCompare(b.nombreProducto));
    return { medio, lineas, totales };
  });

  const totales = totalesVacios();
  porMedio.forEach((g) => g.lineas.forEach((l) => acumular(totales, l)));

  return { porMedio, totales, estimado };
}

// ===================== EL COMPROBANTE =====================
//
// Lo que se guardó de una liquidación ya cerrada, para poder imprimirlo y
// mostrárselo al proveedor. No recalcula nada: lee el detalle tal como quedó
// congelado al confirmar. Si el costo de un lote se corrigió después, este
// papel sigue diciendo lo que se liquidó ese día — que es el punto de tener
// un comprobante.

export type LineaComprobante = {
  producto: string;
  /** Cuándo entró el lote del que salieron estas unidades. */
  fechaRecepcion: string | null;
  cantidad: number;
  costoUnitario: number;
  subtotal: number;
};

export type LineaMermaComprobante = {
  producto: string;
  motivo: string;
  fecha: string;
  cantidad: number;
  costoUnitario: number;
  subtotal: number;
};

export type ComprobanteLiquidacionProveedor = {
  idLiquidacion: string;
  proveedor: { nombre: string; cuit: string | null; modoFacturacion: string };
  fechaDesde: string;
  fechaHasta: string;
  fecha: string;
  usuario: string | null;
  vendidas: LineaComprobante[];
  mermas: LineaMermaComprobante[];
  /** El costo de la merma sale del subtotal guardado menos lo vendido. */
  netoVendido: number;
  netoMerma: number;
  montoFinal: number;
  facturaNumero: string | null;
  facturaIva: number | null;
};

export async function comprobanteLiquidacionProveedor(
  supabase: SupabaseClient,
  idLiquidacion: string
): Promise<ComprobanteLiquidacionProveedor | null> {
  const { data: liq } = await supabase
    .from("liquidaciones_proveedor")
    .select("*")
    .eq("id_liquidacion", idLiquidacion)
    .maybeSingle();
  if (!liq) return null;

  const [provRes, detalleRes, mermasRes] = await Promise.all([
    supabase
      .from("proveedores")
      .select("nombre, cuit, modo_facturacion")
      .eq("id_proveedor", liq.id_proveedor as string)
      .maybeSingle(),
    supabase
      .from("detalle_liquidacion_proveedor")
      .select("id_variante, id_detalle_recepcion, cantidad_vendida, costo_unitario, subtotal")
      .eq("id_liquidacion", idLiquidacion),
    supabase
      .from("mermas")
      .select("id_variante, cantidad, motivo, fecha, costo_unitario")
      .eq("id_liquidacion_proveedor", idLiquidacion)
      .order("fecha", { ascending: true }),
  ]);

  const detalle = detalleRes.data ?? [];
  const mermas = mermasRes.data ?? [];

  // Nombres de producto para las dos listas.
  const idsVariante = [
    ...new Set([...detalle, ...mermas].map((d) => d.id_variante as string).filter(Boolean)),
  ];
  const { data: variantes } = idsVariante.length
    ? await supabase.from("variantes_producto").select("id_variante, id_producto, nombre").in("id_variante", idsVariante)
    : { data: [] as Record<string, unknown>[] };
  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto as string))];
  const { data: productos } = idsProducto.length
    ? await supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProducto)
    : { data: [] as Record<string, unknown>[] };

  const nombreProducto = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
  const nombreVariante = new Map(
    (variantes ?? []).map((v) => {
      const base = nombreProducto.get(v.id_producto as string) ?? "Producto";
      return [v.id_variante as string, v.nombre !== "Único" ? `${base} — ${v.nombre}` : base];
    })
  );

  // La fecha del lote: es lo que deja decirle al proveedor de qué remito
  // salió cada unidad si discute el costo.
  const idsLote = [
    ...new Set(detalle.map((d) => d.id_detalle_recepcion as string | null).filter((x): x is string => Boolean(x))),
  ];
  const { data: lotes } = idsLote.length
    ? await supabase.from("detalle_recepcion_proveedor").select("id_detalle, id_recepcion").in("id_detalle", idsLote)
    : { data: [] as Record<string, unknown>[] };
  const idsRecepcion = [...new Set((lotes ?? []).map((l) => l.id_recepcion as string))];
  const { data: recepciones } = idsRecepcion.length
    ? await supabase.from("recepciones_proveedor").select("id_recepcion, fecha").in("id_recepcion", idsRecepcion)
    : { data: [] as Record<string, unknown>[] };
  const fechaRecepcion = new Map((recepciones ?? []).map((r) => [r.id_recepcion as string, r.fecha as string]));
  const fechaDeLote = new Map(
    (lotes ?? []).map((l) => [l.id_detalle as string, fechaRecepcion.get(l.id_recepcion as string) ?? null])
  );

  const vendidas: LineaComprobante[] = detalle
    .map((d) => ({
      producto: nombreVariante.get(d.id_variante as string) ?? "Producto",
      fechaRecepcion: d.id_detalle_recepcion ? fechaDeLote.get(d.id_detalle_recepcion as string) ?? null : null,
      cantidad: (d.cantidad_vendida as number) ?? 0,
      costoUnitario: (d.costo_unitario as number) ?? 0,
      subtotal: (d.subtotal as number) ?? 0,
    }))
    .sort((a, b) => a.producto.localeCompare(b.producto) || (a.fechaRecepcion ?? "").localeCompare(b.fechaRecepcion ?? ""));

  const lineasMerma: LineaMermaComprobante[] = mermas.map((m) => {
    const cantidad = (m.cantidad as number) ?? 0;
    // El costo quedó congelado cuando se registró la merma — es el mismo
    // número que la pantalla mostró antes de confirmarla. Guardarlo ahí y no
    // recalcularlo acá es lo que hace que el papel y lo que se dijo en el
    // momento digan siempre lo mismo.
    const costoUnitario = (m.costo_unitario as number | null) ?? 0;
    return {
      producto: nombreVariante.get(m.id_variante as string) ?? "Producto",
      motivo: (m.motivo as string) ?? "OTRO",
      fecha: m.fecha as string,
      cantidad,
      costoUnitario,
      subtotal: redondear2(cantidad * costoUnitario),
    };
  });

  // El detalle guardado suma vendido + merma en un renglón por lote: al
  // liquidar, las unidades de merma se sumaron a las vendidas para consumir
  // el FIFO una sola vez. Acá se vuelve a partir restando la merma, que sí
  // tiene su costo propio guardado.
  const totalGuardado = detalle.reduce((a, d) => a + ((d.subtotal as number) ?? 0), 0);
  const netoMerma = redondear2(lineasMerma.reduce((a, m) => a + m.subtotal, 0));
  const netoVendido = redondear2(totalGuardado - netoMerma);

  return {
    idLiquidacion,
    proveedor: {
      nombre: (provRes.data?.nombre as string) ?? "Proveedor",
      cuit: (provRes.data?.cuit as string | null) ?? null,
      modoFacturacion: (provRes.data?.modo_facturacion as string) ?? "",
    },
    fechaDesde: liq.fecha_desde as string,
    fechaHasta: liq.fecha_hasta as string,
    fecha: (liq.fecha as string) ?? "",
    usuario: (liq.usuario as string | null) ?? null,
    vendidas,
    mermas: lineasMerma,
    netoVendido,
    netoMerma,
    montoFinal: (liq.monto_final as number) ?? 0,
    facturaNumero: (liq.factura_numero as string | null) ?? null,
    facturaIva: (liq.factura_iva as number | null) ?? null,
  };
}

export async function generarLiquidacionProveedor(
  supabase: SupabaseClient,
  params: {
    idProveedor: string;
    fechaDesde: string;
    fechaHasta: string;
    montoFinal: number;
    usuario: string | null;
    observaciones: string | null;
  }
): Promise<string> {
  // Se recalcula fresco (no se reusa lo que se mostró en el preview) porque
  // puede haber pasado tiempo entre calcular y confirmar, y en el medio
  // pudo haberse cargado otra venta o devolución que cambie qué lotes están
  // disponibles.
  const fresco = await calcularLiquidacionProveedor(supabase, params.idProveedor, params.fechaDesde, params.fechaHasta);
  const montoCalculado = fresco.lineas.reduce((acc, l) => acc + l.subtotal, 0);

  const { data: liquidacion, error } = await supabase
    .from("liquidaciones_proveedor")
    .insert({
      id_proveedor: params.idProveedor,
      fecha_desde: params.fechaDesde,
      fecha_hasta: params.fechaHasta,
      monto_calculado: montoCalculado,
      monto_final: params.montoFinal,
      estado: "GENERADA",
      observaciones: params.observaciones,
      usuario: params.usuario,
    })
    .select("id_liquidacion")
    .single();
  if (error) throw new Error(error.message);

  // Un renglón por cada lote consumido (no uno por producto) para poder ver
  // después de qué remito salió cada parte de la plata liquidada.
  for (const linea of fresco.lineas) {
    for (const lote of linea.lotes) {
      const { error: errorDetalle } = await supabase.from("detalle_liquidacion_proveedor").insert({
        id_liquidacion: liquidacion.id_liquidacion,
        id_variante: linea.idVariante,
        id_detalle_recepcion: lote.idDetalleRecepcion === "ESTIMADO" ? null : lote.idDetalleRecepcion,
        cantidad_vendida: lote.cantidad,
        costo_unitario: lote.costoUnitario,
        subtotal: Math.round(lote.cantidad * lote.costoUnitario),
      });
      if (errorDetalle) throw new Error(errorDetalle.message);
    }
    // Recién acá, al confirmar, se descuenta de verdad el saldo disponible
    // de cada lote — es lo que hace que lo no vendido quede para el mes
    // que viene en vez de perderse.
    await aplicarConsumoLotes(supabase, linea.lotes);
  }

  // Marcar por línea exactamente lo que entró en esta liquidación (lo vendido y
  // ya cobrado, 19/11), para no volver a contarlo el mes que viene. Lo que está
  // en camino queda sin marcar y entra cuando llegue la plata.
  for (let i = 0; i < fresco.idsDetalle.length; i += 200) {
    await supabase
      .from("detalle_ventas")
      .update({ id_liquidacion_proveedor: liquidacion.id_liquidacion })
      .in("id_detalle", fresco.idsDetalle.slice(i, i + 200))
      .is("id_liquidacion_proveedor", null);
  }
  // Lo mismo con la merma. Sin esto, la mercadería rota se le pagaría a
  // Alifrut todos los meses hasta el fin de los tiempos.
  for (let i = 0; i < fresco.idsMerma.length; i += 200) {
    await supabase
      .from("mermas")
      .update({ id_liquidacion_proveedor: liquidacion.id_liquidacion })
      .in("id_merma", fresco.idsMerma.slice(i, i + 200))
      .is("id_liquidacion_proveedor", null);
  }

  return liquidacion.id_liquidacion as string;
}
