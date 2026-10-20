import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina } from "@/lib/horarios";
import { devueltoPorDetalle, devueltoParcialPorVenta, netearRenglon } from "@/lib/devueltoPorDetalle";

// El negocio de un vistazo, para el inicio del Dueño: el mes, el día, las
// ventas por día, por hora y por día de la semana, por marca y los productos
// que más facturan. Es la versión "de todo el local" de lo que cada marca ve
// en su portal.
//
// Todo en hora argentina: el servidor corre en UTC y una venta de las 22 h
// caería en el día siguiente.
//
// Todo sin lo devuelto. Dos maneras, según qué se sume:
//   - Lo que suma `ventas.total` (lo vendido, por día, por hora, el ticket)
//     resta las devoluciones parciales de cada venta, igual que el "Venta" del
//     Dashboard.
//   - Lo que suma renglones (por marca, por producto, unidades, comisión)
//     netea cada renglón con lo que volvió de él.
// Las dos dan lo mismo salvo por los descuentos de la venta entera (puntos,
// referidos), que viven en el total y no en los renglones. Por eso el
// porcentaje de cada marca se mide contra la suma de las marcas, no contra lo
// vendido: así siempre suma 100%.

export type InicioDueno = {
  mesNombre: string;
  mesAnteriorNombre: string;
  diaDeHoy: number;
  diasDelMes: number;
  vendidoMes: number;
  /** Al ritmo del mes, cuánto cerraría. null antes del día 5: es puro ruido. */
  proyeccion: number | null;
  /** Mismos días del mes anterior (del 1 a hoy). */
  vendidoMesAnteriorTramo: number;
  /** Venta acumulada día a día: este mes hasta hoy, el anterior completo. */
  acumuladoMes: number[];
  acumuladoMesAnterior: number[];
  hoy: { vendido: number; tickets: number };
  ticketPromedio: number;
  unidadesMes: number;
  ticketsMes: number;
  comisionMarcas: number;
  /** Parte de lo vendido en el mes que se cobró en efectivo, de 0 a 1. */
  parteEfectivo: number | null;
  /** Un valor por día del mes (los que no llegaron, en null). */
  porDia: { dia: number; diaSemana: number; vendido: number | null }[];
  mejorDia: { dia: number; diaSemana: number; vendido: number } | null;
  promedioDiario: number | null;
  porHora: { hora: number; vendido: number }[];
  horaPico: number | null;
  porDiaSemana: { etiqueta: string; vendido: number }[];
  diaSemanaPico: string | null;
  marcas: {
    idMarca: string;
    nombre: string;
    propia: boolean;
    sinProductos: boolean;
    hoy: number;
    vendido: number;
    parte: number;
    unidades: number;
    ticketPromedio: number | null;
    /** Contra los mismos días del mes anterior. null si el anterior fue cero. */
    variacion: number | null;
  }[];
  productos: { nombre: string; marca: string; idMarca: string; vendido: number; unidades: number }[];
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const TANDA = 500;
const PAGINA = 1000;

/** Trae todas las filas de una consulta, de a 1000 (el tope de la base por pedido). */
async function todas<T>(armar: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await armar(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) return filas;
  }
}

function ymd(anio: number, mes: number, dia: number) {
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export async function armarInicioDueno(supabase: SupabaseClient): Promise<InicioDueno> {
  const ahora = fechaHoraArgentina();
  const hoyISO = ahora.fecha;
  const anio = Number(hoyISO.slice(0, 4));
  const mes = Number(hoyISO.slice(5, 7));
  const diaDeHoy = Number(hoyISO.slice(8, 10));
  const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const anioAnt = mes === 1 ? anio - 1 : anio;
  const mesAnt = mes === 1 ? 12 : mes - 1;
  const diasMesAnt = new Date(Date.UTC(anioAnt, mesAnt, 0)).getUTCDate();
  const inicioMes = ymd(anio, mes, 1);
  const inicioMesAnt = ymd(anioAnt, mesAnt, 1);
  // Horas y días de la semana: últimas 8 semanas, como en el portal de marcas.
  const hace56 = fechaHoraArgentina(new Date(Date.now() - 56 * 86400000)).fecha;
  const desde = hace56 < inicioMesAnt ? hace56 : inicioMesAnt;

  const ventas = await todas<{ id_venta: string; fecha: string; total: number | null; medio_pago: string | null }>((a, b) =>
    supabase
      .from("ventas")
      .select("id_venta, fecha, total, medio_pago")
      .eq("estado", "PAGADA")
      .gte("fecha", `${desde}T00:00:00-03:00`)
      .order("fecha", { ascending: true })
      .range(a, b)
  );
  const idsVenta = ventas.map((v) => v.id_venta);

  type Renglon = { id_detalle: string; id_venta: string; id_marca: string | null; id_variante: string | null; cantidad: number | null; subtotal: number | null; precio_unitario: number | null };
  const renglones: Renglon[] = [];
  for (let i = 0; i < idsVenta.length; i += TANDA) {
    const tanda = idsVenta.slice(i, i + TANDA);
    renglones.push(
      ...(await todas<Renglon>((a, b) =>
        supabase
          .from("detalle_ventas")
          .select("id_detalle, id_venta, id_marca, id_variante, cantidad, subtotal, precio_unitario")
          .in("id_venta", tanda)
          .order("id_detalle", { ascending: true })
          .range(a, b)
      ))
    );
  }

  const [devPorVenta, devPorRenglon, marcasRes, productosActivosRes] = await Promise.all([
    devueltoParcialPorVenta(supabase, idsVenta),
    devueltoPorDetalle(supabase, renglones.map((r) => r.id_detalle)),
    supabase
      .from("marcas")
      .select("id_marca, nombre, estado, tipo_comercializacion, royalty_porcentaje, iva_royalty_porcentaje, trasladar_iva_comision, trasladar_iva_comision_efectivo"),
    supabase.from("productos").select("id_marca").eq("estado", "ACTIVO"),
  ]);
  if (marcasRes.error) throw new Error(marcasRes.error.message);
  const marcas = marcasRes.data ?? [];
  const marcaPorId = new Map(marcas.map((m) => [m.id_marca as string, m]));
  const conProductos = new Set((productosActivosRes.data ?? []).map((p) => p.id_marca as string));

  // ---------- Lo que suma la venta entera ----------
  type VentaAR = { id: string; fecha: string; dia: number; mesDe: "actual" | "anterior" | "otro"; hora: number; diaSemana: number; neto: number; efectivo: boolean };
  const ventasAR: VentaAR[] = ventas.map((v) => {
    const f = fechaHoraArgentina(v.fecha);
    const mesDe = f.fecha.slice(0, 7) === inicioMes.slice(0, 7) ? "actual" : f.fecha.slice(0, 7) === inicioMesAnt.slice(0, 7) ? "anterior" : "otro";
    return {
      id: v.id_venta,
      fecha: f.fecha,
      dia: Number(f.fecha.slice(8, 10)),
      mesDe,
      hora: Number(f.hora.slice(0, 2)),
      diaSemana: f.diaSemanaISO,
      neto: Math.max((v.total ?? 0) - (devPorVenta.get(v.id_venta) ?? 0), 0),
      efectivo: v.medio_pago === "EFECTIVO",
    };
  });
  const ventaPorId = new Map(ventasAR.map((v) => [v.id, v]));
  const delMes = ventasAR.filter((v) => v.mesDe === "actual");
  const deHoy = delMes.filter((v) => v.fecha === hoyISO);
  const vendidoMes = delMes.reduce((a, v) => a + v.neto, 0);
  const efectivoMes = delMes.filter((v) => v.efectivo).reduce((a, v) => a + v.neto, 0);
  const vendidoMesAnteriorTramo = ventasAR
    .filter((v) => v.mesDe === "anterior" && v.dia <= diaDeHoy)
    .reduce((a, v) => a + v.neto, 0);

  const diario = new Array<number>(diasDelMes).fill(0);
  for (const v of delMes) diario[v.dia - 1] += v.neto;
  const diarioAnt = new Array<number>(diasMesAnt).fill(0);
  for (const v of ventasAR) if (v.mesDe === "anterior") diarioAnt[v.dia - 1] += v.neto;
  const acumular = (xs: number[]) => xs.reduce<number[]>((acc, x) => [...acc, (acc[acc.length - 1] ?? 0) + x], []);

  const porDia = diario.map((vendido, i) => ({
    dia: i + 1,
    diaSemana: fechaHoraArgentina(`${ymd(anio, mes, i + 1)}T12:00:00-03:00`).diaSemanaISO,
    vendido: i + 1 <= diaDeHoy ? vendido : null,
  }));
  const conVenta = porDia.filter((d) => d.vendido !== null && d.vendido > 0);
  const mejorDia = conVenta.length ? conVenta.reduce((a, b) => ((b.vendido ?? 0) > (a.vendido ?? 0) ? b : a)) : null;
  // El promedio deja afuera hoy (el día no terminó) y los días sin venta (el
  // local cerrado no es un día malo).
  const cerrados = conVenta.filter((d) => d.dia < diaDeHoy);
  const promedioDiario = cerrados.length ? cerrados.reduce((a, d) => a + (d.vendido ?? 0), 0) / cerrados.length : null;

  // Horas y días: ventana de 8 semanas.
  const ventana = ventasAR.filter((v) => v.fecha >= hace56);
  const horas = new Map<number, number>();
  const semana = new Array<number>(7).fill(0);
  for (const v of ventana) {
    horas.set(v.hora, (horas.get(v.hora) ?? 0) + v.neto);
    semana[v.diaSemana - 1] += v.neto;
  }
  // Siempre el horario del local completo (9 a 21), más cualquier hora suelta
  // en la que se haya vendido fuera de eso.
  const horasConVenta = [...horas.keys()];
  const primera = Math.min(9, ...horasConVenta);
  const ultima = Math.max(21, ...horasConVenta);
  const porHora: { hora: number; vendido: number }[] = [];
  for (let h = primera; h <= ultima; h++) porHora.push({ hora: h, vendido: horas.get(h) ?? 0 });
  const conHora = porHora.filter((h) => h.vendido > 0);
  const horaPico = conHora.length ? conHora.reduce((a, b) => (b.vendido > a.vendido ? b : a)).hora : null;
  const porDiaSemana = DIAS_SEMANA.map((etiqueta, i) => ({ etiqueta, vendido: semana[i] }));
  const diaSemanaPico = porDiaSemana.some((d) => d.vendido > 0)
    ? porDiaSemana.reduce((a, b) => (b.vendido > a.vendido ? b : a)).etiqueta
    : null;

  // ---------- Lo que suma renglones ----------
  type PorMarca = { hoy: number; vendido: number; unidades: number; tickets: Set<string>; anterior: number };
  const porMarca = new Map<string, PorMarca>();
  const porVariante = new Map<string, { idMarca: string; vendido: number; unidades: number }>();
  let unidadesMes = 0;
  let comisionMarcas = 0;
  for (const r of renglones) {
    const venta = ventaPorId.get(r.id_venta);
    if (!venta || venta.mesDe === "otro" || !r.id_marca) continue;
    const neto = netearRenglon(r.cantidad, r.subtotal ?? (r.precio_unitario ?? 0) * (r.cantidad ?? 0), devPorRenglon.get(r.id_detalle));
    const m = porMarca.get(r.id_marca) ?? { hoy: 0, vendido: 0, unidades: 0, tickets: new Set<string>(), anterior: 0 };
    if (venta.mesDe === "anterior") {
      if (venta.dia <= diaDeHoy) m.anterior += neto.subtotal;
      porMarca.set(r.id_marca, m);
      continue;
    }
    m.vendido += neto.subtotal;
    m.unidades += neto.cantidad;
    if (neto.subtotal > 0) m.tickets.add(r.id_venta);
    if (venta.fecha === hoyISO) m.hoy += neto.subtotal;
    porMarca.set(r.id_marca, m);
    unidadesMes += neto.cantidad;

    if (r.id_variante) {
      const p = porVariante.get(r.id_variante) ?? { idMarca: r.id_marca, vendido: 0, unidades: 0 };
      p.vendido += neto.subtotal;
      p.unidades += neto.cantidad;
      porVariante.set(r.id_variante, p);
    }

    // Comisión de WiiGo: misma cuenta que el Dashboard (royalty más su IVA
    // cuando se traslada, salvo en efectivo si la marca lo eximió).
    const marca = marcaPorId.get(r.id_marca);
    if (marca?.tipo_comercializacion === "CONSIGNACION") {
      const comision = neto.subtotal * ((marca.royalty_porcentaje ?? 0) / 100);
      const sinIva = venta.efectivo && (marca.trasladar_iva_comision_efectivo ?? true) === false;
      comisionMarcas += comision + (marca.trasladar_iva_comision && !sinIva ? comision * ((marca.iva_royalty_porcentaje ?? 0) / 100) : 0);
    }
  }
  const sumaMarcas = [...porMarca.values()].reduce((a, m) => a + m.vendido, 0);

  // Todas las marcas activas, aunque no hayan vendido: que una marca esté en
  // cero también es un dato.
  const filasMarca = marcas
    .filter((m) => m.estado === "ACTIVA" || porMarca.get(m.id_marca as string)?.vendido)
    .map((m) => {
      const x = porMarca.get(m.id_marca as string);
      const vendido = Math.round(x?.vendido ?? 0);
      return {
        idMarca: m.id_marca as string,
        nombre: m.nombre as string,
        propia: m.tipo_comercializacion === "PROPIA",
        sinProductos: !conProductos.has(m.id_marca as string),
        hoy: Math.round(x?.hoy ?? 0),
        vendido,
        parte: sumaMarcas > 0 ? vendido / sumaMarcas : 0,
        unidades: x?.unidades ?? 0,
        ticketPromedio: x && x.tickets.size > 0 ? Math.round(x.vendido / x.tickets.size) : null,
        variacion: x && x.anterior > 0 ? Math.round((x.vendido / x.anterior - 1) * 100) : null,
      };
    })
    .sort((a, b) => b.vendido - a.vendido || a.nombre.localeCompare(b.nombre, "es"));

  // Productos: los 8 que más facturaron, con el nombre de la variante si la tiene.
  const top = [...porVariante.entries()].filter(([, p]) => p.vendido > 0).sort((a, b) => b[1].vendido - a[1].vendido).slice(0, 8);
  let productos: InicioDueno["productos"] = [];
  if (top.length) {
    const { data: vars } = await supabase.from("variantes_producto").select("id_variante, id_producto, nombre").in("id_variante", top.map(([id]) => id));
    const { data: prods } = await supabase
      .from("productos")
      .select("id_producto, nombre")
      .in("id_producto", [...new Set((vars ?? []).map((v) => v.id_producto as string))]);
    const varPorId = new Map((vars ?? []).map((v) => [v.id_variante as string, v]));
    const prodPorId = new Map((prods ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
    productos = top.map(([idVariante, p]) => {
      const v = varPorId.get(idVariante);
      const base = (v && prodPorId.get(v.id_producto as string)) ?? "Producto";
      const variante = v?.nombre && v.nombre !== "Único" ? ` — ${v.nombre}` : "";
      return {
        nombre: base + variante,
        marca: (marcaPorId.get(p.idMarca)?.nombre as string) ?? "",
        idMarca: p.idMarca,
        vendido: Math.round(p.vendido),
        unidades: p.unidades,
      };
    });
  }

  return {
    mesNombre: MESES[mes - 1],
    mesAnteriorNombre: MESES[mesAnt - 1],
    diaDeHoy,
    diasDelMes,
    vendidoMes: Math.round(vendidoMes),
    proyeccion: diaDeHoy >= 5 && vendidoMes > 0 ? Math.round((vendidoMes / diaDeHoy) * diasDelMes) : null,
    vendidoMesAnteriorTramo: Math.round(vendidoMesAnteriorTramo),
    acumuladoMes: acumular(diario.slice(0, diaDeHoy)).map(Math.round),
    acumuladoMesAnterior: acumular(diarioAnt).map(Math.round),
    hoy: { vendido: Math.round(deHoy.reduce((a, v) => a + v.neto, 0)), tickets: deHoy.length },
    ticketPromedio: delMes.length ? Math.round(vendidoMes / delMes.length) : 0,
    unidadesMes,
    ticketsMes: delMes.length,
    comisionMarcas: Math.round(comisionMarcas),
    parteEfectivo: vendidoMes > 0 ? efectivoMes / vendidoMes : null,
    porDia,
    mejorDia: mejorDia ? { dia: mejorDia.dia, diaSemana: mejorDia.diaSemana, vendido: Math.round(mejorDia.vendido ?? 0) } : null,
    promedioDiario: promedioDiario === null ? null : Math.round(promedioDiario),
    porHora: porHora.map((h) => ({ hora: h.hora, vendido: Math.round(h.vendido) })),
    horaPico,
    porDiaSemana: porDiaSemana.map((d) => ({ etiqueta: d.etiqueta, vendido: Math.round(d.vendido) })),
    diaSemanaPico,
    marcas: filasMarca,
    productos,
  };
}
