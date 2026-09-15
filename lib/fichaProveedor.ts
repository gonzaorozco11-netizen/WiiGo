import { getSupabaseServerClient } from "@/lib/supabase";
import { saldoCuentaProveedor, historialCuentaProveedor } from "@/lib/cuentaProveedor";

// La ficha de un proveedor: todo lo suyo en una pantalla.
//
// Solo lee. Junta lo que hoy está repartido en tres lugares — las entregas
// viven en Recepción, su costo en Costeo y la deuda en Proveedores — porque
// cuando hay que discutir con el proveedor se necesitan las tres cosas juntas
// y no se puede ir saltando de pantalla con el tipo del otro lado del teléfono.

export type EntregaProveedor = {
  idRecepcion: string;
  idOrden: string;
  fechaPedido: string | null;
  fechaRecibida: string;
  numeroEntrega: number;
  totalEntregas: number;
  unidades: number;
  /** null cuando todavía no se costeó. */
  costo: number | null;
  numeroFactura: string | null;
  estadoOrden: string;
  facturada: boolean;
  diasSinCostear: number;
  lineas: { nombre: string; cantidad: number; costoUnitario: number | null }[];
};

export type ProductoDelProveedor = {
  idVariante: string;
  nombre: string;
  unidadesCompradas: number;
  costoHoy: number | null;
  costoAntes: number | null;
  enGondola: number;
};

export type MovimientoCuenta = {
  id: string;
  fecha: string;
  tipo: string;
  importe: number;
  saldo: number;
  observaciones: string | null;
};

export type FichaProveedor = {
  idProveedor: string;
  nombre: string;
  cuit: string | null;
  contacto: string | null;
  telefono: string | null;
  modoFacturacion: string;
  condicionPagoDias: number | null;
  saldo: number;
  entregas: EntregaProveedor[];
  productos: ProductoDelProveedor[];
  movimientos: MovimientoCuenta[];
  totalComprado: number;
  totalUnidades: number;
  vendidoSinLiquidar: number;
  /** Solo tiene contenido con proveedores por liquidación (caso Alifrut). */
  liquidaciones: LiquidacionDeFicha[];
};

export type LiquidacionDeFicha = {
  idLiquidacion: string;
  fechaDesde: string;
  fechaHasta: string;
  montoFinal: number;
  unidades: number;
  unidadesMerma: number;
  /** null = el proveedor todavía no emitió su factura. Es IVA parado. */
  facturaNumero: string | null;
  /** Cuánto lleva esperando esa factura. */
  diasDesde: number;
};

function dias(iso: string) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export async function fichaDeProveedor(idProveedor: string, meses = 3): Promise<FichaProveedor | null> {
  const supabase = getSupabaseServerClient();

  const { data: proveedor } = await supabase
    .from("proveedores")
    .select("id_proveedor, nombre, cuit, contacto, telefono, modo_facturacion, condicion_pago_dias")
    .eq("id_proveedor", idProveedor)
    .maybeSingle();
  if (!proveedor) return null;

  const desde = new Date();
  desde.setMonth(desde.getMonth() - meses);
  const desdeISO = desde.toISOString();

  const [recepRes, productosRes, saldo, historial] = await Promise.all([
    supabase
      .from("recepciones_proveedor")
      .select("id_recepcion, id_orden, fecha, facturada, id_factura")
      .eq("id_proveedor", idProveedor)
      .gte("fecha", desdeISO)
      .order("fecha", { ascending: false })
      .limit(200),
    supabase
      .from("productos")
      .select("id_producto, nombre, costo_informado")
      .eq("id_proveedor_liquidacion", idProveedor),
    saldoCuentaProveedor(supabase, idProveedor),
    historialCuentaProveedor(supabase, idProveedor),
  ]);

  const recepciones = recepRes.data ?? [];
  const idsRecepcion = recepciones.map((r) => r.id_recepcion as string);
  const idsOrden = Array.from(new Set(recepciones.map((r) => r.id_orden as string).filter(Boolean)));
  const idsFactura = Array.from(
    new Set(recepciones.map((r) => r.id_factura as string | null).filter((x): x is string => Boolean(x)))
  );

  const [lineasRes, ordenesRes, facturasRes, variantesRes, stockRes] = await Promise.all([
    idsRecepcion.length
      ? supabase
          .from("detalle_recepcion_proveedor")
          .select("id_recepcion, id_variante, cantidad_recibida, costo_unitario")
          .in("id_recepcion", idsRecepcion)
      : Promise.resolve({ data: [] }),
    idsOrden.length
      ? supabase
          .from("ordenes_compra_proveedor")
          .select("id_orden, fecha_alta, estado")
          .in("id_orden", idsOrden)
      : Promise.resolve({ data: [] }),
    idsFactura.length
      ? supabase
          .from("facturas_compra_proveedor")
          .select("id_factura, numero_factura")
          .in("id_factura", idsFactura)
      : Promise.resolve({ data: [] }),
    (productosRes.data ?? []).length
      ? supabase
          .from("variantes_producto")
          .select("id_variante, id_producto, nombre")
          .in(
            "id_producto",
            (productosRes.data ?? []).map((p) => p.id_producto as string)
          )
      : Promise.resolve({ data: [] }),
    supabase.from("stock").select("id_variante, cantidad"),
  ]);

  const ordenPorId = new Map(
    (ordenesRes.data ?? []).map((o) => [
      o.id_orden as string,
      { fecha: o.fecha_alta as string, estado: (o.estado as string) ?? "" },
    ])
  );
  const facturaPorId = new Map(
    (facturasRes.data ?? []).map((f) => [f.id_factura as string, (f.numero_factura as string | null) ?? null])
  );
  const productoPorId = new Map((productosRes.data ?? []).map((p) => [p.id_producto as string, p]));
  const nombrePorVariante = new Map(
    (variantesRes.data ?? []).map((v) => {
      const p = productoPorId.get(v.id_producto as string);
      const base = (p?.nombre as string) ?? "Producto";
      return [v.id_variante as string, v.nombre !== "Único" ? `${base} — ${v.nombre}` : base];
    })
  );
  const stockPorVariante = new Map<string, number>();
  for (const s of stockRes.data ?? []) {
    const id = s.id_variante as string;
    stockPorVariante.set(id, (stockPorVariante.get(id) ?? 0) + ((s.cantidad as number) ?? 0));
  }

  // Numerar las entregas de cada pedido: "2ª de 3". Se cuenta sobre lo que
  // trajo esta consulta, así que un pedido más viejo que el corte podría
  // numerarse distinto — no vale la pena traer todo el histórico por eso.
  const porOrden = new Map<string, string[]>();
  for (const r of [...recepciones].sort((a, b) => (a.fecha as string).localeCompare(b.fecha as string))) {
    const lista = porOrden.get(r.id_orden as string) ?? [];
    lista.push(r.id_recepcion as string);
    porOrden.set(r.id_orden as string, lista);
  }

  const lineasPorRecepcion = new Map<string, typeof lineasRes.data>();
  for (const l of lineasRes.data ?? []) {
    const id = l.id_recepcion as string;
    const lista = lineasPorRecepcion.get(id) ?? [];
    lista.push(l);
    lineasPorRecepcion.set(id, lista);
  }

  const entregas: EntregaProveedor[] = recepciones.map((r) => {
    const lineas = lineasPorRecepcion.get(r.id_recepcion as string) ?? [];
    const unidades = lineas.reduce((a, l) => a + ((l.cantidad_recibida as number) ?? 0), 0);
    const conCosto = lineas.filter((l) => (l.costo_unitario as number | null) != null);
    const costo = conCosto.length
      ? conCosto.reduce((a, l) => a + ((l.costo_unitario as number) ?? 0) * ((l.cantidad_recibida as number) ?? 0), 0)
      : null;
    const hermanas = porOrden.get(r.id_orden as string) ?? [];
    const orden = ordenPorId.get(r.id_orden as string);
    return {
      idRecepcion: r.id_recepcion as string,
      idOrden: r.id_orden as string,
      fechaPedido: orden?.fecha ?? null,
      fechaRecibida: r.fecha as string,
      numeroEntrega: hermanas.indexOf(r.id_recepcion as string) + 1,
      totalEntregas: hermanas.length,
      unidades,
      costo,
      numeroFactura: r.id_factura ? facturaPorId.get(r.id_factura as string) ?? null : null,
      estadoOrden: orden?.estado ?? "",
      facturada: Boolean(r.facturada),
      diasSinCostear: r.facturada ? 0 : dias(r.fecha as string),
      lineas: lineas.map((l) => ({
        nombre: nombrePorVariante.get(l.id_variante as string) ?? "Producto",
        cantidad: (l.cantidad_recibida as number) ?? 0,
        costoUnitario: (l.costo_unitario as number | null) ?? null,
      })),
    };
  });

  // ---------- Qué le comprás ----------
  //
  // El costo "de antes" es el del lote más nuevo anterior a 30 días. Comparar
  // contra el promedio de todo escondería justamente lo que se quiere ver: si
  // te aumentó en la última entrega.
  const corte = new Date();
  corte.setDate(corte.getDate() - 30);
  const corteISO = corte.toISOString();
  const fechaPorRecepcion = new Map(recepciones.map((r) => [r.id_recepcion as string, r.fecha as string]));

  const acum = new Map<string, { unidades: number; antes: { fecha: string; costo: number } | null }>();
  for (const l of lineasRes.data ?? []) {
    const idVariante = l.id_variante as string;
    const previo = acum.get(idVariante) ?? { unidades: 0, antes: null };
    previo.unidades += (l.cantidad_recibida as number) ?? 0;
    const fecha = fechaPorRecepcion.get(l.id_recepcion as string) ?? "";
    const costo = l.costo_unitario as number | null;
    if (costo != null && fecha && fecha < corteISO && (!previo.antes || fecha > previo.antes.fecha)) {
      previo.antes = { fecha, costo };
    }
    acum.set(idVariante, previo);
  }

  const productos: ProductoDelProveedor[] = [...acum.entries()]
    .map(([idVariante, d]) => {
      const nombre = nombrePorVariante.get(idVariante);
      if (!nombre) return null;
      const idProducto = (variantesRes.data ?? []).find((v) => v.id_variante === idVariante)?.id_producto as
        | string
        | undefined;
      return {
        idVariante,
        nombre,
        unidadesCompradas: d.unidades,
        costoHoy: idProducto
          ? ((productoPorId.get(idProducto)?.costo_informado as number | null) ?? null)
          : null,
        costoAntes: d.antes?.costo ?? null,
        enGondola: stockPorVariante.get(idVariante) ?? 0,
      };
    })
    .filter((p): p is ProductoDelProveedor => p !== null)
    .sort((a, b) => b.unidadesCompradas - a.unidadesCompradas);

  // ---------- Vendido sin liquidar ----------
  const idsVariante = [...nombrePorVariante.keys()];
  let vendidoSinLiquidar = 0;
  if (idsVariante.length > 0) {
    const { data } = await supabase
      .from("detalle_ventas")
      .select("id_variante, cantidad")
      .in("id_variante", idsVariante)
      .is("id_liquidacion_proveedor", null);
    const costoPorVariante = new Map(productos.map((p) => [p.idVariante, p.costoHoy ?? 0]));
    for (const d of data ?? []) {
      vendidoSinLiquidar +=
        ((d.cantidad as number) ?? 0) * (costoPorVariante.get(d.id_variante as string) ?? 0);
    }
  }

  // ---------- Liquidaciones ----------
  const { data: liqRes } = await supabase
    .from("liquidaciones_proveedor")
    .select("id_liquidacion, fecha_desde, fecha_hasta, fecha, monto_final, factura_numero")
    .eq("id_proveedor", idProveedor)
    .order("fecha_hasta", { ascending: false })
    .limit(24);

  const idsLiq = (liqRes ?? []).map((l) => l.id_liquidacion as string);
  const [detLiqRes, mermasLiqRes] = idsLiq.length
    ? await Promise.all([
        supabase
          .from("detalle_liquidacion_proveedor")
          .select("id_liquidacion, cantidad_vendida")
          .in("id_liquidacion", idsLiq),
        supabase
          .from("mermas")
          .select("id_liquidacion_proveedor, cantidad")
          .in("id_liquidacion_proveedor", idsLiq),
      ])
    : [{ data: [] as Record<string, unknown>[] }, { data: [] as Record<string, unknown>[] }];

  const unidadesLiq = new Map<string, number>();
  for (const d of detLiqRes.data ?? []) {
    const id = d.id_liquidacion as string;
    unidadesLiq.set(id, (unidadesLiq.get(id) ?? 0) + ((d.cantidad_vendida as number) ?? 0));
  }
  const mermaLiq = new Map<string, number>();
  for (const m of mermasLiqRes.data ?? []) {
    const id = m.id_liquidacion_proveedor as string;
    mermaLiq.set(id, (mermaLiq.get(id) ?? 0) + ((m.cantidad as number) ?? 0));
  }

  const liquidaciones: LiquidacionDeFicha[] = (liqRes ?? []).map((l) => {
    const id = l.id_liquidacion as string;
    return {
      idLiquidacion: id,
      fechaDesde: l.fecha_desde as string,
      fechaHasta: l.fecha_hasta as string,
      montoFinal: (l.monto_final as number) ?? 0,
      unidades: unidadesLiq.get(id) ?? 0,
      unidadesMerma: mermaLiq.get(id) ?? 0,
      facturaNumero: (l.factura_numero as string | null) ?? null,
      diasDesde: dias((l.fecha as string) ?? (l.fecha_hasta as string)),
    };
  });

  return {
    idProveedor,
    nombre: proveedor.nombre as string,
    cuit: (proveedor.cuit as string | null) ?? null,
    contacto: (proveedor.contacto as string | null) ?? null,
    telefono: (proveedor.telefono as string | null) ?? null,
    modoFacturacion: (proveedor.modo_facturacion as string) ?? "REMITO",
    condicionPagoDias: (proveedor.condicion_pago_dias as number | null) ?? null,
    saldo,
    entregas,
    productos,
    movimientos: (historial ?? []).slice(0, 60).map((m) => ({
      id: m.id_movimiento as string,
      fecha: m.fecha as string,
      tipo: (m.tipo_movimiento as string) ?? "",
      importe: (m.importe as number) ?? 0,
      saldo: (m.saldo_nuevo as number) ?? 0,
      observaciones: (m.observaciones as string | null) ?? null,
    })),
    totalComprado: entregas.reduce((a, e) => a + (e.costo ?? 0), 0),
    totalUnidades: entregas.reduce((a, e) => a + e.unidades, 0),
    vendidoSinLiquidar,
    liquidaciones,
  };
}
