"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { calcularRentabilidad } from "@/app/(app)/rentabilidad/actions";
import { resumenGastos } from "@/app/(app)/gastos/actions";
import { saldoLiquidacionesPendiente } from "@/app/(app)/situacion-marca/actions";
import { saldoCuentaComercial } from "@/lib/cuentaComercialMarca";
import { saldosRetencionPorMarca } from "@/lib/retencionesMarca";
import type { SupabaseClient } from "@supabase/supabase-js";

// Royalty ganado por WiiGo en marcas de consignación durante el período —
// a diferencia de calcularRendicion (que solo mira ventas todavía sin
// liquidar), esto suma TODAS las ventas pagadas del período, se hayan
// liquidado o no, porque el ingreso se genera cuando se vende, no cuando
// se rinde.
async function royaltyConsignacionPeriodo(supabase: SupabaseClient, desde: string, hasta: string) {
  const { data: marcas, error: errorMarcas } = await supabase
    .from("marcas")
    .select("id_marca, royalty_porcentaje, iva_royalty_porcentaje, trasladar_iva_comision")
    .eq("tipo_comercializacion", "CONSIGNACION");
  if (errorMarcas) throw new Error(errorMarcas.message);
  const marcaPorId = new Map((marcas ?? []).map((m) => [m.id_marca, m]));
  if (marcaPorId.size === 0) return 0;

  const { data: ventas, error: errorVentas } = await supabase
    .from("ventas")
    .select("id_venta")
    .eq("estado", "PAGADA")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  if (errorVentas) throw new Error(errorVentas.message);
  const idsVenta = (ventas ?? []).map((v) => v.id_venta);
  if (idsVenta.length === 0) return 0;

  // Se filtra la marca del lado de JS (en vez de un segundo .in()) para no
  // depender de cómo Postgrest combine dos filtros .in() en la misma
  // consulta — más simple de confiar y de depurar.
  const { data: detalle, error: errorDetalle } = await supabase
    .from("detalle_ventas")
    .select("id_marca, subtotal, precio_unitario, cantidad")
    .in("id_venta", idsVenta);
  if (errorDetalle) throw new Error(errorDetalle.message);

  let royalty = 0;
  for (const d of detalle ?? []) {
    const marca = marcaPorId.get(d.id_marca);
    if (!marca) continue;
    const importe = d.subtotal ?? d.precio_unitario * d.cantidad;
    const comision = importe * ((marca.royalty_porcentaje ?? 0) / 100);
    const ivaComision = marca.trasladar_iva_comision ? comision * ((marca.iva_royalty_porcentaje ?? 0) / 100) : 0;
    royalty += comision + ivaComision;
  }
  return Math.round(royalty);
}

// Margen real de las marcas propias (venta - costo_informado, ya sin IVA
// ni costos financieros de cobro) — reutiliza el motor de /rentabilidad.
async function margenMarcaPropiaPeriodo(desde: string, hasta: string) {
  const supabase = getSupabaseServerClient();
  const { data: marcas } = await supabase.from("marcas").select("id_marca").eq("tipo_comercializacion", "PROPIA");
  let total = 0;
  for (const m of marcas ?? []) {
    const r = await calcularRentabilidad(m.id_marca, desde, hasta);
    total += r.resumen.contribucionNeta;
  }
  return Math.round(total);
}

// Fee de ingreso y gasto fijo mensual generados en el período (accrual: se
// cuentan cuando se cargan, no cuando la marca efectivamente paga — así
// queda en la misma base que el royalty, que se cuenta cuando se vende).
async function otrosIngresosPeriodo(supabase: SupabaseClient, desde: string, hasta: string) {
  const { data } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("importe")
    .in("tipo_cargo", ["FEE_INGRESO", "GASTO_FIJO_MENSUAL"])
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  return Math.round((data ?? []).reduce((acc, m) => acc + (m.importe > 0 ? m.importe : 0), 0));
}

// Venta bruta del período, todas las marcas y canales juntos.
async function ventaBrutaPeriodo(supabase: SupabaseClient, desde: string, hasta: string) {
  const { data } = await supabase
    .from("ventas")
    .select("total")
    .eq("estado", "PAGADA")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  return Math.round((data ?? []).reduce((acc, v) => acc + (v.total ?? 0), 0));
}

// Plata que efectivamente entró (neto acreditado, ya descontada la
// comisión de Mercado Pago) menos lo que salió en gastos ya pagados —
// es un movimiento neto de caja del período, no el saldo bancario total.
async function cajaPeriodo(supabase: SupabaseClient, desde: string, hasta: string) {
  const { data: pagos } = await supabase
    .from("pagos")
    .select("neto_acreditado")
    .eq("estado", "ACREDITADO")
    .gte("fecha_pago", `${desde}T00:00:00`)
    .lte("fecha_pago", `${hasta}T23:59:59`);
  const cobrado = (pagos ?? []).reduce((acc, p) => acc + (p.neto_acreditado ?? 0), 0);

  const { data: gastos } = await supabase
    .from("gastos")
    .select("monto, pendiente_factura")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  const pagado = (gastos ?? []).filter((g) => !g.pendiente_factura).reduce((acc, g) => acc + (g.monto ?? 0), 0);

  return Math.round(cobrado - pagado);
}

// Lo que hay que devolver/cruzar con las marcas, sumado entre todas — es
// el mismo cálculo de las tres cuentas de Situación de marca, agregado.
async function situacionAgregadaMarcas(supabase: SupabaseClient) {
  const { data: consignacion } = await supabase.from("marcas").select("id_marca").eq("tipo_comercializacion", "CONSIGNACION");
  const { data: todas } = await supabase.from("marcas").select("id_marca");

  let liquidaciones = 0;
  for (const m of consignacion ?? []) {
    liquidaciones += await saldoLiquidacionesPendiente(m.id_marca);
  }

  let comercial = 0;
  let retenciones = 0;
  for (const m of todas ?? []) {
    comercial += await saldoCuentaComercial(supabase, m.id_marca);
    const saldos = await saldosRetencionPorMarca(supabase, m.id_marca);
    retenciones += saldos.reduce((acc, s) => acc + s.saldo, 0);
  }

  return { liquidaciones: Math.round(liquidaciones), comercial: Math.round(comercial), retenciones: Math.round(retenciones) };
}

export async function resumenFinanciero(desde: string, hasta: string) {
  const supabase = getSupabaseServerClient();

  const [venta, royalty, margenPropia, otrosIngresos, gastos, caja, situacion] = await Promise.all([
    ventaBrutaPeriodo(supabase, desde, hasta),
    royaltyConsignacionPeriodo(supabase, desde, hasta),
    margenMarcaPropiaPeriodo(desde, hasta),
    otrosIngresosPeriodo(supabase, desde, hasta),
    resumenGastos({ desde, hasta }),
    cajaPeriodo(supabase, desde, hasta),
    situacionAgregadaMarcas(supabase),
  ]);

  const ingresoReal = royalty + margenPropia + otrosIngresos;
  const rentabilidad = ingresoReal - gastos.total;
  const disponibleReal = caja - situacion.liquidaciones - situacion.retenciones + situacion.comercial;

  return {
    venta,
    ingresoReal,
    ingresoPorOrigen: { margenPropia, royalty, otrosIngresos },
    gastos: { total: gastos.total, porCategoria: gastos.porCategoria },
    rentabilidad,
    rentabilidadPorcentaje: venta > 0 ? (rentabilidad / venta) * 100 : 0,
    caja,
    disponibleReal,
    situacion,
  };
}
