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

export type TableroResultados = {
  periodo: string;
  estado: "ABIERTO" | "CERRADO";
  fechaCierre: string | null;

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
  iibbReal: number | null;

  pctGanancias: number;
  provisionGananciasSupuesto: number;
  provisionGananciasReal: number | null;

  gananciaNetaSupuesto: number;
  gananciaNetaReal: number | null;

  reservas: ReservaLinea[];
  totalReservasSupuesto: number;
  totalReservasReal: number | null;

  utilidadDistribuibleSupuesto: number;
  utilidadDistribuibleReal: number | null;
};

// Arma el Tablero de Resultados completo del período. IIBB, Provisión de
// Ganancias y Reservas son siempre "supuesto" (calculado en vivo) — si el
// mes ya está cerrado (fila en cierres_resultado_mes con estado CERRADO),
// además trae los valores reales cargados y el supuesto queda congelado tal
// como estaba al momento del cierre, en vez de recalcularse con datos que
// pudieron cambiar después.
export async function calcularTablero(periodo: string): Promise<TableroResultados> {
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

  // ===== Gastos fijos / variables por subcategoría (la categoría "Impuestos"
  // no entra acá — los impuestos del Tablero se calculan aparte, por fórmula,
  // para no contarlos dos veces si además los cargás como gasto) =====
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
  const iibbSupuestoCalculado = redondear2(ingresosBrutosIibb - sircrebRecuperable);

  // ===== Provisión Impuesto a las Ganancias (supuesto, calculado en vivo) =====
  const pctGananciasDefault = await configuracionNumero(supabase, "IMPUESTO_GANANCIAS_PORCENTAJE_DEFAULT", 35);
  const baseGananciasSupuesta = redondear2(resultadoOperativo - iibbSupuestoCalculado);
  const provisionGananciasSupuestaCalculada = redondear2(baseGananciasSupuesta * (pctGananciasDefault / 100));
  const gananciaNetaSupuestaCalculada = redondear2(baseGananciasSupuesta - provisionGananciasSupuestaCalculada);

  // ===== Reservas (supuesto, calculado en vivo sobre la Ganancia Neta) =====
  const { data: reservasConfig } = await supabase
    .from("reservas_configuradas")
    .select("id_reserva, nombre, porcentaje")
    .eq("estado", "ACTIVA")
    .order("orden");
  const reservasSupuestasCalculadas = (reservasConfig ?? []).map((r) => ({
    idReserva: r.id_reserva as string,
    nombre: r.nombre as string,
    porcentaje: r.porcentaje as number,
    montoSupuesto: redondear2(gananciaNetaSupuestaCalculada * ((r.porcentaje as number) / 100)),
  }));
  const totalReservasSupuestoCalculado = redondear2(reservasSupuestasCalculadas.reduce((acc, r) => acc + r.montoSupuesto, 0));

  // ===== ¿El mes ya está cerrado? =====
  const { data: cierre } = await supabase.from("cierres_resultado_mes").select("*").eq("periodo", periodo).maybeSingle();
  const cerrado = cierre?.estado === "CERRADO";

  const iibbSupuesto = cerrado ? (cierre!.iibb_supuesto as number) : iibbSupuestoCalculado;
  const pctGanancias = cerrado ? (cierre!.pct_ganancias as number) : pctGananciasDefault;
  const provisionGananciasSupuesto = cerrado ? (cierre!.provision_ganancias_supuesto as number) : provisionGananciasSupuestaCalculada;
  const gananciaNetaSupuesto = redondear2(baseGananciasSupuesta - provisionGananciasSupuesto);

  const reservasSupuestasGuardadas = cerrado
    ? ((cierre!.reservas_supuesto as { nombre: string; porcentaje: number; monto: number }[] | null) ?? [])
    : null;
  const reservasRealesGuardadas = cerrado
    ? ((cierre!.reservas_real as { nombre: string; monto: number }[] | null) ?? [])
    : null;

  const reservas: ReservaLinea[] = cerrado
    ? reservasSupuestasGuardadas!.map((r) => ({
        idReserva: null,
        nombre: r.nombre,
        porcentaje: r.porcentaje,
        montoSupuesto: r.monto,
        montoReal: reservasRealesGuardadas!.find((x) => x.nombre === r.nombre)?.monto ?? r.monto,
      }))
    : reservasSupuestasCalculadas.map((r) => ({ ...r, montoReal: r.montoSupuesto }));

  const totalReservasSupuesto = cerrado ? redondear2(reservas.reduce((acc, r) => acc + r.montoSupuesto, 0)) : totalReservasSupuestoCalculado;
  const totalReservasReal = cerrado ? redondear2(reservas.reduce((acc, r) => acc + r.montoReal, 0)) : null;

  const iibbReal = cerrado ? (cierre!.iibb_real as number) : null;
  const provisionGananciasReal = cerrado ? (cierre!.provision_ganancias_real as number) : null;
  const gananciaNetaReal =
    cerrado && iibbReal !== null && provisionGananciasReal !== null
      ? redondear2(resultadoOperativo - iibbReal - provisionGananciasReal)
      : null;
  const utilidadDistribuibleReal =
    cerrado && gananciaNetaReal !== null && totalReservasReal !== null ? redondear2(gananciaNetaReal - totalReservasReal) : null;

  return {
    periodo,
    estado: cerrado ? "CERRADO" : "ABIERTO",
    fechaCierre: cerrado ? (cierre!.fecha_cierre as string) : null,

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
    iibbReal,

    pctGanancias,
    provisionGananciasSupuesto,
    provisionGananciasReal,

    gananciaNetaSupuesto,
    gananciaNetaReal,

    reservas,
    totalReservasSupuesto,
    totalReservasReal,

    utilidadDistribuibleSupuesto: redondear2(gananciaNetaSupuesto - totalReservasSupuesto),
    utilidadDistribuibleReal,
  };
}

// Congela el supuesto tal como está calculado en este momento y guarda los
// valores reales que cargaste. A partir de acá el período queda CERRADO.
export async function cerrarMes(
  periodo: string,
  pctGanancias: number,
  iibbReal: number,
  provisionGananciasReal: number,
  reservasReal: { nombre: string; monto: number }[]
) {
  const supabase = getSupabaseServerClient();
  const tablero = await calcularTablero(periodo);
  if (tablero.estado === "CERRADO") return { error: "Este mes ya está cerrado. Usá 'Reabrir para corregir'." };

  // El supuesto se recalcula acá con el % que llegó del formulario (por si
  // se ajustó justo antes de cerrar) — resultadoOperativo e IIBB salen del
  // Tablero recién calculado, nunca de lo que mande el cliente.
  const baseGanancias = redondear2(tablero.resultadoOperativo - tablero.iibbSupuesto);
  const provisionGananciasSupuesto = redondear2(baseGanancias * (pctGanancias / 100));
  const gananciaNetaSupuesto = redondear2(baseGanancias - provisionGananciasSupuesto);
  const reservasSupuesto = tablero.reservas.map((r) => ({
    nombre: r.nombre,
    porcentaje: r.porcentaje,
    monto: redondear2(gananciaNetaSupuesto * (r.porcentaje / 100)),
  }));

  const { error } = await supabase.from("cierres_resultado_mes").upsert({
    periodo,
    estado: "CERRADO",
    fecha_cierre: new Date().toISOString(),
    pct_ganancias: pctGanancias,
    iibb_supuesto: tablero.iibbSupuesto,
    iibb_real: iibbReal,
    provision_ganancias_supuesto: provisionGananciasSupuesto,
    provision_ganancias_real: provisionGananciasReal,
    reservas_supuesto: reservasSupuesto,
    reservas_real: reservasReal,
    actualizado_en: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  revalidatePath("/resultado-mes");
  return { error: null };
}

// Corrige los valores reales de un mes ya cerrado — el supuesto congelado
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
