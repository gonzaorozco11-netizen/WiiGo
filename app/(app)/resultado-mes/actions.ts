"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { construirLineas } from "@/app/(app)/liquidaciones/actions";
import { calcularRentabilidad } from "@/app/(app)/rentabilidad/actions";
import { calcularIvaAPagar } from "@/app/(app)/contabilidad/actions";
import { revalidatePath } from "next/cache";

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

async function configuracionNumero(supabase: ReturnType<typeof getSupabaseServerClient>, parametro: string, porDefecto: number) {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", parametro).maybeSingle();
  const valor = Number(data?.valor);
  return Number.isFinite(valor) ? valor : porDefecto;
}

export type ItemMonto = { nombre: string; fuente: string; monto: number };
export type ReservaLinea = { idReserva: string | null; nombre: string; porcentaje: number; montoSupuesto: number; montoReal: number };

// Todo lo que se calcula en vivo mientras el mes está en curso. Al cerrar el
// mes, este objeto entero se guarda tal cual (columna "snapshot") — así un
// mes cerrado queda 100% fijo, no solo IIBB/Ganancias/Reservas.
type TableroSupuesto = {
  ventasBrutas: ItemMonto[];
  totalVentasBrutas: number;
  ivaDebitoFiscal: number;
  ventasNetas: number;
  cmv: number;
  contribucionMarginal: number;
  gastosFijos: ItemMonto[];
  totalGastosFijos: number;
  gastosVariables: ItemMonto[];
  totalGastosVariables: number;
  impuestoCreditos: number;
  impuestoDebitos: number;
  totalRetenciones: number;
  comisionMp: number;
  totalGastosBancarios: number;
  resultadoOperativo: number;
  ingresosBrutosIibb: number;
  sircrebRecuperable: number;
  iibbSupuesto: number;
  pctGanancias: number;
  provisionGananciasSupuesto: number;
  gananciaNetaSupuesto: number;
  reservas: { idReserva: string | null; nombre: string; porcentaje: number; montoSupuesto: number }[];
  totalReservasSupuesto: number;
  utilidadDistribuibleSupuesto: number;
};

export type TableroResultados = TableroSupuesto & {
  periodo: string;
  estado: "ABIERTO" | "CERRADO";
  fechaCierre: string | null;
  iibbReal: number | null;
  provisionGananciasReal: number | null;
  gananciaNetaReal: number | null;
  reservas: ReservaLinea[];
  totalReservasReal: number | null;
  utilidadDistribuibleReal: number | null;
};

// Calcula todo el Tablero en vivo a partir de los datos actuales — nunca
// lee ni escribe cierres_resultado_mes. Se usa mientras el mes está en
// curso, y también para armar el snapshot en el momento de cerrar.
async function calcularTableroEnVivo(periodo: string): Promise<TableroSupuesto> {
  const supabase = getSupabaseServerClient();
  const { desde, hasta } = rangoDelPeriodo(periodo);

  // ===== Marca propia: reutiliza el motor de Rentabilidad, marca por marca =====
  const { data: marcasPropia } = await supabase.from("marcas").select("id_marca, nombre").eq("tipo_comercializacion", "PROPIA");
  let ventaBrutaPropia = 0;
  let cmv = 0;
  let impuestoCreditosPropia = 0;
  let comisionMpPropia = 0;
  for (const marca of marcasPropia ?? []) {
    const { lineas, resumen } = await calcularRentabilidad(marca.id_marca as string, desde, hasta);
    ventaBrutaPropia += lineas.reduce((acc, l) => acc + l.ventaBruta, 0);
    cmv += resumen.cmv;
    impuestoCreditosPropia += resumen.impuestoCreditos;
    comisionMpPropia += resumen.comisionMp;
  }
  ventaBrutaPropia = redondear2(ventaBrutaPropia);
  cmv = redondear2(cmv);

  // ===== Consignación: reutiliza el motor de Liquidaciones, marca por marca =====
  const { data: marcasConsignacion } = await supabase.from("marcas").select("id_marca, nombre").eq("tipo_comercializacion", "CONSIGNACION");
  let royaltyNeto = 0;
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
    royaltyNeto += resumen.comisionWiigo;
    ivaRoyalty += resumen.ivaComision;
  }
  royaltyNeto = redondear2(royaltyNeto);
  ivaRoyalty = redondear2(ivaRoyalty);

  // ===== Cargos a marca (canon, publicidad, etc.) — se muestra bruto (con IVA si tiene) =====
  const { data: cargosMovs } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("importe, tipo_cargo, id_categoria")
    .in("tipo_cargo", ["GASTO_FIJO_MENSUAL", "CARGO_RECURRENTE", "OTRO_CARGO"])
    .eq("anulado", false)
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
    const nombre = m.id_categoria ? nombreCategoriaCargo.get(m.id_categoria as string) ?? "Otro cargo" : "Canon mensual";
    cargosPorCategoria.set(nombre, (cargosPorCategoria.get(nombre) ?? 0) + ((m.importe as number) ?? 0));
  }

  // ===== Otros ingresos — bruto (con IVA si tiene) =====
  const { data: ingresosMovs } = await supabase
    .from("ingresos")
    .select("monto, id_categoria")
    .eq("anulado", false)
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
    ingresosPorCategoria.set(nombre, (ingresosPorCategoria.get(nombre) ?? 0) + ((i.monto as number) ?? 0));
  }

  const ventasBrutas: ItemMonto[] = [
    { nombre: "Ventas marca propia (con IVA)", fuente: "Rentabilidad", monto: ventaBrutaPropia },
    { nombre: "Royalty de marcas en consignación", fuente: "Liquidaciones", monto: redondear2(royaltyNeto + ivaRoyalty) },
    ...[...cargosPorCategoria.entries()].map(([nombre, monto]) => ({ nombre, fuente: "Cargo a marca", monto: redondear2(monto) })),
    ...[...ingresosPorCategoria.entries()].map(([nombre, monto]) => ({ nombre, fuente: "Otro ingreso", monto: redondear2(monto) })),
  ]
    .filter((i) => i.monto !== 0)
    .sort((a, b) => b.monto - a.monto);
  const totalVentasBrutas = redondear2(ventasBrutas.reduce((acc, i) => acc + i.monto, 0));

  // ===== IVA Débito Fiscal: mismo motor que la pantalla "IVA a pagar" =====
  const { totalDebito: ivaDebitoFiscal } = await calcularIvaAPagar(periodo);
  const ventasNetas = redondear2(totalVentasBrutas - ivaDebitoFiscal);
  const contribucionMarginal = redondear2(ventasNetas - cmv);

  // ===== Gastos fijos / variables por subcategoría (la categoría marcada
  // como "es_impuestos" no entra acá — esos impuestos se calculan aparte,
  // por fórmula, para no contarlos dos veces si además los cargás como
  // gasto) =====
  const { data: categoriaImpuestos } = await supabase
    .from("categorias_gasto")
    .select("id_categoria")
    .eq("es_impuestos", true)
    .maybeSingle();
  const idCategoriaImpuestos = categoriaImpuestos?.id_categoria as string | undefined;

  const { data: gastosPeriodo } = await supabase
    .from("gastos")
    .select("monto, tipo, id_categoria, id_subcategoria")
    .eq("anulado", false)
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  const { data: subcategoriasGasto } = await supabase.from("subcategorias_gasto").select("id_subcategoria, nombre");
  const nombreSubPorId = new Map((subcategoriasGasto ?? []).map((s) => [s.id_subcategoria as string, s.nombre as string]));

  const fijosPorSub = new Map<string, number>();
  const variablesPorSub = new Map<string, number>();
  for (const g of gastosPeriodo ?? []) {
    if (idCategoriaImpuestos && g.id_categoria === idCategoriaImpuestos) continue;
    const nombre = g.id_subcategoria ? nombreSubPorId.get(g.id_subcategoria as string) ?? "Sin subcategoría" : "Sin subcategoría";
    const mapa = g.tipo === "FIJO" ? fijosPorSub : variablesPorSub;
    mapa.set(nombre, (mapa.get(nombre) ?? 0) + ((g.monto as number) ?? 0));
  }
  const gastosFijos: ItemMonto[] = [...fijosPorSub.entries()]
    .map(([nombre, monto]) => ({ nombre, fuente: "Gastos", monto: redondear2(monto) }))
    .sort((a, b) => b.monto - a.monto);
  const totalGastosFijos = redondear2(gastosFijos.reduce((acc, i) => acc + i.monto, 0));
  const gastosVariables: ItemMonto[] = [...variablesPorSub.entries()]
    .map(([nombre, monto]) => ({ nombre, fuente: "Gastos", monto: redondear2(monto) }))
    .sort((a, b) => b.monto - a.monto);
  const totalGastosVariables = redondear2(gastosVariables.reduce((acc, i) => acc + i.monto, 0));

  // ===== Retenciones: Impuesto a los Créditos (solo marca propia — el de
  // consignación se lo trasladás a la marca) + Impuesto a los Débitos
  // (propia + consignación, siempre lo absorbés vos) =====
  const impDebitosPorcentaje = await configuracionNumero(supabase, "IMP_DEBITOS_PORCENTAJE", 0);
  const { data: ventasNoEfectivo } = await supabase
    .from("ventas")
    .select("total")
    .eq("estado", "PAGADA")
    .neq("medio_pago", "EFECTIVO")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  const ventaBrutaNoEfectivo = (ventasNoEfectivo ?? []).reduce((acc, v) => acc + ((v.total as number) ?? 0), 0);
  const impuestoCreditos = redondear2(impuestoCreditosPropia);
  const impuestoDebitos = redondear2(ventaBrutaNoEfectivo * (impDebitosPorcentaje / 100));
  const totalRetenciones = redondear2(impuestoCreditos + impuestoDebitos);

  // ===== Gastos bancarios: Comisión Mercado Pago (solo marca propia) =====
  const comisionMp = redondear2(comisionMpPropia);
  const totalGastosBancarios = comisionMp;

  const resultadoOperativo = redondear2(
    contribucionMarginal - totalGastosFijos - totalGastosVariables - totalRetenciones - totalGastosBancarios
  );

  // ===== IIBB: sobre TODAS las ventas e ingresos facturados (= Ventas
  // Netas), neto de todo el SIRCREB retenido (propio + consignación) =====
  const iibbPorcentaje = await configuracionNumero(supabase, "IIBB_PORCENTAJE", 0);
  const sircrebPorcentaje = await configuracionNumero(supabase, "SIRCREB_PORCENTAJE", 0);
  const { data: ventasMp } = await supabase
    .from("ventas")
    .select("total")
    .eq("estado", "PAGADA")
    .eq("medio_pago", "MERCADO_PAGO")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  const totalMp = (ventasMp ?? []).reduce((acc, v) => acc + ((v.total as number) ?? 0), 0);

  const ingresosBrutosIibb = redondear2(ventasNetas * (iibbPorcentaje / 100));
  const sircrebRecuperable = redondear2(totalMp * (sircrebPorcentaje / 100));
  const iibbSupuesto = redondear2(ingresosBrutosIibb - sircrebRecuperable);

  // ===== Provisión Impuesto a las Ganancias (supuesto, calculado en vivo) =====
  const pctGanancias = await configuracionNumero(supabase, "IMPUESTO_GANANCIAS_PORCENTAJE_DEFAULT", 35);
  const baseGanancias = redondear2(resultadoOperativo - iibbSupuesto);
  const provisionGananciasSupuesto = redondear2(baseGanancias * (pctGanancias / 100));
  const gananciaNetaSupuesto = redondear2(baseGanancias - provisionGananciasSupuesto);

  // ===== Reservas (supuesto, calculado en vivo sobre la Ganancia Neta) =====
  const { data: reservasConfig } = await supabase
    .from("reservas_configuradas")
    .select("id_reserva, nombre, porcentaje")
    .eq("estado", "ACTIVA")
    .order("orden");
  const reservas = (reservasConfig ?? []).map((r) => ({
    idReserva: r.id_reserva as string,
    nombre: r.nombre as string,
    porcentaje: r.porcentaje as number,
    montoSupuesto: redondear2(gananciaNetaSupuesto * ((r.porcentaje as number) / 100)),
  }));
  const totalReservasSupuesto = redondear2(reservas.reduce((acc, r) => acc + r.montoSupuesto, 0));

  return {
    ventasBrutas,
    totalVentasBrutas,
    ivaDebitoFiscal: redondear2(ivaDebitoFiscal),
    ventasNetas,
    cmv,
    contribucionMarginal,
    gastosFijos,
    totalGastosFijos,
    gastosVariables,
    totalGastosVariables,
    impuestoCreditos,
    impuestoDebitos,
    totalRetenciones,
    comisionMp,
    totalGastosBancarios,
    resultadoOperativo,
    ingresosBrutosIibb,
    sircrebRecuperable,
    iibbSupuesto,
    pctGanancias,
    provisionGananciasSupuesto,
    gananciaNetaSupuesto,
    reservas,
    totalReservasSupuesto,
    utilidadDistribuibleSupuesto: redondear2(gananciaNetaSupuesto - totalReservasSupuesto),
  };
}

// Trae el Tablero del período. Si el mes está ABIERTO, todo se calcula en
// vivo. Si está CERRADO, se lee tal cual quedó congelado al cerrar (columna
// "snapshot") — nada de eso se recalcula, ni siquiera si después cambiás un
// gasto viejo. Lo único que puede cambiar en un mes cerrado son los valores
// reales (IIBB/Ganancias/Reservas), y solo reabriéndolo a propósito.
export async function calcularTablero(periodo: string): Promise<TableroResultados> {
  const supabase = getSupabaseServerClient();
  const { data: cierre } = await supabase.from("cierres_resultado_mes").select("*").eq("periodo", periodo).maybeSingle();
  const cerrado = cierre?.estado === "CERRADO";

  if (!cerrado) {
    const supuesto = await calcularTableroEnVivo(periodo);
    return {
      ...supuesto,
      periodo,
      estado: "ABIERTO",
      fechaCierre: null,
      iibbReal: null,
      provisionGananciasReal: null,
      gananciaNetaReal: null,
      reservas: supuesto.reservas.map((r) => ({ ...r, montoReal: r.montoSupuesto })),
      totalReservasReal: null,
      utilidadDistribuibleReal: null,
    };
  }

  const snap = cierre!.snapshot as TableroSupuesto;
  const iibbReal = cierre!.iibb_real as number;
  const provisionGananciasReal = cierre!.provision_ganancias_real as number;
  const reservasReal = (cierre!.reservas_real as { nombre: string; monto: number }[] | null) ?? [];

  const gananciaNetaReal = redondear2(snap.resultadoOperativo - iibbReal - provisionGananciasReal);
  const reservas: ReservaLinea[] = snap.reservas.map((r) => ({
    idReserva: null,
    nombre: r.nombre,
    porcentaje: r.porcentaje,
    montoSupuesto: r.montoSupuesto,
    montoReal: reservasReal.find((x) => x.nombre === r.nombre)?.monto ?? r.montoSupuesto,
  }));
  const totalReservasReal = redondear2(reservas.reduce((acc, r) => acc + r.montoReal, 0));
  const utilidadDistribuibleReal = redondear2(gananciaNetaReal - totalReservasReal);

  return {
    ...snap,
    reservas,
    periodo,
    estado: "CERRADO",
    fechaCierre: cierre!.fecha_cierre as string,
    iibbReal,
    provisionGananciasReal,
    gananciaNetaReal,
    totalReservasReal,
    utilidadDistribuibleReal,
  };
}

// Congela el Tablero completo tal como está calculado en este momento y
// guarda los valores reales que cargaste. A partir de acá el período queda
// CERRADO y nada de lo congelado se vuelve a tocar, salvo que reabras.
export async function cerrarMes(
  periodo: string,
  pctGanancias: number,
  iibbReal: number,
  provisionGananciasReal: number,
  reservasReal: { nombre: string; monto: number }[]
) {
  const supabase = getSupabaseServerClient();
  const { data: cierreExistente } = await supabase.from("cierres_resultado_mes").select("estado").eq("periodo", periodo).maybeSingle();
  if (cierreExistente?.estado === "CERRADO") return { error: "Este mes ya está cerrado. Usá 'Reabrir para corregir'." };

  const supuesto = await calcularTableroEnVivo(periodo);

  // El % que llegó del formulario puede diferir del default de
  // configuración si se ajustó justo antes de cerrar — se recalcula la
  // provisión y la ganancia neta supuesta con ese % antes de congelar.
  const baseGanancias = redondear2(supuesto.resultadoOperativo - supuesto.iibbSupuesto);
  const provisionGananciasSupuesto = redondear2(baseGanancias * (pctGanancias / 100));
  const gananciaNetaSupuesto = redondear2(baseGanancias - provisionGananciasSupuesto);
  const reservas = supuesto.reservas.map((r) => ({
    ...r,
    montoSupuesto: redondear2(gananciaNetaSupuesto * (r.porcentaje / 100)),
  }));
  const snapshot: TableroSupuesto = {
    ...supuesto,
    pctGanancias,
    provisionGananciasSupuesto,
    gananciaNetaSupuesto,
    reservas,
    totalReservasSupuesto: redondear2(reservas.reduce((acc, r) => acc + r.montoSupuesto, 0)),
    utilidadDistribuibleSupuesto: redondear2(gananciaNetaSupuesto - reservas.reduce((acc, r) => acc + r.montoSupuesto, 0)),
  };

  const { error } = await supabase.from("cierres_resultado_mes").upsert({
    periodo,
    estado: "CERRADO",
    fecha_cierre: new Date().toISOString(),
    snapshot,
    iibb_real: iibbReal,
    provision_ganancias_real: provisionGananciasReal,
    reservas_real: reservasReal,
    actualizado_en: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  revalidatePath("/resultado-mes");
  return { error: null };
}

// Corrige los valores reales de un mes ya cerrado — el snapshot congelado
// no se toca, solo se actualiza lo real.
export async function actualizarValoresReales(
  periodo: string,
  iibbReal: number,
  provisionGananciasReal: number,
  reservasReal: { nombre: string; monto: number }[]
) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("cierres_resultado_mes")
    .update({
      iibb_real: iibbReal,
      provision_ganancias_real: provisionGananciasReal,
      reservas_real: reservasReal,
      actualizado_en: new Date().toISOString(),
    })
    .eq("periodo", periodo)
    .eq("estado", "CERRADO");
  if (error) return { error: error.message };
  revalidatePath("/resultado-mes");
  return { error: null };
}

export async function listarReservasConfiguradas() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("reservas_configuradas")
    .select("*")
    .eq("estado", "ACTIVA")
    .order("orden");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function agregarReservaConfigurada(nombre: string, porcentaje: number) {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase.from("reservas_configuradas").select("orden").order("orden", { ascending: false }).limit(1).maybeSingle();
  const orden = ((data?.orden as number) ?? 0) + 1;
  const { error } = await supabase.from("reservas_configuradas").insert({ nombre, porcentaje, orden, estado: "ACTIVA" });
  if (error) return { error: error.message };
  revalidatePath("/resultado-mes");
  return { error: null };
}

export async function actualizarReservaConfigurada(idReserva: string, nombre: string, porcentaje: number) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("reservas_configuradas").update({ nombre, porcentaje }).eq("id_reserva", idReserva);
  if (error) return { error: error.message };
  revalidatePath("/resultado-mes");
  return { error: null };
}

export async function eliminarReservaConfigurada(idReserva: string) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("reservas_configuradas").update({ estado: "INACTIVA" }).eq("id_reserva", idReserva);
  if (error) return { error: error.message };
  revalidatePath("/resultado-mes");
  return { error: null };
}
