import type { SupabaseClient } from "@supabase/supabase-js";
import { construirLineas, type LineaRendicion } from "@/app/(app)/liquidaciones/actions";
import { tasasRentabilidad } from "@/lib/tasasRentabilidad";
import { devueltoPorDetalle, devueltoParcialPorVenta, netearRenglon } from "@/lib/devueltoPorDetalle";
import { costoDelRenglon } from "@/lib/costoAlVender";
import { descuentosRealesPorVenta } from "@/lib/cobrosDigitales";
import { entraPorCuenta, etiquetaPago } from "@/lib/formasPago";
import { fechaHoraArgentina } from "@/lib/horarios";

// «Ventas de hoy» en el Inicio del dueño (Gonzalo, 18/11, maqueta aprobada):
// cada venta en una fila con todo lo que se le descuenta, y lo que le queda a WiiGo.
//
// Con las mismas cuentas que las otras pantallas, para que los números den igual:
//   - lo de marcas en consignación sale de construirLineas (Liquidaciones): lo
//     que se le rinde a la marca, el IVA de la comisión de WiiGo y los costos de
//     cobro que se le trasladan (con lo REAL de Mercado Pago cuando ya llegó);
//   - lo de marca propia, como Rentabilidad: IVA, IIBB, costo de la mercadería y
//     costo de cobro según las reglas de Configuración; si Mercado Pago ya
//     informó el descuento real, se usa ese.
// «Te queda» = lo vendido menos todo eso.

export type FilaVentaDia = {
  id: string;
  numero: number;
  hora: string;
  donde: string;
  pago: string;
  dato: "REAL" | "ESTIMADO" | "SIN_COSTO";
  vendido: number;
  mercaderia: number;
  paraMarcas: number;
  iva: number;
  iibb: number;
  cobro: number;
  creditos: number;
  retenciones: number;
  queda: number;
  productos: { nombre: string; marca: string; cantidad: number; subtotal: number }[];
  /** Pagó con más plata (efectivo): para el «vuelto». */
  pagoCon: number | null;
};

export type VentasDelDia = { fecha: string; filas: FilaVentaDia[]; total: Omit<FilaVentaDia, "id" | "numero" | "hora" | "donde" | "pago" | "dato" | "productos" | "pagoCon"> };

const r2 = (n: number) => Math.round(n * 100) / 100;
const DONDE: Record<string, string> = { SELF_CHECKOUT: "Tótem", POS: "Caja", ONLINE: "Tienda online" };

export async function ventasDelDia(supabase: SupabaseClient, fecha = fechaHoraArgentina().fecha): Promise<VentasDelDia> {
  const desde = new Date(`${fecha}T00:00:00-03:00`);
  const hasta = new Date(desde.getTime() + 86400000);
  const { data: ventas, error } = await supabase
    .from("ventas")
    .select("id_venta, numero, fecha, canal, total, total_cobrado, medio_pago, id_pago")
    .eq("estado", "PAGADA")
    .gte("fecha", desde.toISOString())
    .lt("fecha", hasta.toISOString())
    .order("fecha", { ascending: true });
  if (error) throw new Error(error.message);
  const lista = ventas ?? [];
  const vacio = { vendido: 0, mercaderia: 0, paraMarcas: 0, iva: 0, iibb: 0, cobro: 0, creditos: 0, retenciones: 0, queda: 0 };
  if (lista.length === 0) return { fecha, filas: [], total: vacio };

  const idsVenta = lista.map((v) => v.id_venta as string);
  const { data: detalle } = await supabase
    .from("detalle_ventas")
    .select("id_detalle, id_venta, id_marca, id_variante, cantidad, subtotal, costo_unitario")
    .in("id_venta", idsVenta);
  const renglones = detalle ?? [];
  const idsVariante = [...new Set(renglones.map((d) => d.id_variante as string).filter(Boolean))];
  const idsMarca = [...new Set(renglones.map((d) => d.id_marca as string).filter(Boolean))];
  const idsPago = [...new Set(lista.map((v) => v.id_pago as string | null).filter((x): x is string => Boolean(x)))];

  const [{ data: variantes }, { data: marcas }, { data: pagos }, devueltos, devPorVenta, tasas] = await Promise.all([
    idsVariante.length
      ? supabase.from("variantes_producto").select("id_variante, nombre, productos(nombre, costo_informado)").in("id_variante", idsVariante)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    idsMarca.length ? supabase.from("marcas").select("id_marca, nombre, tipo_comercializacion").in("id_marca", idsMarca) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    idsPago.length ? supabase.from("pagos").select("id_pago, forma_pago_cliente").in("id_pago", idsPago) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    devueltoPorDetalle(supabase, renglones.map((d) => d.id_detalle as string)),
    devueltoParcialPorVenta(supabase, idsVenta),
    tasasRentabilidad(supabase),
  ]);
  const varPorId = new Map((variantes ?? []).map((v) => [v.id_variante as string, v as { nombre: string; productos: { nombre: string; costo_informado: number | null } | null }]));
  const marcaPorId = new Map((marcas ?? []).map((m) => [m.id_marca as string, m as { nombre: string; tipo_comercializacion: string }]));
  const formaPorPago = new Map((pagos ?? []).map((p) => [p.id_pago as string, (p.forma_pago_cliente as string | null) ?? null]));
  const esPropia = (idMarca: string) => marcaPorId.get(idMarca)?.tipo_comercializacion === "PROPIA";

  // Consignación: el motor de Liquidaciones, marca por marca (solo las de hoy).
  const lineaConsig = new Map<string, LineaRendicion>();
  const ventasMin = lista.map((v) => ({ id_venta: v.id_venta as string, numero: v.numero as number, fecha: v.fecha as string, medio_pago: v.medio_pago as string | null, id_pago: v.id_pago as string | null }));
  for (const idMarca of idsMarca.filter((m) => !esPropia(m))) {
    const deLaMarca = ventasMin.filter((v) => renglones.some((d) => d.id_venta === v.id_venta && d.id_marca === idMarca));
    try {
      const { lineas } = await construirLineas(supabase, idMarca, deLaMarca);
      for (const l of lineas) lineaConsig.set(l.idDetalle, l);
    } catch {
      // Si una marca no se puede calcular, sus renglones quedan sin descuentos (no rompe el Inicio).
    }
  }
  // Marca propia: lo real de Mercado Pago, si ya llegó.
  const reales = await descuentosRealesPorVenta(
    supabase,
    lista.filter((v) => v.medio_pago === "MERCADO_PAGO").map((v) => v.id_venta as string)
  ).catch(() => new Map());

  const filas: FilaVentaDia[] = lista.map((v) => {
    const id = v.id_venta as string;
    const efectivo = v.medio_pago === "EFECTIVO";
    const reglas = efectivo ? tasas.efectivo : tasas.mercadoPago;
    const forma = v.id_pago ? formaPorPago.get(v.id_pago as string) ?? null : null;
    const real = efectivo ? undefined : reales.get(id);
    const f = { mercaderia: 0, paraMarcas: 0, iva: 0, iibb: 0, cobro: 0, creditos: 0, retenciones: 0 };
    const productos: FilaVentaDia["productos"] = [];
    let todoReal = !efectivo;
    for (const d of renglones.filter((x) => x.id_venta === id)) {
      const neto = netearRenglon(d.cantidad as number, d.subtotal as number, devueltos.get(d.id_detalle as string));
      if (neto.cantidad <= 0 && neto.subtotal <= 0) continue;
      const va = varPorId.get(d.id_variante as string);
      const marca = marcaPorId.get(d.id_marca as string);
      productos.push({
        nombre: `${va?.productos?.nombre ?? "Producto"}${va?.nombre && va.nombre !== "Único" ? ` — ${va.nombre}` : ""}`,
        marca: marca?.nombre ?? "",
        cantidad: neto.cantidad,
        subtotal: r2(neto.subtotal),
      });
      if (d.id_marca && !esPropia(d.id_marca as string)) {
        const l = lineaConsig.get(d.id_detalle as string);
        if (!l) continue;
        // Lo que se va de la venta: lo que se le rinde a la marca (con lo del programa de profesionales).
        f.paraMarcas += l.netoARendir + l.programaProfesionales;
        f.iva += l.ivaComision;
        f.cobro += l.feeMp;
        f.creditos += l.impCreditos + l.impDebitos;
        f.retenciones += l.sircreb;
        if (l.dato !== "REAL") todoReal = false;
        continue;
      }
      // Propia (como Rentabilidad).
      const bruto = neto.subtotal;
      const netoSinIva = reglas.iva ? bruto / (1 + tasas.ivaGeneral / 100) : bruto;
      f.iva += bruto - netoSinIva;
      f.iibb += reglas.iibb ? netoSinIva * (tasas.iibb / 100) : 0;
      f.mercaderia += costoDelRenglon(d.costo_unitario, va?.productos?.costo_informado) * neto.cantidad;
      if (real && real.pagoCliente > 0) {
        const parte = bruto / real.pagoCliente;
        f.cobro += real.comision * parte;
        f.creditos += real.impCreditos * parte;
        f.retenciones += real.retenciones * parte;
      } else {
        if (!efectivo) todoReal = false;
        const tasa = forma ? tasas.mpComisionPorFormaPago[forma] ?? 0 : 0;
        f.cobro += entraPorCuenta(v.medio_pago as string) && reglas.comision ? bruto * ((tasa * (1 + tasas.ivaGeneral / 100)) / 100) : 0;
        f.creditos += reglas.impCreditos ? bruto * (tasas.impCreditos / 100) : 0;
      }
    }
    const vendido = r2(Math.max(Number(v.total ?? 0) - (devPorVenta.get(id) ?? 0), 0));
    const redondeado = Object.fromEntries(Object.entries(f).map(([k, x]) => [k, r2(x)])) as typeof f;
    const queda = r2(vendido - Object.values(redondeado).reduce((a, x) => a + x, 0));
    const cobrado = Number(v.total_cobrado ?? 0);
    return {
      id,
      numero: v.numero as number,
      hora: fechaHoraArgentina(v.fecha as string).hora.slice(0, 5),
      donde: DONDE[v.canal as string] ?? "Caja",
      pago: etiquetaPago(v.medio_pago as string, forma),
      dato: efectivo ? "SIN_COSTO" : todoReal ? "REAL" : "ESTIMADO",
      vendido,
      ...redondeado,
      queda,
      productos,
      pagoCon: efectivo && cobrado > vendido ? cobrado : null,
    };
  });

  const total = filas.reduce(
    (a, x) => ({
      vendido: r2(a.vendido + x.vendido),
      mercaderia: r2(a.mercaderia + x.mercaderia),
      paraMarcas: r2(a.paraMarcas + x.paraMarcas),
      iva: r2(a.iva + x.iva),
      iibb: r2(a.iibb + x.iibb),
      cobro: r2(a.cobro + x.cobro),
      creditos: r2(a.creditos + x.creditos),
      retenciones: r2(a.retenciones + x.retenciones),
      queda: r2(a.queda + x.queda),
    }),
    vacio
  );
  return { fecha, filas, total };
}
