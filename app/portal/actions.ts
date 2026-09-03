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
