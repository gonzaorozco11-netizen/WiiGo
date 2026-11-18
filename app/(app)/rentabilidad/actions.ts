"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { calcularRendicion } from "@/app/(app)/liquidaciones/actions";
import { exigirGestionInterna } from "@/lib/marcaSesion";
import { listarMermas } from "@/lib/mermas";
import { devueltoPorDetalle, netearRenglon } from "@/lib/devueltoPorDetalle";
import { costoDelRenglon } from "@/lib/costoAlVender";
import { entraPorCuenta } from "@/lib/formasPago";
import { tasasRentabilidad } from "@/lib/tasasRentabilidad";

export type LineaRentabilidad = {
  idDetalle: string;
  fecha: string;
  /** Para abrir la venta entera en Ventas: el renglón es solo un producto de ella. */
  idVenta: string;
  numeroVenta: number;
  /** Lo que se cobró en la venta entera, con productos de otras marcas si los hubo. */
  totalVenta: number;
  producto: string;
  cantidad: number;
  medioPago: string | null;
  formaPagoMp: string | null;
  ventaBruta: number;
  facturacionNeta: number;
  iva: number;
  cmv: number;
  impuestoCreditos: number;
  comisionMp: number;
  gastosFinancieros: number;
  costoImpositivo: number;
  contribucionNeta: number;
  contribucionPorcentaje: number;
};

function vacioResumenRent() {
  return {
    facturacionNeta: 0,
    iva: 0,
    cmv: 0,
    impuestoCreditos: 0,
    comisionMp: 0,
    gastosFinancieros: 0,
    costoImpositivo: 0,
    contribucionNeta: 0,
    // La mercadería que se perdió antes de venderse. No sale de ninguna línea
    // —no hubo venta— pero se comió margen igual, y sin esto la contribución
    // del mes se lee mejor de lo que fue.
    merma: 0,
  };
}

function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

// Rentabilidad real de los productos de una marca propia, línea por línea
// (igual que Liquidaciones): se saca el IVA de la facturación (no es un
// costo, se compensa con crédito fiscal), y se resta el CMV + los costos
// financieros de cobro + el costo impositivo directo (IIBB) — lo que
// queda es la contribución marginal de esa venta.
export async function calcularRentabilidad(idMarca: string, desde: string, hasta: string) {
  await exigirGestionInterna();
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
  if (idsProducto.length === 0)
    return { marca: marca.nombre, lineas: [] as LineaRentabilidad[], resumen: vacioResumenRent() };

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_producto", idsProducto);
  const variantePorId = new Map((variantes ?? []).map((v) => [v.id_variante, v]));
  const idsVariante = (variantes ?? []).map((v) => v.id_variante);
  if (idsVariante.length === 0) return { marca: marca.nombre, lineas: [] as LineaRentabilidad[], resumen: vacioResumenRent() };

  const { data: detalle, error: errorDetalle } = await supabase
    .from("detalle_ventas")
    .select("id_detalle, id_venta, id_variante, cantidad, subtotal, costo_unitario")
    .in("id_variante", idsVariante);
  if (errorDetalle) throw new Error(friendlyDbError(errorDetalle));

  const idsVenta = [...new Set((detalle ?? []).map((d) => d.id_venta))];
  const { data: ventas, error: errorVentas } = await supabase
    .from("ventas")
    .select("id_venta, numero, fecha, medio_pago, estado, id_pago, total")
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

  // Lo devuelto se resta renglón por renglón: ni venta ni costo por un
  // producto que volvió. Ver lib/devueltoPorDetalle.ts.
  const devueltos = await devueltoPorDetalle(supabase, (detalle ?? []).map((d) => d.id_detalle as string));

  const lineas: LineaRentabilidad[] = [];

  for (const linea of detalle ?? []) {
    const venta = ventaPorId.get(linea.id_venta);
    if (!venta) continue;
    const variante = variantePorId.get(linea.id_variante);
    if (!variante) continue;
    const producto = productoPorId.get(variante.id_producto);
    const nombreProducto = `${producto?.nombre ?? "Producto"}${variante.nombre !== "Único" ? ` — ${variante.nombre}` : ""}`;

    const neto = netearRenglon(linea.cantidad, linea.subtotal, devueltos.get(linea.id_detalle));
    if (neto.cantidad <= 0 && neto.subtotal <= 0) continue;
    const ventaBruta = neto.subtotal;
    const esEfectivo = venta.medio_pago === "EFECTIVO";
    const reglas = esEfectivo ? tasas.efectivo : tasas.mercadoPago;

    const impCreditosLinea = reglas.impCreditos ? ventaBruta * (tasas.impCreditos / 100) : 0;
    const formaPagoMp = venta.id_pago ? formaPagoPorIdPago.get(venta.id_pago) ?? null : null;
    // Igual que en Liquidaciones: la tasa cargada es sin IVA, se le suma acá.
    const tasaMp = formaPagoMp ? tasas.mpComisionPorFormaPago[formaPagoMp] ?? 0 : 0;
    const tasaMpConIva = tasaMp * (1 + tasas.ivaGeneral / 100);
    const feeMpLinea = entraPorCuenta(venta.medio_pago) && reglas.comision ? ventaBruta * (tasaMpConIva / 100) : 0;
    // El IVA, IIBB e Impuesto a los Créditos ahora se aplican o no según lo
    // que esté tildado en Configuración para cada forma de pago — antes
    // era fijo (IVA siempre, el resto solo si no era efectivo).
    const facturacionNetaLinea = reglas.iva ? ventaBruta / (1 + tasas.ivaGeneral / 100) : ventaBruta;
    const ivaLinea = ventaBruta - facturacionNetaLinea;
    const costoImpositivoLinea = reglas.iibb ? facturacionNetaLinea * (tasas.iibb / 100) : 0;
    // El costo que tenía cuando se vendió; lo vendido antes de guardarlo, el de hoy (lib/costoAlVender.ts).
    const cmvLinea = costoDelRenglon(linea.costo_unitario, producto?.costo_informado) * neto.cantidad;
    const impuestoCreditosRedondeado = redondear2(impCreditosLinea);
    const comisionMpRedondeada = redondear2(feeMpLinea);
    const gastosFinancierosLinea = redondear2(impCreditosLinea + feeMpLinea);
    const costoImpositivoRedondeado = redondear2(costoImpositivoLinea);
    const contribucionNeta = redondear2(facturacionNetaLinea - cmvLinea - gastosFinancierosLinea - costoImpositivoRedondeado);

    lineas.push({
      idDetalle: linea.id_detalle,
      fecha: venta.fecha,
      idVenta: venta.id_venta,
      numeroVenta: venta.numero,
      totalVenta: Number(venta.total ?? 0),
      producto: nombreProducto,
      cantidad: neto.cantidad,
      medioPago: venta.medio_pago,
      formaPagoMp,
      ventaBruta: redondear2(ventaBruta),
      facturacionNeta: redondear2(facturacionNetaLinea),
      iva: redondear2(ivaLinea),
      cmv: redondear2(cmvLinea),
      impuestoCreditos: impuestoCreditosRedondeado,
      comisionMp: comisionMpRedondeada,
      gastosFinancieros: gastosFinancierosLinea,
      costoImpositivo: costoImpositivoRedondeado,
      contribucionNeta,
      contribucionPorcentaje: facturacionNetaLinea > 0 ? (contribucionNeta / facturacionNetaLinea) * 100 : 0,
    });
  }

  lineas.sort((a, b) => b.fecha.localeCompare(a.fecha));

  const resumen = lineas.reduce(
    (acc, l) => ({
      facturacionNeta: redondear2(acc.facturacionNeta + l.facturacionNeta),
      iva: redondear2(acc.iva + l.iva),
      cmv: redondear2(acc.cmv + l.cmv),
      impuestoCreditos: redondear2(acc.impuestoCreditos + l.impuestoCreditos),
      comisionMp: redondear2(acc.comisionMp + l.comisionMp),
      gastosFinancieros: redondear2(acc.gastosFinancieros + l.gastosFinancieros),
      costoImpositivo: redondear2(acc.costoImpositivo + l.costoImpositivo),
      contribucionNeta: redondear2(acc.contribucionNeta + l.contribucionNeta),
      merma: 0,
    }),
    vacioResumenRent()
  );

  // La merma del período de esta marca. Se resta al final y no línea por
  // línea porque no pertenece a ninguna venta: es mercadería que nunca llegó
  // a venderse.
  const { resumen: mermaResumen } = await listarMermas({ desde, hasta, idMarca });
  resumen.merma = mermaResumen.perdidaPropia;
  resumen.contribucionNeta = redondear2(resumen.contribucionNeta - resumen.merma);

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

  // SIRCREB: retención sobre todo lo que ingresó por Mercado Pago o el
  // posnet en el período — la sufre WiiGo en su propia cuenta, sin importar la marca.
  const { data: ventasMp } = await supabase
    .from("ventas")
    .select("total")
    .eq("estado", "PAGADA")
    .in("medio_pago", ["MERCADO_PAGO", "POSNET"])
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
