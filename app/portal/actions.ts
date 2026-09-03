"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionMarca } from "@/lib/marcaSesion";
import { calcularRendicion } from "@/app/(app)/liquidaciones/actions";
import { fechaHoraArgentina } from "@/lib/horarios";

// Consultas del portal de marcas.
//
// Ninguna función de acá recibe un idMarca por parámetro: la marca sale
// siempre de la sesión. Es a propósito — un archivo "use server" expone cada
// función como endpoint POST, así que un parámetro sería justamente el
// agujero por donde una marca pediría los datos de otra.
//
// Todas las fechas se resuelven en hora argentina: el servidor corre en UTC
// y, sin eso, lo vendido después de las 21 caería en el día siguiente.

function inicioDeMes(fechaISO: string) {
  return `${fechaISO.slice(0, 7)}-01`;
}

function rangoMesAnterior(fechaISO: string) {
  const [anio, mes] = fechaISO.slice(0, 7).split("-").map(Number);
  const previo = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
  const mm = String(previo.mes).padStart(2, "0");
  const ultimoDia = new Date(previo.anio, previo.mes, 0).getDate();
  return { desde: `${previo.anio}-${mm}-01`, hasta: `${previo.anio}-${mm}-${ultimoDia}` };
}

const MEDIO_LABEL: Record<string, string> = {
  EFECTIVO: "Efectivo",
  MERCADO_PAGO: "Mercado Pago",
  TRANSFERENCIA: "Transferencia",
};

/** Renglones de venta de esta marca en un rango, ya cruzados con la venta. */
async function renglonesDeMarca(idMarca: string, desde: string, hasta: string) {
  const supabase = getSupabaseServerClient();

  // Dos pasos y no un join: primero las ventas del período (acota el
  // universo), después sus renglones filtrados por marca.
  const { data: ventas } = await supabase
    .from("ventas")
    .select("id_venta, fecha, medio_pago, estado, id_local")
    .in("estado", ["PAGADA", "ANULADA"])
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);

  const ids = (ventas ?? []).map((v) => v.id_venta as string);
  if (ids.length === 0) return [];

  const { data: detalle } = await supabase
    .from("detalle_ventas")
    .select("id_venta, id_variante, cantidad, precio_unitario, subtotal")
    .eq("id_marca", idMarca)
    .in("id_venta", ids);

  const porId = new Map(
    (ventas ?? []).map((v) => [
      v.id_venta as string,
      {
        fecha: v.fecha as string,
        medio: v.medio_pago as string,
        estado: v.estado as string,
        idLocal: v.id_local as string,
      },
    ])
  );

  return (detalle ?? [])
    .map((d) => {
      const v = porId.get(d.id_venta as string);
      if (!v) return null;
      return {
        idVenta: d.id_venta as string,
        idVariante: d.id_variante as string,
        cantidad: (d.cantidad as number) ?? 0,
        precioUnitario: (d.precio_unitario as number) ?? 0,
        monto: (d.subtotal as number) ?? (d.precio_unitario as number) * (d.cantidad as number),
        fecha: v.fecha,
        medio: v.medio,
        estado: v.estado,
        idLocal: v.idLocal,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

/** Nombre legible de cada variante, para no repetir el cruce en cada consulta. */
async function nombresDeVariante(ids: string[]) {
  const nombres = new Map<string, string>();
  if (ids.length === 0) return nombres;
  const supabase = getSupabaseServerClient();

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_variante", ids);
  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto as string))];
  const { data: productos } = idsProducto.length
    ? await supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProducto)
    : { data: [] };
  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));

  for (const v of variantes ?? []) {
    const base = productoPorId.get(v.id_producto as string) ?? "Producto";
    const nombre = (v.nombre as string) !== "Único" ? `${base} — ${v.nombre}` : base;
    nombres.set(v.id_variante as string, nombre);
  }
  return nombres;
}

export type ResumenPortal = {
  // "bruto" es el precio final que pagó el cliente, con IVA incluido — que es
  // la base sobre la que se calcula la comisión. Se aclara en pantalla.
  mes: { bruto: number; unidades: number; operaciones: number; royalty: number; neto: number };
  hoy: { bruto: number; unidades: number; operaciones: number };
  mesAnteriorBruto: number;
  ticketPromedio: number;
  porMedioPago: { medio: string; monto: number; porcentaje: number }[];
  // Serie diaria para el gráfico: un punto por día del mes, más la del mes
  // anterior de referencia.
  serieMes: number[];
  serieMesAnterior: number[];
  liquidacionesPendientes: number;
  saldoComercial: number;
  desdeISO: string;
  hastaISO: string;
};

export async function resumenPortal(): Promise<ResumenPortal | null> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const hoyISO = fechaHoraArgentina().fecha;
  const desde = inicioDeMes(hoyISO);
  const previo = rangoMesAnterior(hoyISO);

  const [renglonesMes, renglonesPrevios] = await Promise.all([
    renglonesDeMarca(sesion.idMarca, desde, hoyISO),
    renglonesDeMarca(sesion.idMarca, previo.desde, previo.hasta),
  ]);

  // Las anuladas no suman en ningún total: si el portal las contara y la
  // liquidación no, la marca reclamaría plata que no existe.
  const pagadasMes = renglonesMes.filter((r) => r.estado === "PAGADA");

  let brutoMes = 0;
  let unidadesMes = 0;
  let brutoHoy = 0;
  let unidadesHoy = 0;
  const ventasMes = new Set<string>();
  const ventasHoy = new Set<string>();
  const porMedio = new Map<string, number>();
  const diasDelMes = Number(hoyISO.slice(8, 10));
  const serieMes = new Array(diasDelMes).fill(0) as number[];

  for (const r of pagadasMes) {
    brutoMes += r.monto;
    unidadesMes += r.cantidad;
    ventasMes.add(r.idVenta);
    porMedio.set(r.medio, (porMedio.get(r.medio) ?? 0) + r.monto);

    const dia = Number(r.fecha.slice(8, 10));
    if (dia >= 1 && dia <= diasDelMes) serieMes[dia - 1] += r.monto;

    if (r.fecha.slice(0, 10) === hoyISO) {
      brutoHoy += r.monto;
      unidadesHoy += r.cantidad;
      ventasHoy.add(r.idVenta);
    }
  }

  const diasPrevios = Number(previo.hasta.slice(8, 10));
  const serieMesAnterior = new Array(diasPrevios).fill(0) as number[];
  let mesAnteriorBruto = 0;
  for (const r of renglonesPrevios) {
    if (r.estado !== "PAGADA") continue;
    mesAnteriorBruto += r.monto;
    const dia = Number(r.fecha.slice(8, 10));
    if (dia >= 1 && dia <= diasPrevios) serieMesAnterior[dia - 1] += r.monto;
  }

  // Royalty y neto salen del MISMO motor que la liquidación. Es deliberado no
  // recalcularlos acá: si el portal dijera un número y la liquidación otro, la
  // marca deja de creerle a los dos.
  let royaltyMes = 0;
  let netoMes = 0;
  try {
    const rendicion = await calcularRendicion(sesion.idMarca, desde, hoyISO);
    royaltyMes = rendicion.resumen.comisionWiigo + rendicion.resumen.ivaComision;
    netoMes = rendicion.resumen.netoARendir;
  } catch {
    // Antes de mostrar un número inventado, se muestra el bruto y nada más.
  }

  const { data: liquidaciones } = await supabase
    .from("liquidaciones")
    .select("neto_a_transferir, estado")
    .eq("id_marca", sesion.idMarca)
    .neq("estado", "PAGADA");
  const liquidacionesPendientes = (liquidaciones ?? []).reduce(
    (acc, l) => acc + ((l.neto_a_transferir as number) ?? 0),
    0
  );

  const { data: movimientos } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("importe")
    .eq("id_marca", sesion.idMarca);
  const saldoComercial = (movimientos ?? []).reduce((acc, m) => acc + ((m.importe as number) ?? 0), 0);

  const totalMedios = [...porMedio.values()].reduce((a, b) => a + b, 0);

  return {
    mes: { bruto: brutoMes, unidades: unidadesMes, operaciones: ventasMes.size, royalty: royaltyMes, neto: netoMes },
    hoy: { bruto: brutoHoy, unidades: unidadesHoy, operaciones: ventasHoy.size },
    mesAnteriorBruto,
    ticketPromedio: ventasMes.size > 0 ? brutoMes / ventasMes.size : 0,
    porMedioPago: [...porMedio.entries()]
      .map(([medio, monto]) => ({
        medio: MEDIO_LABEL[medio] ?? medio,
        monto,
        porcentaje: totalMedios > 0 ? (monto / totalMedios) * 100 : 0,
      }))
      .sort((a, b) => b.monto - a.monto),
    serieMes,
    serieMesAnterior,
    liquidacionesPendientes,
    saldoComercial,
    desdeISO: desde,
    hastaISO: hoyISO,
  };
}

export type VentaDelDia = {
  hora: string;
  producto: string;
  cantidad: number;
  precioUnitario: number;
  monto: number;
  medio: string;
  anulada: boolean;
};

/**
 * Las ventas de hoy, **solo los renglones de esta marca**.
 *
 * A propósito no se devuelve el número de venta: es correlativo, y viendo el
 * salto entre dos ventas propias una marca podría deducir cuántas ventas hace
 * el local en total. Con la hora alcanza para identificar una operación si
 * hay que reclamar algo.
 */
export async function ventasDeHoy(): Promise<VentaDelDia[]> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return [];

  const hoyISO = fechaHoraArgentina().fecha;
  const renglones = await renglonesDeMarca(sesion.idMarca, hoyISO, hoyISO);
  const nombres = await nombresDeVariante([...new Set(renglones.map((r) => r.idVariante))]);

  return renglones
    .map((r) => ({
      hora: new Date(r.fecha).toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit",
      }),
      producto: nombres.get(r.idVariante) ?? "Producto",
      cantidad: r.cantidad,
      precioUnitario: r.precioUnitario,
      monto: r.monto,
      medio: MEDIO_LABEL[r.medio] ?? r.medio,
      anulada: r.estado !== "PAGADA",
    }))
    .sort((a, b) => b.hora.localeCompare(a.hora));
}

export type OrdenPortal = {
  idOrden: string;
  fecha: string;
  local: string;
  estado: string;
  totalUnidades: number;
  recibidaEl: string | null;
  recibidaPor: string | null;
  // Solo se completa cuando hubo recepción; si algo no coincide, la marca lo
  // ve producto por producto.
  lineas: { producto: string; solicitada: number; recibida: number; diferencia: number }[];
  hayDiferencias: boolean;
};

/** Órdenes de reposición de esta marca y cómo se recibieron en el local. */
export async function reposicionPortal(): Promise<OrdenPortal[]> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return [];

  const supabase = getSupabaseServerClient();
  const { data: ordenes } = await supabase
    .from("ordenes_reposicion")
    .select("id_orden, fecha, estado, total_unidades, id_local")
    .eq("id_marca", sesion.idMarca)
    .order("fecha", { ascending: false })
    .limit(8);

  if (!ordenes || ordenes.length === 0) return [];

  const idsOrden = ordenes.map((o) => o.id_orden as string);
  const idsLocal = [...new Set(ordenes.map((o) => o.id_local as string).filter(Boolean))];

  const [{ data: recepciones }, { data: locales }] = await Promise.all([
    supabase.from("recepciones").select("id_recepcion, id_orden, fecha, usuario").in("id_orden", idsOrden),
    idsLocal.length
      ? supabase.from("locales").select("id_local, nombre").in("id_local", idsLocal)
      : Promise.resolve({ data: [] }),
  ]);

  const idsRecepcion = (recepciones ?? []).map((r) => r.id_recepcion as string);
  const { data: detalles } = idsRecepcion.length
    ? await supabase
        .from("detalle_recepciones")
        .select("id_recepcion, id_variante, cantidad_solicitada, cantidad_recibida, diferencia")
        .in("id_recepcion", idsRecepcion)
    : { data: [] };

  const nombres = await nombresDeVariante([...new Set((detalles ?? []).map((d) => d.id_variante as string))]);
  const localPorId = new Map((locales ?? []).map((l) => [l.id_local as string, l.nombre as string]));
  const recepcionPorOrden = new Map((recepciones ?? []).map((r) => [r.id_orden as string, r]));

  return ordenes.map((o) => {
    const recepcion = recepcionPorOrden.get(o.id_orden as string);
    const lineas = (detalles ?? [])
      .filter((d) => recepcion && d.id_recepcion === recepcion.id_recepcion)
      .map((d) => ({
        producto: nombres.get(d.id_variante as string) ?? "Producto",
        solicitada: (d.cantidad_solicitada as number) ?? 0,
        recibida: (d.cantidad_recibida as number) ?? 0,
        diferencia: (d.diferencia as number) ?? 0,
      }));

    return {
      idOrden: o.id_orden as string,
      fecha: o.fecha as string,
      local: localPorId.get(o.id_local as string) ?? "—",
      estado: (o.estado as string) ?? "PENDIENTE",
      totalUnidades: (o.total_unidades as number) ?? 0,
      recibidaEl: (recepcion?.fecha as string) ?? null,
      recibidaPor: (recepcion?.usuario as string) ?? null,
      lineas,
      hayDiferencias: lineas.some((l) => l.diferencia !== 0),
    };
  });
}

export type PagoPortal = { fecha: string | null; concepto: string; importe: number; vencido: boolean };

/**
 * Lo que la marca le debe a WiiGo: fee de ingreso, abono del plan y cargos.
 * Sale de la cuenta comercial, que es la misma fuente que usa Situación de
 * marca — un solo lugar donde vive la verdad.
 */
export async function pagosPortal(): Promise<{ pagos: PagoPortal[]; total: number }> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return { pagos: [], total: 0 };

  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("tipo_cargo, importe, periodo, fecha, observaciones")
    .eq("id_marca", sesion.idMarca)
    .gt("importe", 0)
    .order("fecha", { ascending: false })
    .limit(12);

  const hoyISO = fechaHoraArgentina().fecha;
  const ETIQUETA: Record<string, string> = {
    FEE_INGRESO: "Fee de ingreso",
    GASTO_FIJO_MENSUAL: "Gasto fijo mensual",
    CARGO_RECURRENTE: "Cargo mensual",
    OTRO_CARGO: "Otro cargo",
  };

  const pagos = (data ?? []).map((m) => ({
    fecha: (m.fecha as string) ?? null,
    concepto: (m.observaciones as string) || ETIQUETA[m.tipo_cargo as string] || "Cargo",
    importe: (m.importe as number) ?? 0,
    vencido: Boolean(m.fecha && (m.fecha as string).slice(0, 10) < hoyISO),
  }));

  return { pagos, total: pagos.reduce((acc, p) => acc + p.importe, 0) };
}

export type GananciaRealPortal = {
  bruto: number;
  // Cada deducción por separado — no lumped. Son exactamente las mismas
  // seis columnas que calcula la liquidación (ver construirLineas en
  // liquidaciones/actions.ts): comisión de WiiGo, el IVA sobre esa comisión,
  // la comisión de Mercado Pago (varía según cómo pagó el cliente: débito,
  // crédito o cuotas cobran distinto), SIRCREB, el Impuesto a los Créditos y
  // Débitos bancario, y el Impuesto a los Débitos si estuviera trasladado.
  comisionWiigo: number;
  ivaComision: number;
  comisionMp: number;
  sircreb: number;
  impCreditos: number;
  impDebitos: number;
  netoTrasComision: number;
  cargosDelMes: number;
  detalleCargos: { concepto: string; importe: number }[];
  quedaEnBolsillo: number;
};

/**
 * "Lo que te queda este mes": el detalle completo de todo lo que se
 * descuenta entre lo que pagó el cliente y lo que la marca termina cobrando,
 * más los cargos que WiiGo le hace aparte (fees, abono del plan).
 *
 * A propósito no se llama "rentabilidad": eso exigiría conocer el costo de
 * fabricación o compra de la marca, que WiiGo no tiene — es dato de ella.
 * Esto es exacto y verificable con lo que el sistema sabe, porque cada
 * número sale directo de `resumen` en calcularRendicion — el mismo objeto
 * que arma el comprobante de la liquidación. No se recalcula nada acá.
 */
export async function gananciaRealPortal(): Promise<GananciaRealPortal | null> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const hoyISO = fechaHoraArgentina().fecha;
  const desde = inicioDeMes(hoyISO);

  let bruto = 0;
  let comisionWiigo = 0;
  let ivaComision = 0;
  let comisionMp = 0;
  let sircreb = 0;
  let impCreditos = 0;
  let impDebitos = 0;
  let netoTrasComision = 0;
  try {
    const r = (await calcularRendicion(sesion.idMarca, desde, hoyISO)).resumen;
    bruto = r.ventaBruta;
    comisionWiigo = r.comisionWiigo;
    ivaComision = r.ivaComision;
    comisionMp = r.feeMp;
    sircreb = r.sircreb;
    impCreditos = r.impCreditos;
    impDebitos = r.impDebitos;
    netoTrasComision = r.netoARendir;
  } catch {
    return null; // antes de mostrar un número armado a medias, no se muestra nada
  }

  const { data: movimientos } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("tipo_cargo, importe, observaciones")
    .eq("id_marca", sesion.idMarca)
    .gt("importe", 0)
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hoyISO}T23:59:59`);

  const ETIQUETA: Record<string, string> = {
    FEE_INGRESO: "Fee de ingreso",
    GASTO_FIJO_MENSUAL: "Gasto fijo mensual",
    CARGO_RECURRENTE: "Abono / cargo mensual",
    OTRO_CARGO: "Otro cargo",
  };
  const porConcepto = new Map<string, number>();
  for (const m of movimientos ?? []) {
    const et = (m.observaciones as string) || ETIQUETA[m.tipo_cargo as string] || "Cargo";
    porConcepto.set(et, (porConcepto.get(et) ?? 0) + ((m.importe as number) ?? 0));
  }
  const detalleCargos = [...porConcepto.entries()].map(([concepto, importe]) => ({ concepto, importe }));
  const cargosDelMes = detalleCargos.reduce((a, c) => a + c.importe, 0);

  return {
    bruto,
    comisionWiigo,
    ivaComision,
    comisionMp,
    sircreb,
    impCreditos,
    impDebitos,
    netoTrasComision,
    cargosDelMes,
    detalleCargos,
    quedaEnBolsillo: netoTrasComision - cargosDelMes,
  };
}

export type GananciaPorProducto = {
  producto: string;
  bruto: number;
  comisionWiigo: number;
  ivaComision: number;
  comisionMp: number;
  sircreb: number;
  impCreditos: number;
  impDebitos: number;
  neto: number;
  porcentaje: number;
};

/** Una línea real: un producto tuyo, dentro de una venta real. Sin el
 * número de venta — mismo criterio que "Ventas de hoy": es correlativo y
 * revelaría cuántas ventas hace el local en total. */
export type LineaVentaMarca = {
  fecha: string;
  hora: string;
  producto: string;
  cantidad: number;
  medioPago: string;
  bruto: number;
  comisionWiigo: number;
  ivaComision: number;
  comisionMp: number;
  sircreb: number;
  impCreditos: number;
  impDebitos: number;
  neto: number;
};

export type DetalleMesPortal = {
  porProducto: GananciaPorProducto[];
  porVenta: LineaVentaMarca[];
  /** Cuántas líneas hay en total antes de recortar la lista a mostrar. */
  totalLineas: number;
};

const TOPE_LINEAS_MOSTRADAS = 150;
/** Un rango no puede pedir más de un año: evita traer un histórico entero por accidente. */
const RANGO_MAXIMO_DIAS = 366;

function esFechaValida(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** LineaRendicion (interna, con número de venta) → lo que puede ver la marca. */
function mapearLineasParaPortal(lineas: Awaited<ReturnType<typeof calcularRendicion>>["lineas"]): LineaVentaMarca[] {
  return lineas
    .map((l) => ({
      fecha: l.fecha.slice(0, 10),
      hora: new Date(l.fecha).toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit",
      }),
      producto: l.producto,
      cantidad: l.cantidad,
      medioPago: MEDIO_LABEL[l.medioPago ?? ""] ?? l.medioPago ?? "—",
      bruto: l.ventaBruta,
      comisionWiigo: l.comisionWiigo,
      ivaComision: l.ivaComision,
      comisionMp: l.feeMp,
      sircreb: l.sircreb,
      impCreditos: l.impCreditos,
      impDebitos: l.impDebitos,
      neto: l.netoARendir,
    }))
    .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
}

/**
 * Las líneas de venta de esta marca en cualquier rango de fechas — para el
 * explorador con filtros (Hoy / Semana / Mes / Desde-Hasta) del tablero.
 *
 * Mismo motor que `detalleMesPortal` (calcularRendicion), solo que acá el
 * rango lo elige quien mira el tablero en vez de estar fijo al mes en curso.
 */
export async function lineasVentaPortal(desde: string, hasta: string): Promise<{ lineas: LineaVentaMarca[]; total: number }> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return { lineas: [], total: 0 };

  if (!esFechaValida(desde) || !esFechaValida(hasta)) throw new Error("Fechas inválidas");
  const [d, h] = desde <= hasta ? [desde, hasta] : [hasta, desde];

  const dias = Math.round((new Date(`${h}T12:00:00Z`).getTime() - new Date(`${d}T12:00:00Z`).getTime()) / DIA_MS) + 1;
  if (dias > RANGO_MAXIMO_DIAS) throw new Error("El rango no puede superar un año");

  let lineas;
  try {
    lineas = (await calcularRendicion(sesion.idMarca, d, h)).lineas;
  } catch {
    return { lineas: [], total: 0 };
  }

  const mapeadas = mapearLineasParaPortal(lineas);
  return { lineas: mapeadas.slice(0, TOPE_LINEAS_MOSTRADAS), total: mapeadas.length };
}

/**
 * El desglose completo del mes: agrupado por producto, y línea por línea tal
 * como se vendió — cada producto tuyo, dentro de cada venta real, con sus
 * seis deducciones abiertas (no lumped).
 *
 * Las dos vistas salen de la MISMA consulta a calcularRendicion, para que
 * sumar a mano todas las líneas de abajo dé exactamente el total de arriba
 * — es la garantía de que el detalle no puede contradecir al resumen.
 */
export async function detalleMesPortal(): Promise<DetalleMesPortal> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return { porProducto: [], porVenta: [], totalLineas: 0 };

  const hoyISO = fechaHoraArgentina().fecha;
  const desde = inicioDeMes(hoyISO);

  let lineas;
  try {
    lineas = (await calcularRendicion(sesion.idMarca, desde, hoyISO)).lineas;
  } catch {
    return { porProducto: [], porVenta: [], totalLineas: 0 };
  }

  type Acumulado = {
    bruto: number;
    comisionWiigo: number;
    ivaComision: number;
    comisionMp: number;
    sircreb: number;
    impCreditos: number;
    impDebitos: number;
    neto: number;
  };
  const vacio = (): Acumulado => ({
    bruto: 0,
    comisionWiigo: 0,
    ivaComision: 0,
    comisionMp: 0,
    sircreb: 0,
    impCreditos: 0,
    impDebitos: 0,
    neto: 0,
  });

  const porProductoMapa = new Map<string, Acumulado>();
  for (const l of lineas) {
    const actual = porProductoMapa.get(l.producto) ?? vacio();
    actual.bruto += l.ventaBruta;
    actual.comisionWiigo += l.comisionWiigo;
    actual.ivaComision += l.ivaComision;
    actual.comisionMp += l.feeMp;
    actual.sircreb += l.sircreb;
    actual.impCreditos += l.impCreditos;
    actual.impDebitos += l.impDebitos;
    actual.neto += l.netoARendir;
    porProductoMapa.set(l.producto, actual);
  }
  const porProducto = [...porProductoMapa.entries()]
    .map(([producto, v]) => ({ producto, ...v, porcentaje: v.bruto > 0 ? (v.neto / v.bruto) * 100 : 0 }))
    .sort((a, b) => b.bruto - a.bruto);

  const porVenta = mapearLineasParaPortal(lineas);

  return { porProducto, porVenta: porVenta.slice(0, TOPE_LINEAS_MOSTRADAS), totalLineas: porVenta.length };
}

// ===================== PLAN METAL: análisis de productos =====================

export type ProductoRanking = {
  producto: string;
  monto: number;
  unidades: number;
};

export type AlertaStock = {
  producto: string;
  stock: number;
  /** Unidades que se venden por semana, promedio de las últimas 4. */
  porSemana: number;
  /** Para cuántos días alcanza el stock. null si no se vende nada. */
  diasCobertura: number | null;
  /** Días desde la última venta. null si nunca se vendió en el período mirado. */
  diasSinVender: number | null;
  /** Plata parada en góndola, al precio de venta. */
  inmovilizado: number;
  nivel: "CRITICO" | "AVISO" | "FRENADO";
};

export type AccionSugerida = {
  titulo: string;
  detalle: string;
  nivel: "URGENTE" | "MEDIA" | "BUENA";
  icono: string;
};

export type AnalisisPortal = {
  ranking: ProductoRanking[];
  alertas: AlertaStock[];
  acciones: AccionSugerida[];
};

const DIA_MS = 86400000;

/**
 * Ranking, alertas de stock y qué conviene hacer.
 *
 * Todo sale de dos datos que el sistema ya tiene: el stock actual y las
 * ventas de los últimos 90 días. Las alertas no son un umbral fijo de
 * unidades —"menos de 5"— sino días de cobertura: quedarse con 4 unidades es
 * urgente si se venden 9 por semana y no significa nada si se vende una por
 * mes.
 */
export async function analisisPortal(): Promise<AnalisisPortal | null> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const hoyISO = fechaHoraArgentina().fecha;
  const hoy = new Date(`${hoyISO}T12:00:00Z`);
  const hace90 = new Date(hoy.getTime() - 90 * DIA_MS).toISOString().slice(0, 10);
  const hace28 = new Date(hoy.getTime() - 28 * DIA_MS).toISOString().slice(0, 10);
  const desdeMes = inicioDeMes(hoyISO);

  // ===== Variantes de la marca y su stock =====
  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre, precio_venta")
    .eq("id_marca", sesion.idMarca)
    .eq("estado", "ACTIVO");
  const idsProducto = (productos ?? []).map((p) => p.id_producto as string);
  if (idsProducto.length === 0) return { ranking: [], alertas: [], acciones: [] };

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_producto", idsProducto)
    .eq("estado", "ACTIVO");

  const productoPorId = new Map(
    (productos ?? []).map((p) => [p.id_producto as string, { nombre: p.nombre as string, precio: (p.precio_venta as number) ?? 0 }])
  );
  const infoVariante = new Map(
    (variantes ?? []).map((v) => {
      const p = productoPorId.get(v.id_producto as string);
      const base = p?.nombre ?? "Producto";
      return [
        v.id_variante as string,
        {
          nombre: (v.nombre as string) !== "Único" ? `${base} — ${v.nombre}` : base,
          precio: p?.precio ?? 0,
        },
      ];
    })
  );

  const idsVariante = [...infoVariante.keys()];
  const { data: stock } = idsVariante.length
    ? await supabase.from("stock").select("id_variante, cantidad").in("id_variante", idsVariante)
    : { data: [] };
  const stockPorVariante = new Map<string, number>();
  for (const s of stock ?? []) {
    const id = s.id_variante as string;
    stockPorVariante.set(id, (stockPorVariante.get(id) ?? 0) + ((s.cantidad as number) ?? 0));
  }

  // ===== Ventas de los últimos 90 días =====
  const renglones = (await renglonesDeMarca(sesion.idMarca, hace90, hoyISO)).filter((r) => r.estado === "PAGADA");

  const unidades28 = new Map<string, number>();
  const ultimaVenta = new Map<string, string>();
  const montoMes = new Map<string, number>();
  const unidadesMes = new Map<string, number>();

  for (const r of renglones) {
    const dia = r.fecha.slice(0, 10);
    if (dia >= hace28) unidades28.set(r.idVariante, (unidades28.get(r.idVariante) ?? 0) + r.cantidad);
    const previa = ultimaVenta.get(r.idVariante);
    if (!previa || dia > previa) ultimaVenta.set(r.idVariante, dia);
    if (dia >= desdeMes) {
      montoMes.set(r.idVariante, (montoMes.get(r.idVariante) ?? 0) + r.monto);
      unidadesMes.set(r.idVariante, (unidadesMes.get(r.idVariante) ?? 0) + r.cantidad);
    }
  }

  // ===== Ranking del mes =====
  const ranking: ProductoRanking[] = [...montoMes.entries()]
    .map(([id, monto]) => ({
      producto: infoVariante.get(id)?.nombre ?? "Producto",
      monto,
      unidades: unidadesMes.get(id) ?? 0,
    }))
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 6);

  // ===== Alertas =====
  const alertas: AlertaStock[] = [];
  for (const [id, info] of infoVariante) {
    const enStock = stockPorVariante.get(id) ?? 0;
    const porSemana = (unidades28.get(id) ?? 0) / 4;
    const ultima = ultimaVenta.get(id) ?? null;
    const diasSinVender = ultima
      ? Math.round((hoy.getTime() - new Date(`${ultima}T12:00:00Z`).getTime()) / DIA_MS)
      : null;

    if (enStock <= 0) continue; // sin stock no hay nada que avisar acá

    if (porSemana > 0) {
      const diasCobertura = Math.floor((enStock / porSemana) * 7);
      if (diasCobertura <= 14) {
        alertas.push({
          producto: info.nombre,
          stock: enStock,
          porSemana: Math.round(porSemana * 10) / 10,
          diasCobertura,
          diasSinVender,
          inmovilizado: 0,
          nivel: diasCobertura <= 7 ? "CRITICO" : "AVISO",
        });
      }
      continue;
    }

    // Sin ventas en 4 semanas y con mercadería en góndola: está frenado.
    if (diasSinVender === null || diasSinVender >= 30) {
      alertas.push({
        producto: info.nombre,
        stock: enStock,
        porSemana: 0,
        diasCobertura: null,
        diasSinVender,
        inmovilizado: enStock * info.precio,
        nivel: "FRENADO",
      });
    }
  }

  const orden = { CRITICO: 0, AVISO: 1, FRENADO: 2 };
  alertas.sort((a, b) => {
    if (orden[a.nivel] !== orden[b.nivel]) return orden[a.nivel] - orden[b.nivel];
    if (a.nivel === "FRENADO") return b.inmovilizado - a.inmovilizado;
    return (a.diasCobertura ?? 99) - (b.diasCobertura ?? 99);
  });

  // ===== Qué conviene hacer =====
  // Cada acción dice cuánto cuesta no hacerla: es lo que la vuelve una tarea
  // y no un dato más.
  const acciones: AccionSugerida[] = [];

  const critico = alertas.find((a) => a.nivel === "CRITICO");
  if (critico) {
    const precio = [...infoVariante.values()].find((v) => v.nombre === critico.producto)?.precio ?? 0;
    const perdida = Math.round(critico.porSemana * 2 * precio);
    acciones.push({
      titulo: `Reponé ${critico.producto}`,
      detalle:
        `Quedan ${critico.stock} unidades y se venden ${critico.porSemana} por semana: alcanza para ` +
        `${critico.diasCobertura} días.` + (perdida > 0 ? ` Quedarte sin stock dos semanas son unos $${perdida.toLocaleString("es-AR")} que dejás de vender.` : ""),
      nivel: "URGENTE",
      icono: "🔥",
    });
  }

  const frenado = alertas.find((a) => a.nivel === "FRENADO");
  if (frenado) {
    acciones.push({
      titulo: `Decidí qué hacer con ${frenado.producto}`,
      detalle:
        `${frenado.diasSinVender ? `${frenado.diasSinVender} días` : "Más de 90 días"} sin vender, con ` +
        `${frenado.stock} unidades ocupando góndola` +
        (frenado.inmovilizado > 0 ? `: son $${Math.round(frenado.inmovilizado).toLocaleString("es-AR")} inmovilizados.` : "."),
      nivel: "MEDIA",
      icono: "🐢",
    });
  }

  if (ranking.length >= 2) {
    const porUnidades = [...ranking].sort((a, b) => b.unidades - a.unidades)[0];
    if (porUnidades && porUnidades.producto !== ranking[0].producto && porUnidades.unidades > ranking[0].unidades * 2) {
      acciones.push({
        titulo: `${porUnidades.producto} es tu producto de mayor rotación`,
        detalle:
          `Vende ${porUnidades.unidades} unidades contra ${ranking[0].unidades} de ${ranking[0].producto}, ` +
          `pero factura menos. Es el que más gente lleva: sirve para hacer conocer la marca.`,
        nivel: "BUENA",
        icono: "📈",
      });
    }
  }

  return { ranking, alertas: alertas.slice(0, 6), acciones };
}

// ===================== PLAN GOLD: inteligencia =====================

export type GoldPortal = {
  /** Al ritmo del mes, cuánto cerraría. null si es muy temprano para decirlo. */
  proyeccion: number | null;
  /** Unidades por hora del día, de las últimas 8 semanas. */
  porHora: { hora: number; unidades: number }[];
  horaPico: number | null;
  porSucursal: { local: string; monto: number; unidades: number; porcentaje: number }[];
  /**
   * Comparación contra el resto de las marcas. Siempre agregada y anónima, y
   * solo si hay suficientes marcas como para que el promedio no delate a
   * ninguna en particular.
   */
  benchmark: { rotacion: number; promedio: number; posicion: number; marcas: number } | null;
  /** Ideas para vender más, cada una con el dato que la respalda. */
  ideas: { rotulo: string; titulo: string; detalle: string }[];
};

/** Mínimo de marcas en la comparación: con menos, el promedio delata al vecino. */
const MINIMO_PARA_COMPARAR = 4;

export async function goldPortal(): Promise<GoldPortal | null> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const hoyISO = fechaHoraArgentina().fecha;
  const hoy = new Date(`${hoyISO}T12:00:00Z`);
  const desdeMes = inicioDeMes(hoyISO);
  const hace56 = new Date(hoy.getTime() - 56 * DIA_MS).toISOString().slice(0, 10);
  const hace30 = new Date(hoy.getTime() - 30 * DIA_MS).toISOString().slice(0, 10);

  const [renglonesMes, renglonesLargos] = await Promise.all([
    renglonesDeMarca(sesion.idMarca, desdeMes, hoyISO),
    renglonesDeMarca(sesion.idMarca, hace56, hoyISO),
  ]);
  const pagadasMes = renglonesMes.filter((r) => r.estado === "PAGADA");
  const pagadasLargas = renglonesLargos.filter((r) => r.estado === "PAGADA");

  // ===== Proyección =====
  const brutoMes = pagadasMes.reduce((a, r) => a + r.monto, 0);
  const diaDeHoy = Number(hoyISO.slice(8, 10));
  const diasDelMes = new Date(Number(hoyISO.slice(0, 4)), Number(hoyISO.slice(5, 7)), 0).getDate();
  // Antes del día 5 la proyección es puro ruido: un solo día bueno la
  // dispara y queda en ridículo.
  const proyeccion = diaDeHoy >= 5 && brutoMes > 0 ? (brutoMes / diaDeHoy) * diasDelMes : null;

  // ===== Por hora =====
  const horas = new Map<number, number>();
  for (const r of pagadasLargas) {
    const hora = Number(
      new Date(r.fecha).toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        hour12: false,
      })
    );
    if (!Number.isFinite(hora)) continue;
    horas.set(hora, (horas.get(hora) ?? 0) + r.cantidad);
  }
  const porHora = [...horas.entries()]
    .map(([hora, unidades]) => ({ hora, unidades }))
    .sort((a, b) => a.hora - b.hora);
  const horaPico = porHora.length ? porHora.reduce((a, b) => (b.unidades > a.unidades ? b : a)).hora : null;

  // ===== Por sucursal =====
  const locales = new Map<string, { monto: number; unidades: number }>();
  for (const r of pagadasMes) {
    const actual = locales.get(r.idLocal) ?? { monto: 0, unidades: 0 };
    actual.monto += r.monto;
    actual.unidades += r.cantidad;
    locales.set(r.idLocal, actual);
  }
  const { data: nombresLocal } = locales.size
    ? await supabase.from("locales").select("id_local, nombre").in("id_local", [...locales.keys()])
    : { data: [] };
  const nombrePorLocal = new Map((nombresLocal ?? []).map((l) => [l.id_local as string, l.nombre as string]));
  const totalLocales = [...locales.values()].reduce((a, l) => a + l.monto, 0);
  const porSucursal = [...locales.entries()]
    .map(([id, v]) => ({
      local: nombrePorLocal.get(id) ?? "Sucursal",
      monto: v.monto,
      unidades: v.unidades,
      porcentaje: totalLocales > 0 ? (v.monto / totalLocales) * 100 : 0,
    }))
    .sort((a, b) => b.monto - a.monto);

  // ===== Benchmark: rotación propia contra el resto =====
  // Rotación = unidades vendidas en 30 días sobre unidades en stock. Se
  // calcula igual para todas y solo se devuelve el agregado: nunca sale de
  // acá el dato de una marca identificable.
  let benchmark: GoldPortal["benchmark"] = null;
  {
    const { data: marcas } = await supabase
      .from("marcas")
      .select("id_marca")
      .eq("estado", "ACTIVA")
      .eq("tipo_comercializacion", "CONSIGNACION");

    if ((marcas ?? []).length >= MINIMO_PARA_COMPARAR) {
      const { data: prods } = await supabase.from("productos").select("id_producto, id_marca").eq("estado", "ACTIVO");
      const marcaPorProducto = new Map((prods ?? []).map((p) => [p.id_producto as string, p.id_marca as string]));
      const { data: vars } = await supabase.from("variantes_producto").select("id_variante, id_producto").eq("estado", "ACTIVO");
      const marcaPorVariante = new Map(
        (vars ?? [])
          .map((v) => [v.id_variante as string, marcaPorProducto.get(v.id_producto as string)])
          .filter((p): p is [string, string] => Boolean(p[1]))
      );

      const { data: stockTodo } = await supabase.from("stock").select("id_variante, cantidad");
      const stockPorMarca = new Map<string, number>();
      for (const s of stockTodo ?? []) {
        const m = marcaPorVariante.get(s.id_variante as string);
        if (m) stockPorMarca.set(m, (stockPorMarca.get(m) ?? 0) + ((s.cantidad as number) ?? 0));
      }

      const { data: ventas30 } = await supabase
        .from("ventas")
        .select("id_venta")
        .eq("estado", "PAGADA")
        .gte("fecha", `${hace30}T00:00:00`);
      const ids30 = (ventas30 ?? []).map((v) => v.id_venta as string);
      const { data: det30 } = ids30.length
        ? await supabase.from("detalle_ventas").select("id_marca, cantidad").in("id_venta", ids30)
        : { data: [] };
      const vendidoPorMarca = new Map<string, number>();
      for (const d of det30 ?? []) {
        const m = d.id_marca as string | null;
        if (m) vendidoPorMarca.set(m, (vendidoPorMarca.get(m) ?? 0) + ((d.cantidad as number) ?? 0));
      }

      // Solo entran marcas con stock: sin mercadería la rotación no existe.
      const rotaciones = (marcas ?? [])
        .map((m) => {
          const id = m.id_marca as string;
          const enStock = stockPorMarca.get(id) ?? 0;
          if (enStock <= 0) return null;
          return { id, rotacion: (vendidoPorMarca.get(id) ?? 0) / enStock };
        })
        .filter((r): r is { id: string; rotacion: number } => r !== null);

      const propia = rotaciones.find((r) => r.id === sesion.idMarca);
      if (propia && rotaciones.length >= MINIMO_PARA_COMPARAR) {
        const ordenadas = [...rotaciones].sort((a, b) => b.rotacion - a.rotacion);
        const promedio = rotaciones.reduce((a, r) => a + r.rotacion, 0) / rotaciones.length;
        benchmark = {
          rotacion: propia.rotacion,
          promedio,
          posicion: ordenadas.findIndex((r) => r.id === sesion.idMarca) + 1,
          marcas: rotaciones.length,
        };
      }
    }
  }

  // ===== Ideas para vender más =====
  // Cada una se apoya en un dato verificable de la propia marca. Nada de
  // impactos estimados: si el número no se cumple, se pierde la confianza
  // que el resto del tablero construye.
  const ideas: GoldPortal["ideas"] = [];

  // Qué se lleva la gente junto con el producto más vendido.
  const nombres = await nombresDeVariante([...new Set(pagadasLargas.map((r) => r.idVariante))]);
  const unidadesPorVariante = new Map<string, number>();
  for (const r of pagadasLargas) unidadesPorVariante.set(r.idVariante, (unidadesPorVariante.get(r.idVariante) ?? 0) + r.cantidad);
  const estrella = [...unidadesPorVariante.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  if (estrella) {
    const ventasConEstrella = new Set(pagadasLargas.filter((r) => r.idVariante === estrella).map((r) => r.idVenta));
    const acompanantes = new Map<string, number>();
    for (const r of pagadasLargas) {
      if (r.idVariante === estrella || !ventasConEstrella.has(r.idVenta)) continue;
      const ventasDelAcompanante = acompanantes.get(r.idVariante) ?? 0;
      acompanantes.set(r.idVariante, ventasDelAcompanante + 1);
    }
    const mejor = [...acompanantes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (mejor && ventasConEstrella.size >= 5) {
      const pct = Math.round((mejor[1] / ventasConEstrella.size) * 100);
      if (pct >= 15) {
        ideas.push({
          rotulo: "Combo natural",
          titulo: `Armá un pack de ${nombres.get(estrella) ?? "tu producto estrella"} con ${nombres.get(mejor[0]) ?? "el acompañante"}`,
          detalle: `El ${pct}% de quienes compran el primero se llevan también el segundo en la misma venta. Juntos en un pack, se deciden más rápido.`,
        });
      }
    }
  }

  if (horaPico !== null && porHora.length >= 4) {
    const total = porHora.reduce((a, h) => a + h.unidades, 0);
    const enPico = porHora.find((h) => h.hora === horaPico)?.unidades ?? 0;
    const pct = total > 0 ? Math.round((enPico / total) * 100) : 0;
    ideas.push({
      rotulo: "Horario",
      titulo: `Concentrá tus promos alrededor de las ${horaPico} h`,
      detalle: `Es tu hora de mayor venta: ahí se mueve el ${pct}% de tus unidades. Es cuando más gente está frente a tu góndola.`,
    });
  }

  if (porSucursal.length >= 2) {
    const [primera, segunda] = porSucursal;
    if (primera.porcentaje - segunda.porcentaje > 25) {
      ideas.push({
        rotulo: "Sucursales",
        titulo: `Tu marca rinde mucho más en ${primera.local}`,
        detalle: `Concentra el ${primera.porcentaje.toFixed(0)}% de tus ventas contra el ${segunda.porcentaje.toFixed(0)}% de ${segunda.local}. Vale revisar cómo está exhibida allá.`,
      });
    }
  }

  return { proyeccion, porHora, horaPico, porSucursal, benchmark, ideas };
}

export type LiquidacionPortal = {
  periodo: string;
  neto: number;
  estado: string;
  fechaPago: string | null;
};

export async function liquidacionesPortal(): Promise<LiquidacionPortal[]> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return [];

  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("liquidaciones")
    .select("fecha_desde, fecha_hasta, neto_a_transferir, estado, fecha_pago")
    .eq("id_marca", sesion.idMarca)
    .order("fecha_hasta", { ascending: false })
    .limit(6);

  return (data ?? []).map((l) => ({
    periodo: `${(l.fecha_desde as string) ?? ""} al ${(l.fecha_hasta as string) ?? ""}`,
    neto: (l.neto_a_transferir as number) ?? 0,
    estado: (l.estado as string) ?? "PENDIENTE",
    fechaPago: (l.fecha_pago as string) ?? null,
  }));
}
