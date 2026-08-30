"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { construirLineas } from "@/app/(app)/liquidaciones/actions";
import { calcularRentabilidad } from "@/app/(app)/rentabilidad/actions";

function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

function rangoDelPeriodo(periodo: string) {
  const [anio, mes] = periodo.split("-").map(Number);
  const desde = `${periodo}-01`;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = `${periodo}-${String(ultimoDia).padStart(2, "0")}`;
  return { desde, hasta };
}

export type ItemIva = { nombre: string; fuente: string; monto: number };

export type IvaAPagar = {
  periodo: string;
  debito: ItemIva[];
  totalDebito: number;
  credito: ItemIva[];
  totalCredito: number;
  ivaAPagar: number;
};

// IVA Débito (lo que WiiGo cobra en sus ventas/cargos) menos IVA Crédito
// (lo que WiiGo paga en sus compras/gastos) = lo que hay que ingresarle a
// AFIP ese período. Reutiliza los mismos motores de cálculo que ya usan
// Rentabilidad y Liquidaciones — nunca se recalcula el IVA con una lógica
// distinta a la que ya se usa en esos módulos, para que no haya dos
// números diferentes para lo mismo.
export async function calcularIvaAPagar(periodo: string): Promise<IvaAPagar> {
  const supabase = getSupabaseServerClient();
  const { desde, hasta } = rangoDelPeriodo(periodo);

  // ===== Débito: ventas marca propia =====
  const { data: marcasPropia } = await supabase.from("marcas").select("id_marca, nombre").eq("tipo_comercializacion", "PROPIA");
  let ivaVentaPropia = 0;
  for (const marca of marcasPropia ?? []) {
    const { resumen } = await calcularRentabilidad(marca.id_marca as string, desde, hasta);
    ivaVentaPropia += resumen.iva;
  }

  // ===== Débito: royalty de consignación (mismo motor que Liquidaciones) =====
  const { data: marcasConsignacion } = await supabase.from("marcas").select("id_marca, nombre").eq("tipo_comercializacion", "CONSIGNACION");
  let ivaRoyalty = 0;
  for (const marca of marcasConsignacion ?? []) {
    const { data: detalleMarca } = await supabase.from("detalle_ventas").select("id_venta").eq("id_marca", marca.id_marca);
    const idsVentaMarca = [...new Set((detalleMarca ?? []).map((d) => d.id_venta as string))];
    if (idsVentaMarca.length === 0) continue;
    const { data: ventasMarca } = await supabase
      .from("ventas")
      .select("id_venta, numero, fecha, medio_pago, id_pago")
      .in("id_venta", idsVentaMarca)
      .eq("estado", "PAGADA")
      .gte("fecha", `${desde}T00:00:00`)
      .lte("fecha", `${hasta}T23:59:59`);
    if (!ventasMarca || ventasMarca.length === 0) continue;
    const { resumen } = await construirLineas(supabase, marca.id_marca as string, ventasMarca);
    ivaRoyalty += resumen.ivaComision;
  }

  // ===== Débito: cargos a marca (canon, publicidad, etc.) =====
  const { data: cargosMovs } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("iva")
    .in("tipo_cargo", ["GASTO_FIJO_MENSUAL", "CARGO_RECURRENTE", "OTRO_CARGO"])
    .eq("anulado", false)
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  const ivaCargosMarca = (cargosMovs ?? []).reduce((acc, c) => acc + ((c.iva as number | null) ?? 0), 0);

  // ===== Débito: otros ingresos =====
  const { data: ingresosMovs } = await supabase
    .from("ingresos")
    .select("iva")
    .eq("anulado", false)
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  const ivaOtrosIngresos = (ingresosMovs ?? []).reduce((acc, i) => acc + ((i.iva as number | null) ?? 0), 0);

  // ===== Crédito: gastos =====
  const { data: gastosPeriodo } = await supabase
    .from("gastos")
    .select("iva")
    .eq("anulado", false)
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  const ivaGastos = (gastosPeriodo ?? []).reduce((acc, g) => acc + ((g.iva as number | null) ?? 0), 0);

  // ===== Crédito: compras a proveedores =====
  const { data: facturasPeriodo } = await supabase
    .from("facturas_compra_proveedor")
    .select("iva")
    .gte("fecha_emision", desde)
    .lte("fecha_emision", hasta);
  const ivaProveedores = (facturasPeriodo ?? []).reduce((acc, f) => acc + ((f.iva as number | null) ?? 0), 0);

  const debito: ItemIva[] = [
    { nombre: "Ventas marca propia", fuente: "Rentabilidad", monto: redondear2(ivaVentaPropia) },
    { nombre: "Royalty de marcas en consignación", fuente: "Liquidaciones", monto: redondear2(ivaRoyalty) },
    { nombre: "Cargos a marcas (canon, publicidad, etc.)", fuente: "Gastos e Ingresos", monto: redondear2(ivaCargosMarca) },
    { nombre: "Otros ingresos", fuente: "Gastos e Ingresos", monto: redondear2(ivaOtrosIngresos) },
  ].filter((i) => i.monto !== 0);
  const totalDebito = redondear2(debito.reduce((acc, i) => acc + i.monto, 0));

  const credito: ItemIva[] = [
    { nombre: "Gastos con factura", fuente: "Gastos", monto: redondear2(ivaGastos) },
    { nombre: "Compras a proveedores", fuente: "Proveedores", monto: redondear2(ivaProveedores) },
  ].filter((i) => i.monto !== 0);
  const totalCredito = redondear2(credito.reduce((acc, i) => acc + i.monto, 0));

  const ivaAPagar = redondear2(totalDebito - totalCredito);

  return { periodo, debito, totalDebito, credito, totalCredito, ivaAPagar };
}
