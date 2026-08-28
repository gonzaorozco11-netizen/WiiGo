"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { construirLineas } from "@/app/(app)/liquidaciones/actions";

// 2 decimales, no pesos enteros — mismo criterio que Liquidaciones y
// Resumen de ventas, para que los totales de acá coincidan con esos
// módulos en vez de desviarse por redondeo.
function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

function normalizarNombre(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export type ItemMonto = { nombre: string; fuente: string; monto: number };
export type SubItemImpositivo = { nombre: string; devengado: number; pagado: number };

export type ResultadoMes = {
  periodo: string;
  ingresos: ItemMonto[];
  totalIngresos: number;
  cmv: number;
  costosContables: SubItemImpositivo[];
  totalCostosContablesDevengado: number;
  totalCostosContablesPagado: number;
  totalCostos: number;
  gastos: ItemMonto[];
  totalGastos: number;
  resultado: number;
};

function rangoDelPeriodo(periodo: string) {
  const [anio, mes] = periodo.split("-").map(Number);
  const desde = `${periodo}-01`;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = `${periodo}-${String(ultimoDia).padStart(2, "0")}`;
  return { desde, hasta };
}

// Junta en un solo número lo que hoy vive repartido en Resumen de ventas
// (marca propia), Liquidaciones (royalty de consignación — reutiliza el
// mismo motor de cálculo que ya usan las rendiciones reales, para que no
// haya dos lugares calculando el royalty distinto), Gastos e Ingresos
// (cargos a marca, otros ingresos) y Gastos (fijos/variables). El IVA de
// la comisión, Imp. Créditos, Imp. Débitos y SIRCREB se muestran como
// "Costos contables" con dos columnas: Devengado (lo que corresponde
// según las ventas del período) y Pagado (lo que realmente se cargó en
// Gastos, categoría "Impuestos") — pueden no coincidir, y esa diferencia
// es justamente lo que queda pendiente de pagar.
export async function calcularResultadoMes(periodo: string): Promise<ResultadoMes> {
  const supabase = getSupabaseServerClient();
  const { desde, hasta } = rangoDelPeriodo(periodo);

  // ===== 1) Ventas marca propia + CMV =====
  const { data: ventasPeriodo } = await supabase
    .from("ventas")
    .select("id_venta")
    .eq("estado", "PAGADA")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  const idsVenta = (ventasPeriodo ?? []).map((v) => v.id_venta as string);

  let ventaPropia = 0;
  let cmv = 0;
  if (idsVenta.length > 0) {
    const { data: detalle } = await supabase.from("detalle_ventas").select("id_variante, subtotal, cantidad").in("id_venta", idsVenta);
    const idsVariante = [...new Set((detalle ?? []).map((d) => d.id_variante as string))];
    const { data: variantes } = await supabase
      .from("variantes_producto")
      .select("id_variante, id_producto")
      .in("id_variante", idsVariante.length > 0 ? idsVariante : ["00000000-0000-0000-0000-000000000000"]);
    const productoPorVariante = new Map((variantes ?? []).map((v) => [v.id_variante as string, v.id_producto as string]));
    const idsProducto = [...new Set([...productoPorVariante.values()])];
    const { data: productos } = await supabase
      .from("productos")
      .select("id_producto, costo_informado, id_marca")
      .in("id_producto", idsProducto.length > 0 ? idsProducto : ["00000000-0000-0000-0000-000000000000"]);
    const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto as string, p]));
    const idsMarca = [...new Set((productos ?? []).map((p) => p.id_marca as string).filter(Boolean))];
    const { data: marcasProd } = await supabase
      .from("marcas")
      .select("id_marca, tipo_comercializacion")
      .in("id_marca", idsMarca.length > 0 ? idsMarca : ["00000000-0000-0000-0000-000000000000"]);
    const tipoPorMarca = new Map((marcasProd ?? []).map((m) => [m.id_marca as string, m.tipo_comercializacion as string]));

    for (const d of detalle ?? []) {
      const idProducto = productoPorVariante.get(d.id_variante as string);
      const producto = idProducto ? productoPorId.get(idProducto) : undefined;
      const tipo = producto?.id_marca ? tipoPorMarca.get(producto.id_marca as string) ?? "PROPIA" : "PROPIA";
      if (tipo !== "PROPIA") continue;
      ventaPropia += (d.subtotal as number) ?? 0;
      cmv += ((producto?.costo_informado as number) ?? 0) * ((d.cantidad as number) ?? 0);
    }
  }
  ventaPropia = redondear2(ventaPropia);
  cmv = redondear2(cmv);

  // ===== 2) Royalty de consignación + costos contables devengado =====
  // Reutiliza construirLineas (el motor real de Liquidaciones) por cada
  // marca en consignación, sin filtrar por si ya se liquidó — acá interesa
  // lo devengado en el mes, esté o no todavía rendido a la marca.
  const { data: marcasConsignacion } = await supabase.from("marcas").select("id_marca, nombre").eq("tipo_comercializacion", "CONSIGNACION");
  let royaltyTotal = 0;
  let ivaComisionTotal = 0;
  let impCreditosTotal = 0;
  let impDebitosTotal = 0;
  let sircrebTotal = 0;

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
    royaltyTotal += resumen.comisionWiigo;
    ivaComisionTotal += resumen.ivaComision;
    impCreditosTotal += resumen.impCreditos;
    impDebitosTotal += resumen.impDebitos;
    sircrebTotal += resumen.sircreb;
  }

  // ===== 3) Cargos a marcas (canon, publicidad, etc.) =====
  const { data: cargosMovs } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("importe, neto, tipo_cargo, id_categoria")
    .in("tipo_cargo", ["GASTO_FIJO_MENSUAL", "CARGO_RECURRENTE", "OTRO_CARGO"])
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  const idsCatCargo = [...new Set((cargosMovs ?? []).map((c) => c.id_categoria as string).filter(Boolean))];
  const { data: categoriasCargo } = await supabase
    .from("categorias_cargo_marca")
    .select("id_categoria, nombre")
    .in("id_categoria", idsCatCargo.length > 0 ? idsCatCargo : ["00000000-0000-0000-0000-000000000000"]);
  const nombreCategoriaCargo = new Map((categoriasCargo ?? []).map((c) => [c.id_categoria as string, c.nombre as string]));
  const cargosPorCategoria = new Map<string, number>();
  for (const m of cargosMovs ?? []) {
    // El "Gasto fijo mensual" viejo (de Situación de marca, sin categoría
    // propia) se muestra como "Canon mensual" para no perderlo del resumen.
    const nombre = m.id_categoria ? nombreCategoriaCargo.get(m.id_categoria as string) ?? "Otro cargo" : "Canon mensual";
    const monto = (m.neto as number | null) ?? (m.importe as number) ?? 0;
    cargosPorCategoria.set(nombre, (cargosPorCategoria.get(nombre) ?? 0) + monto);
  }

  // ===== 4) Otros ingresos =====
  const { data: ingresosMovs } = await supabase
    .from("ingresos")
    .select("monto, neto, id_categoria")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  const idsCatIngreso = [...new Set((ingresosMovs ?? []).map((i) => i.id_categoria as string).filter(Boolean))];
  const { data: categoriasIngreso } = await supabase
    .from("categorias_ingreso")
    .select("id_categoria, nombre")
    .in("id_categoria", idsCatIngreso.length > 0 ? idsCatIngreso : ["00000000-0000-0000-0000-000000000000"]);
  const nombreCategoriaIngreso = new Map((categoriasIngreso ?? []).map((c) => [c.id_categoria as string, c.nombre as string]));
  const ingresosPorCategoria = new Map<string, number>();
  for (const i of ingresosMovs ?? []) {
    const nombre = nombreCategoriaIngreso.get(i.id_categoria as string) ?? "Otro ingreso";
    const monto = (i.neto as number | null) ?? (i.monto as number) ?? 0;
    ingresosPorCategoria.set(nombre, (ingresosPorCategoria.get(nombre) ?? 0) + monto);
  }

  // ===== 5) Gastos (fijos/variables) — la categoría "Impuestos" no cuenta
  // acá, se muestra aparte como el "Pagado" de Costos contables =====
  const { data: categoriasGasto } = await supabase.from("categorias_gasto").select("id_categoria, nombre");
  const idCategoriaImpuestos = (categoriasGasto ?? []).find((c) => normalizarNombre(c.nombre as string) === "impuestos")?.id_categoria as
    | string
    | undefined;

  const { data: gastosPeriodo } = await supabase
    .from("gastos")
    .select("monto, tipo, id_categoria, id_subcategoria")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);

  let gastosFijos = 0;
  let gastosVariables = 0;
  const pagadoPorSub = new Map<string, number>();
  for (const g of gastosPeriodo ?? []) {
    if (idCategoriaImpuestos && g.id_categoria === idCategoriaImpuestos) {
      const clave = (g.id_subcategoria as string | null) ?? "__sin_subcategoria__";
      pagadoPorSub.set(clave, (pagadoPorSub.get(clave) ?? 0) + ((g.monto as number) ?? 0));
      continue;
    }
    if (g.tipo === "FIJO") gastosFijos += (g.monto as number) ?? 0;
    else gastosVariables += (g.monto as number) ?? 0;
  }

  const { data: subcategoriasGasto } = await supabase.from("subcategorias_gasto").select("id_subcategoria, nombre");
  const nombreSubPorId = new Map((subcategoriasGasto ?? []).map((s) => [s.id_subcategoria as string, s.nombre as string]));

  function pagadoDeSubcategoria(clave: string) {
    let total = 0;
    for (const [idSub, monto] of pagadoPorSub) {
      const nombre = idSub === "__sin_subcategoria__" ? "" : nombreSubPorId.get(idSub) ?? "";
      if (normalizarNombre(nombre) === clave) total += monto;
    }
    return redondear2(total);
  }

  const costosContables: SubItemImpositivo[] = [
    { nombre: "Impuesto a los Créditos", devengado: redondear2(impCreditosTotal), pagado: pagadoDeSubcategoria(normalizarNombre("Impuesto a los Créditos")) },
    { nombre: "Impuesto a los Débitos", devengado: redondear2(impDebitosTotal), pagado: pagadoDeSubcategoria(normalizarNombre("Impuesto a los Débitos")) },
    { nombre: "SIRCREB (retenido)", devengado: redondear2(sircrebTotal), pagado: pagadoDeSubcategoria(normalizarNombre("SIRCREB")) },
    { nombre: "IVA sobre royalty", devengado: redondear2(ivaComisionTotal), pagado: pagadoDeSubcategoria(normalizarNombre("IVA sobre royalty")) },
  ];

  const clavesConocidas = new Set(["impuesto a los creditos", "impuesto a los debitos", "sircreb", "iva sobre royalty"]);
  let otrosPagados = 0;
  for (const [idSub, monto] of pagadoPorSub) {
    const nombre = idSub === "__sin_subcategoria__" ? "" : nombreSubPorId.get(idSub) ?? "";
    if (!clavesConocidas.has(normalizarNombre(nombre))) otrosPagados += monto;
  }
  if (otrosPagados > 0) costosContables.push({ nombre: "Otros impuestos", devengado: 0, pagado: redondear2(otrosPagados) });

  const totalCostosContablesDevengado = redondear2(costosContables.reduce((acc, c) => acc + c.devengado, 0));
  const totalCostosContablesPagado = redondear2(costosContables.reduce((acc, c) => acc + c.pagado, 0));
  const totalCostos = redondear2(cmv + totalCostosContablesDevengado);

  const ingresos: ItemMonto[] = [
    { nombre: "Ventas marca propia", fuente: "Resumen de ventas", monto: ventaPropia },
    { nombre: "Royalty de marcas en consignación", fuente: "Liquidaciones", monto: redondear2(royaltyTotal) },
    ...[...cargosPorCategoria.entries()].map(([nombre, monto]) => ({ nombre, fuente: "Cargo a marca", monto: redondear2(monto) })),
    ...[...ingresosPorCategoria.entries()].map(([nombre, monto]) => ({ nombre, fuente: "Otro ingreso", monto: redondear2(monto) })),
  ].filter((i) => i.monto !== 0);
  const totalIngresos = redondear2(ingresos.reduce((acc, i) => acc + i.monto, 0));

  const gastos: ItemMonto[] = [
    { nombre: "Gastos fijos", fuente: "Gastos", monto: redondear2(gastosFijos) },
    { nombre: "Gastos variables", fuente: "Gastos", monto: redondear2(gastosVariables) },
  ].filter((i) => i.monto !== 0);
  const totalGastos = redondear2(gastos.reduce((acc, i) => acc + i.monto, 0));

  const resultado = redondear2(totalIngresos - totalCostos - totalGastos);

  return {
    periodo,
    ingresos,
    totalIngresos,
    cmv,
    costosContables,
    totalCostosContablesDevengado,
    totalCostosContablesPagado,
    totalCostos,
    gastos,
    totalGastos,
    resultado,
  };
}
