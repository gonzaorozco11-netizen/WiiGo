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

function inicioDeMes(fechaISO: string) {
  return `${fechaISO.slice(0, 7)}-01`;
}

function mesAnterior(fechaISO: string) {
  const [anio, mes] = fechaISO.slice(0, 7).split("-").map(Number);
  const previo = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
  const mm = String(previo.mes).padStart(2, "0");
  const ultimoDia = new Date(previo.anio, previo.mes, 0).getDate();
  return { desde: `${previo.anio}-${mm}-01`, hasta: `${previo.anio}-${mm}-${ultimoDia}` };
}

export type ResumenPortal = {
  // Todo lo que la marca ve del mes en curso. "bruto" es el precio que pagó
  // el cliente (con IVA incluido), que es la base sobre la que se calcula el
  // royalty — así está acordado y así lo liquida el sistema.
  mes: { bruto: number; unidades: number; operaciones: number; royalty: number; neto: number };
  hoy: { bruto: number; unidades: number; operaciones: number };
  mesAnteriorBruto: number;
  ticketPromedio: number;
  porMedioPago: { medio: string; monto: number; porcentaje: number }[];
  // Lo que ya está cerrado y todavía no cobró, más lo que le debe a WiiGo.
  liquidacionesPendientes: number;
  saldoComercial: number;
  desdeISO: string;
  hastaISO: string;
};

const MEDIO_LABEL: Record<string, string> = {
  EFECTIVO: "Efectivo",
  MERCADO_PAGO: "Mercado Pago",
  TRANSFERENCIA: "Transferencia",
};

export async function resumenPortal(): Promise<ResumenPortal | null> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  // Hora argentina: el servidor corre en UTC y, sin esto, todo lo vendido
  // después de las 21 caería en el día siguiente.
  const hoyISO = fechaHoraArgentina().fecha;
  const desde = inicioDeMes(hoyISO);

  // ===== Ventas del mes de esta marca =====
  // Dos pasos y no un join: primero las ventas del período (acota el
  // universo), después sus renglones filtrados por marca.
  const { data: ventasMes } = await supabase
    .from("ventas")
    .select("id_venta, fecha, medio_pago")
    .eq("estado", "PAGADA")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hoyISO}T23:59:59`);

  const idsMes = (ventasMes ?? []).map((v) => v.id_venta as string);
  const infoVenta = new Map(
    (ventasMes ?? []).map((v) => [v.id_venta as string, { fecha: v.fecha as string, medio: v.medio_pago as string }])
  );

  const { data: renglones } = idsMes.length
    ? await supabase
        .from("detalle_ventas")
        .select("id_venta, cantidad, precio_unitario, subtotal")
        .eq("id_marca", sesion.idMarca)
        .in("id_venta", idsMes)
    : { data: [] };

  let brutoMes = 0;
  let unidadesMes = 0;
  let brutoHoy = 0;
  let unidadesHoy = 0;
  const ventasDelMes = new Set<string>();
  const ventasDeHoy = new Set<string>();
  const porMedio = new Map<string, number>();

  for (const r of renglones ?? []) {
    const info = infoVenta.get(r.id_venta as string);
    if (!info) continue;
    const monto = (r.subtotal as number) ?? (r.precio_unitario as number) * (r.cantidad as number);
    const unidades = (r.cantidad as number) ?? 0;

    brutoMes += monto;
    unidadesMes += unidades;
    ventasDelMes.add(r.id_venta as string);
    porMedio.set(info.medio, (porMedio.get(info.medio) ?? 0) + monto);

    if (info.fecha.slice(0, 10) === hoyISO) {
      brutoHoy += monto;
      unidadesHoy += unidades;
      ventasDeHoy.add(r.id_venta as string);
    }
  }

  // ===== Royalty y neto: el MISMO motor que la liquidación =====
  // Es deliberado no recalcularlo acá. Si el portal dijera un número y la
  // liquidación otro, la marca deja de creerle a los dos.
  let royaltyMes = 0;
  let netoMes = 0;
  try {
    const rendicion = await calcularRendicion(sesion.idMarca, desde, hoyISO);
    royaltyMes = rendicion.resumen.comisionWiigo + rendicion.resumen.ivaComision;
    netoMes = rendicion.resumen.netoARendir;
  } catch {
    // Si el cálculo falla, se muestra el bruto y el neto queda en cero antes
    // que mostrar un número inventado.
  }

  // ===== Mes anterior, para comparar =====
  const previo = mesAnterior(hoyISO);
  const { data: ventasPrevias } = await supabase
    .from("ventas")
    .select("id_venta")
    .eq("estado", "PAGADA")
    .gte("fecha", `${previo.desde}T00:00:00`)
    .lte("fecha", `${previo.hasta}T23:59:59`);
  const idsPrevios = (ventasPrevias ?? []).map((v) => v.id_venta as string);
  const { data: renglonesPrevios } = idsPrevios.length
    ? await supabase
        .from("detalle_ventas")
        .select("subtotal, precio_unitario, cantidad")
        .eq("id_marca", sesion.idMarca)
        .in("id_venta", idsPrevios)
    : { data: [] };
  const mesAnteriorBruto = (renglonesPrevios ?? []).reduce(
    (acc, r) => acc + ((r.subtotal as number) ?? (r.precio_unitario as number) * (r.cantidad as number)),
    0
  );

  // ===== Liquidaciones cerradas sin pagar =====
  const { data: liquidaciones } = await supabase
    .from("liquidaciones")
    .select("neto_a_transferir, estado")
    .eq("id_marca", sesion.idMarca)
    .neq("estado", "PAGADA");
  const liquidacionesPendientes = (liquidaciones ?? []).reduce(
    (acc, l) => acc + ((l.neto_a_transferir as number) ?? 0),
    0
  );

  // ===== Lo que le debe a WiiGo (fees, abono del plan, cargos) =====
  const { data: movimientos } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("importe")
    .eq("id_marca", sesion.idMarca);
  const saldoComercial = (movimientos ?? []).reduce((acc, m) => acc + ((m.importe as number) ?? 0), 0);

  const totalMedios = [...porMedio.values()].reduce((a, b) => a + b, 0);

  return {
    mes: {
      bruto: brutoMes,
      unidades: unidadesMes,
      operaciones: ventasDelMes.size,
      royalty: royaltyMes,
      neto: netoMes,
    },
    hoy: { bruto: brutoHoy, unidades: unidadesHoy, operaciones: ventasDeHoy.size },
    mesAnteriorBruto,
    ticketPromedio: ventasDelMes.size > 0 ? brutoMes / ventasDelMes.size : 0,
    porMedioPago: [...porMedio.entries()]
      .map(([medio, monto]) => ({
        medio: MEDIO_LABEL[medio] ?? medio,
        monto,
        porcentaje: totalMedios > 0 ? (monto / totalMedios) * 100 : 0,
      }))
      .sort((a, b) => b.monto - a.monto),
    liquidacionesPendientes,
    saldoComercial,
    desdeISO: desde,
    hastaISO: hoyISO,
  };
}
