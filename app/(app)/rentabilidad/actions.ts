"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { calcularRendicion } from "@/app/(app)/liquidaciones/actions";
import type { SupabaseClient } from "@supabase/supabase-js";

async function tasasRentabilidad(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", ["IVA_GENERAL_PORCENTAJE", "IIBB_PORCENTAJE", "IMP_CREDITOS_PORCENTAJE", "MP_COMISION_PORCENTAJE"]);
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.parametro, Number(r.valor ?? 0)]));
  return {
    ivaGeneral: cfg.IVA_GENERAL_PORCENTAJE ?? 21,
    iibb: cfg.IIBB_PORCENTAJE ?? 0,
    impCreditos: cfg.IMP_CREDITOS_PORCENTAJE ?? 0,
    mpComision: cfg.MP_COMISION_PORCENTAJE ?? 0,
  };
}

export type FilaRentabilidad = {
  idProducto: string;
  nombre: string;
  unidades: number;
  facturacionBruta: number;
  facturacionNeta: number;
  cmv: number;
  gastosFinancieros: number;
  costoImpositivo: number;
  contribucionNeta: number;
  contribucionPorcentaje: number;
};

// Rentabilidad real de los productos de una marca propia: se saca el IVA
// de la facturación (no es un costo, se compensa con crédito fiscal), y
// se resta el CMV + los costos financieros de cobro + el costo
// impositivo directo (IIBB) — lo que queda es la contribución marginal.
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
  if (idsProducto.length === 0) return { marca: marca.nombre, filas: [] as FilaRentabilidad[], resumen: vacioResumenRent() };

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto")
    .in("id_producto", idsProducto);
  const productoDeVariante = new Map((variantes ?? []).map((v) => [v.id_variante, v.id_producto]));
  const idsVariante = (variantes ?? []).map((v) => v.id_variante);
  if (idsVariante.length === 0) return { marca: marca.nombre, filas: [] as FilaRentabilidad[], resumen: vacioResumenRent() };

  const { data: detalle, error: errorDetalle } = await supabase
    .from("detalle_ventas")
    .select("id_venta, id_variante, cantidad, subtotal")
    .in("id_variante", idsVariante);
  if (errorDetalle) throw new Error(friendlyDbError(errorDetalle));

  const idsVenta = [...new Set((detalle ?? []).map((d) => d.id_venta))];
  const { data: ventas, error: errorVentas } = await supabase
    .from("ventas")
    .select("id_venta, fecha, medio_pago, estado")
    .in("id_venta", idsVenta.length > 0 ? idsVenta : ["00000000-0000-0000-0000-000000000000"])
    .eq("estado", "PAGADA")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  if (errorVentas) throw new Error(friendlyDbError(errorVentas));
  const ventaPorId = new Map((ventas ?? []).map((v) => [v.id_venta, v]));

  const porProducto = new Map<
    string,
    { nombre: string; unidades: number; facturacionBruta: number; cmv: number; gastosFinancieros: number }
  >();

  for (const linea of detalle ?? []) {
    const venta = ventaPorId.get(linea.id_venta);
    if (!venta) continue;
    const idProducto = productoDeVariante.get(linea.id_variante);
    if (!idProducto) continue;
    const producto = productoPorId.get(idProducto);

    const ventaBruta = linea.subtotal ?? 0;
    const esEfectivo = venta.medio_pago === "EFECTIVO";
    const impCreditosLinea = esEfectivo ? 0 : ventaBruta * (tasas.impCreditos / 100);
    const feeMpLinea = !esEfectivo && venta.medio_pago === "MERCADO_PAGO" ? ventaBruta * (tasas.mpComision / 100) : 0;

    const acc = porProducto.get(idProducto) ?? {
      nombre: producto?.nombre ?? "Producto",
      unidades: 0,
      facturacionBruta: 0,
      cmv: 0,
      gastosFinancieros: 0,
    };
    acc.unidades += linea.cantidad;
    acc.facturacionBruta += ventaBruta;
    acc.cmv += (producto?.costo_informado ?? 0) * linea.cantidad;
    acc.gastosFinancieros += impCreditosLinea + feeMpLinea;
    porProducto.set(idProducto, acc);
  }

  const filas: FilaRentabilidad[] = [...porProducto.entries()]
    .map(([idProducto, p]) => {
      const facturacionNeta = p.facturacionBruta / (1 + tasas.ivaGeneral / 100);
      const costoImpositivo = facturacionNeta * (tasas.iibb / 100);
      const gastosFinancieros = Math.round(p.gastosFinancieros);
      const contribucionNeta = Math.round(facturacionNeta - p.cmv - gastosFinancieros - costoImpositivo);
      return {
        idProducto,
        nombre: p.nombre,
        unidades: p.unidades,
        facturacionBruta: Math.round(p.facturacionBruta),
        facturacionNeta: Math.round(facturacionNeta),
        cmv: Math.round(p.cmv),
        gastosFinancieros,
        costoImpositivo: Math.round(costoImpositivo),
        contribucionNeta,
        contribucionPorcentaje: facturacionNeta > 0 ? (contribucionNeta / facturacionNeta) * 100 : 0,
      };
    })
    .sort((a, b) => b.facturacionNeta - a.facturacionNeta);

  const resumen = filas.reduce(
    (acc, f) => ({
      facturacionNeta: acc.facturacionNeta + f.facturacionNeta,
      cmv: acc.cmv + f.cmv,
      gastosFinancieros: acc.gastosFinancieros + f.gastosFinancieros,
      costoImpositivo: acc.costoImpositivo + f.costoImpositivo,
      contribucionNeta: acc.contribucionNeta + f.contribucionNeta,
    }),
    vacioResumenRent()
  );

  return { marca: marca.nombre, filas, resumen };
}

function vacioResumenRent() {
  return { facturacionNeta: 0, cmv: 0, gastosFinancieros: 0, costoImpositivo: 0, contribucionNeta: 0 };
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
