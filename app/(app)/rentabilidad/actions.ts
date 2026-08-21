"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { calcularRendicion } from "@/app/(app)/liquidaciones/actions";
import type { SupabaseClient } from "@supabase/supabase-js";

// Coincide con `pagos.forma_pago_cliente` (ver cobros-efectivo/actions.ts)
// y con Configuración → Comisión de Mercado Pago — no hay una sola
// comisión de MP, varía según cómo pagó el cliente.
const CLAVE_COMISION_MP: Record<string, string> = {
  DINERO_CUENTA: "MP_COMISION_DINERO_CUENTA",
  DEBITO: "MP_COMISION_DEBITO",
  CUOTAS_SIN_INTERES: "MP_COMISION_CUOTAS_SIN_INTERES",
  PREPAGA: "MP_COMISION_PREPAGA",
  CREDITO: "MP_COMISION_CREDITO",
};

async function tasasRentabilidad(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", [
      "IVA_GENERAL_PORCENTAJE",
      "IIBB_PORCENTAJE",
      "IMP_CREDITOS_PORCENTAJE",
      ...Object.values(CLAVE_COMISION_MP),
    ]);
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.parametro, Number(r.valor ?? 0)]));
  return {
    ivaGeneral: cfg.IVA_GENERAL_PORCENTAJE ?? 21,
    iibb: cfg.IIBB_PORCENTAJE ?? 0,
    impCreditos: cfg.IMP_CREDITOS_PORCENTAJE ?? 0,
    mpComisionPorFormaPago: Object.fromEntries(
      Object.entries(CLAVE_COMISION_MP).map(([forma, clave]) => [forma, cfg[clave] ?? 0])
    ) as Record<string, number>,
  };
}

export type LineaRentabilidad = {
  idDetalle: string;
  fecha: string;
  numeroVenta: number;
  producto: string;
  cantidad: number;
  medioPago: string | null;
  formaPagoMp: string | null;
  ventaBruta: number;
  facturacionNeta: number;
  cmv: number;
  gastosFinancieros: number;
  costoImpositivo: number;
  contribucionNeta: number;
  contribucionPorcentaje: number;
};

function vacioResumenRent() {
  return { facturacionNeta: 0, cmv: 0, gastosFinancieros: 0, costoImpositivo: 0, contribucionNeta: 0 };
}

// Rentabilidad real de los productos de una marca propia, línea por línea
// (igual que Liquidaciones): se saca el IVA de la facturación (no es un
// costo, se compensa con crédito fiscal), y se resta el CMV + los costos
// financieros de cobro + el costo impositivo directo (IIBB) — lo que
// queda es la contribución marginal de esa venta.
export async function calcularRentabilidad(idMarca: string, desde: string, hasta: string) {
  const supabase = getSupabaseServerClient();
  const tasas = await tasasRentabilidad(supabase);

  const { data: marca, error: errorMarca } = await supabase
    .from("marcas")
    .select("nombre")
    .eq("id_marca", idMarca)
    .maybeSingle();
  if (errorMarca) throw new Error(friendlyDbError(errorMarca));
  if (!marca) throw new Error("No se encontró la marca");

  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre, costo_informado")
    .eq("id_marca", idMarca);
  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto, p]));
  const idsProducto = (productos ?? []).map((p) => p.id_producto);
  if (idsProducto.length === 0) return { marca: marca.nombre, lineas: [] as LineaRentabilidad[], resumen: vacioResumenRent() };

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_producto", idsProducto);
  const variantePorId = new Map((variantes ?? []).map((v) => [v.id_variante, v]));
  const idsVariante = (variantes ?? []).map((v) => v.id_variante);
  if (idsVariante.length === 0) return { marca: marca.nombre, lineas: [] as LineaRentabilidad[], resumen: vacioResumenRent() };

  const { data: detalle, error: errorDetalle } = await supabase
    .from("detalle_ventas")
    .select("id_detalle, id_venta, id_variante, cantidad, subtotal")
    .in("id_variante", idsVariante);
  if (errorDetalle) throw new Error(friendlyDbError(errorDetalle));

  const idsVenta = [...new Set((detalle ?? []).map((d) => d.id_venta))];
  const { data: ventas, error: errorVentas } = await supabase
    .from("ventas")
    .select("id_venta, numero, fecha, medio_pago, estado, id_pago")
    .in("id_venta", idsVenta.length > 0 ? idsVenta : ["00000000-0000-0000-0000-000000000000"])
    .eq("estado", "PAGADA")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  if (errorVentas) throw new Error(friendlyDbError(errorVentas));
  const ventaPorId = new Map((ventas ?? []).map((v) => [v.id_venta, v]));

  const idsPago = [...new Set((ventas ?? []).map((v) => v.id_pago).filter((id): id is string => Boolean(id)))];
  const { data: pagos } = await supabase
    .from("pagos")
    .select("id_pago, forma_pago_cliente")
    .in("id_pago", idsPago.length > 0 ? idsPago : ["00000000-0000-0000-0000-000000000000"]);
  const formaPagoPorIdPago = new Map((pagos ?? []).map((p) => [p.id_pago, p.forma_pago_cliente]));

  const lineas: LineaRentabilidad[] = [];

  for (const linea of detalle ?? []) {
    const venta = ventaPorId.get(linea.id_venta);
    if (!venta) continue;
    const variante = variantePorId.get(linea.id_variante);
    if (!variante) continue;
    const producto = productoPorId.get(variante.id_producto);
    const nombreProducto = `${producto?.nombre ?? "Producto"}${variante.nombre !== "Único" ? ` — ${variante.nombre}` : ""}`;

    const ventaBruta = linea.subtotal ?? 0;
    const esEfectivo = venta.medio_pago === "EFECTIVO";
    const impCreditosLinea = esEfectivo ? 0 : ventaBruta * (tasas.impCreditos / 100);
    const formaPagoMp = venta.id_pago ? formaPagoPorIdPago.get(venta.id_pago) ?? null : null;
    // Igual que en Liquidaciones: la tasa cargada es sin IVA, se le suma acá.
    const tasaMp = formaPagoMp ? tasas.mpComisionPorFormaPago[formaPagoMp] ?? 0 : 0;
    const tasaMpConIva = tasaMp * (1 + tasas.ivaGeneral / 100);
    const feeMpLinea = !esEfectivo && venta.medio_pago === "MERCADO_PAGO" ? ventaBruta * (tasaMpConIva / 100) : 0;
    // IIBB solo se percibe/expone sobre lo que pasa por el banco — en
    // efectivo no hay retención ni rastro bancario, así que no corresponde.
    const facturacionNetaLinea = ventaBruta / (1 + tasas.ivaGeneral / 100);
    const costoImpositivoLinea = esEfectivo ? 0 : facturacionNetaLinea * (tasas.iibb / 100);
    const cmvLinea = (producto?.costo_informado ?? 0) * linea.cantidad;
    const gastosFinancierosLinea = Math.round(impCreditosLinea + feeMpLinea);
    const costoImpositivoRedondeado = Math.round(costoImpositivoLinea);
    const contribucionNeta = Math.round(facturacionNetaLinea - cmvLinea - gastosFinancierosLinea - costoImpositivoRedondeado);

    lineas.push({
      idDetalle: linea.id_detalle,
      fecha: venta.fecha,
      numeroVenta: venta.numero,
      producto: nombreProducto,
      cantidad: linea.cantidad,
      medioPago: venta.medio_pago,
      formaPagoMp,
      ventaBruta: Math.round(ventaBruta),
      facturacionNeta: Math.round(facturacionNetaLinea),
      cmv: Math.round(cmvLinea),
      gastosFinancieros: gastosFinancierosLinea,
      costoImpositivo: costoImpositivoRedondeado,
      contribucionNeta,
      contribucionPorcentaje: facturacionNetaLinea > 0 ? (contribucionNeta / facturacionNetaLinea) * 100 : 0,
    });
  }

  lineas.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const resumen = lineas.reduce(
    (acc, l) => ({
      facturacionNeta: acc.facturacionNeta + l.facturacionNeta,
      cmv: acc.cmv + l.cmv,
      gastosFinancieros: acc.gastosFinancieros + l.gastosFinancieros,
      costoImpositivo: acc.costoImpositivo + l.costoImpositivo,
      contribucionNeta: acc.contribucionNeta + l.contribucionNeta,
    }),
    vacioResumenRent()
  );

  return { marca: marca.nombre, lineas, resumen };
}

// Panel de auditoría interna de WiiGo — no se le muestra a las marcas.
export async function panelAuditoria(desde: string, hasta: string) {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", ["SIRCREB_PORCENTAJE", "IMP_DEBITOS_PORCENTAJE"]);
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.parametro, Number(r.valor ?? 0)]));
  const sircrebPorcentaje = cfg.SIRCREB_PORCENTAJE ?? 0;
  const impDebitosPorcentaje = cfg.IMP_DEBITOS_PORCENTAJE ?? 0;

  // SIRCREB: retención sobre todo lo que ingresó por Mercado Pago en el
  // período — la sufre WiiGo en su propia cuenta, sin importar la marca.
  const { data: ventasMp } = await supabase
    .from("ventas")
    .select("total")
    .eq("estado", "PAGADA")
    .eq("medio_pago", "MERCADO_PAGO")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  const totalMp = (ventasMp ?? []).reduce((acc, v) => acc + (v.total ?? 0), 0);
  const sircrebRetenido = Math.round(totalMp * (sircrebPorcentaje / 100));

  // Proyección Imp. a los Débitos: lo que cobraría el banco si hoy se
  // transfiriera todo lo pendiente de rendir a las marcas en consignación.
  const { data: marcas } = await supabase.from("marcas").select("id_marca").eq("tipo_comercializacion", "CONSIGNACION");
  let totalPendienteTransferencia = 0;
  for (const m of marcas ?? []) {
    const r = await calcularRendicion(m.id_marca, "2000-01-01", hasta);
    totalPendienteTransferencia += r.resumen.netoTransferencia;
  }
  const proyeccionImpDebitos = Math.round(totalPendienteTransferencia * (impDebitosPorcentaje / 100));

  return { totalMp, sircrebRetenido, totalPendienteTransferencia, proyeccionImpDebitos };
}
