import { getSupabaseServerClient } from "@/lib/supabase";
import { listarProveedores, listarMarcasParaProveedores } from "@/app/(app)/proveedores/actions";
import { construirLineas } from "@/app/(app)/liquidaciones/actions";
import { listarMermas } from "@/lib/mermas";

// La vista de arriba de Marcas y Proveedores.
//
// No calcula nada nuevo: junta lo que ya existe repartido en cinco pantallas.
// La única parte que no se puede ver hoy en ningún lado son los vencimientos
// — las facturas guardan su fecha desde siempre y nunca se mostró.

export type VencimientoFactura = {
  idFactura: string;
  proveedor: string;
  numero: string | null;
  tipoComprobante: string | null;
  vencimiento: string;
  monto: number;
  /** Negativo = ya venció. */
  dias: number;
};

export type LineaCompra = {
  idProveedor: string;
  nombre: string;
  costo: number;
  unidades: number;
  entregas: number;
  merma: number;
};

export type LineaMarca = {
  idMarca: string;
  nombre: string;
  royalty: number;
  plan: string;
  /** Lo que WiiGo se queda: comisión + IVA de la comisión. */
  teQueda: number;
  ventaBruta: number;
};

export type PanelProveedores = {
  desde: string;
  hasta: string;
  /** Lo que le debés a proveedores, abierto por quién. */
  sale: { total: number; detalle: { nombre: string; monto: number; nota: string }[] };
  /** Lo que te deben las marcas. */
  entra: { total: number; detalle: { nombre: string; monto: number; nota: string }[] };
  vencimientos: VencimientoFactura[];
  vencido: number;
  estaSemana: number;
  masAdelante: number;
  trabas: {
    sinCostear: number;
    sinCostearDiasMax: number;
    liqSinFactura: number;
    liqSinFacturaIva: number;
    reclamos: number;
    reclamosMonto: number;
    solicitudes: number;
  };
  compras: LineaCompra[];
  marcas: LineaMarca[];
};

function dias(iso: string) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Math.round((d.getTime() - hoy.getTime()) / 86400000);
}

function r2(v: number) {
  return Math.round(v * 100) / 100;
}

export async function armarPanelProveedores(desde: string, hasta: string): Promise<PanelProveedores> {
  const supabase = getSupabaseServerClient();

  const [proveedores, marcasEnLista] = await Promise.all([listarProveedores(), listarMarcasParaProveedores()]);
  const nombreProveedor = new Map(proveedores.map((p) => [p.id_proveedor, p.nombre]));

  // ---------- Las dos direcciones ----------
  // Con liquidación por venta el saldo formal es $0 hasta que se liquida, así
  // que lo pendiente de liquidar cuenta como plata que va a salir: si no, un
  // proveedor al que le vendiste medio depósito aparece en cero.
  const sale = proveedores
    .map((p) => ({
      nombre: p.nombre,
      monto: r2(Math.max(p.saldo, 0) + (p.vendidoSinLiquidar ?? 0)),
      nota:
        p.saldo > 0
          ? p.condicion_pago_dias
            ? `${p.condicion_pago_dias} días`
            : "contado"
          : "sin liquidar",
    }))
    .filter((p) => p.monto > 0)
    .sort((a, b) => b.monto - a.monto);

  const entra = marcasEnLista
    .map((m) => ({ nombre: m.nombre, monto: r2(Math.max(m.saldo, 0)), nota: `royalty ${m.royalty}%` }))
    .filter((m) => m.monto > 0)
    .sort((a, b) => b.monto - a.monto);

  // ---------- Vencimientos ----------
  // Lo único del panel que no se puede ver hoy en ninguna pantalla: la fecha
  // está guardada en cada factura desde que se carga y nunca se mostró.
  const { data: facturas } = await supabase
    .from("facturas_compra_proveedor")
    .select("id_factura, id_proveedor, numero_factura, tipo_comprobante, fecha_vencimiento, monto, estado")
    .in("estado", ["PENDIENTE", "PARCIAL"])
    .not("fecha_vencimiento", "is", null)
    .order("fecha_vencimiento", { ascending: true })
    .limit(40);

  const vencimientos: VencimientoFactura[] = (facturas ?? []).map((f) => ({
    idFactura: f.id_factura as string,
    proveedor: nombreProveedor.get(f.id_proveedor as string) ?? "Proveedor",
    numero: (f.numero_factura as string | null) ?? null,
    tipoComprobante: (f.tipo_comprobante as string | null) ?? null,
    vencimiento: f.fecha_vencimiento as string,
    monto: (f.monto as number) ?? 0,
    dias: dias(f.fecha_vencimiento as string),
  }));

  const vencido = r2(vencimientos.filter((v) => v.dias < 0).reduce((a, v) => a + v.monto, 0));
  const estaSemana = r2(vencimientos.filter((v) => v.dias >= 0 && v.dias <= 7).reduce((a, v) => a + v.monto, 0));
  const masAdelante = r2(vencimientos.filter((v) => v.dias > 7).reduce((a, v) => a + v.monto, 0));

  // ---------- Lo trabado ----------
  const [sinCostearRes, liqRes, reclamosRes, solicitudesRes] = await Promise.all([
    supabase.from("recepciones_proveedor").select("fecha").eq("facturada", false).limit(100),
    supabase.from("liquidaciones_proveedor").select("monto_final").is("factura_numero", null).limit(50),
    supabase.from("reclamos_proveedor").select("total").eq("estado", "PENDIENTE").limit(100),
    supabase
      .from("solicitudes_marca")
      .select("id_solicitud", { count: "exact", head: true })
      .eq("estado", "PENDIENTE"),
  ]);

  const sinCostearFilas = sinCostearRes.data ?? [];
  const liqFilas = liqRes.data ?? [];
  const liqTotal = liqFilas.reduce((a, l) => a + ((l.monto_final as number) ?? 0), 0);

  const trabas = {
    sinCostear: sinCostearFilas.length,
    sinCostearDiasMax: sinCostearFilas.reduce((max, r) => Math.max(max, -dias(r.fecha as string)), 0),
    liqSinFactura: liqFilas.length,
    // Orden de magnitud con la alícuota general, para que se entienda qué hay
    // en juego. El número exacto sale de cada factura cuando el proveedor la
    // emite — acá todavía no existe.
    liqSinFacturaIva: Math.round(liqTotal - liqTotal / 1.21),
    reclamos: (reclamosRes.data ?? []).length,
    reclamosMonto: r2((reclamosRes.data ?? []).reduce((a, r) => a + ((r.total as number) ?? 0), 0)),
    solicitudes: solicitudesRes.count ?? 0,
  };

  // ---------- A quién le comprás ----------
  // Por lo COSTEADO en el período y no por lo pedido: una orden sin recibir
  // todavía no le costó plata a nadie.
  const [{ data: recepciones }, { mermas }] = await Promise.all([
    supabase
      .from("recepciones_proveedor")
      .select("id_recepcion, id_proveedor")
      .gte("fecha", `${desde}T00:00:00`)
      .lte("fecha", `${hasta}T23:59:59`),
    listarMermas({ desde, hasta }),
  ]);

  const idsRecepcion = (recepciones ?? []).map((r) => r.id_recepcion as string);
  const { data: lineas } = idsRecepcion.length
    ? await supabase
        .from("detalle_recepcion_proveedor")
        .select("id_recepcion, cantidad_recibida, costo_unitario")
        .in("id_recepcion", idsRecepcion)
    : { data: [] as Record<string, unknown>[] };

  const provDeRecepcion = new Map((recepciones ?? []).map((r) => [r.id_recepcion as string, r.id_proveedor as string]));
  const acumCompras = new Map<string, { costo: number; unidades: number; entregas: Set<string> }>();
  for (const l of lineas ?? []) {
    const idProv = provDeRecepcion.get(l.id_recepcion as string);
    if (!idProv) continue;
    const acc = acumCompras.get(idProv) ?? { costo: 0, unidades: 0, entregas: new Set<string>() };
    acc.costo += ((l.costo_unitario as number) ?? 0) * ((l.cantidad_recibida as number) ?? 0);
    acc.unidades += (l.cantidad_recibida as number) ?? 0;
    acc.entregas.add(l.id_recepcion as string);
    acumCompras.set(idProv, acc);
  }

  const mermaPorProveedor = new Map<string, number>();
  for (const m of mermas) {
    if (m.duenio !== "LIQUIDACION") continue;
    const id = [...nombreProveedor.entries()].find(([, n]) => n === m.deQuien)?.[0];
    if (!id) continue;
    mermaPorProveedor.set(id, (mermaPorProveedor.get(id) ?? 0) + (m.costoTotal ?? 0));
  }

  const compras: LineaCompra[] = [...acumCompras.entries()]
    .map(([idProveedor, a]) => ({
      idProveedor,
      nombre: nombreProveedor.get(idProveedor) ?? "Proveedor",
      costo: r2(a.costo),
      unidades: a.unidades,
      entregas: a.entregas.size,
      merma: r2(mermaPorProveedor.get(idProveedor) ?? 0),
    }))
    .sort((a, b) => b.costo - a.costo);

  // ---------- Qué te deja cada marca ----------
  const { data: ventasPeriodo } = await supabase
    .from("ventas")
    .select("id_venta, numero, fecha, medio_pago, id_pago")
    .eq("estado", "PAGADA")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);

  const marcas: LineaMarca[] = await Promise.all(
    marcasEnLista.map(async (m) => {
      const base = { idMarca: m.idMarca, nombre: m.nombre, royalty: m.royalty, plan: m.plan };
      const { data: detalle } = await supabase
        .from("detalle_ventas")
        .select("id_venta")
        .eq("id_marca", m.idMarca);
      const idsDeLaMarca = new Set((detalle ?? []).map((d) => d.id_venta as string));
      const suyas = (ventasPeriodo ?? []).filter((v) => idsDeLaMarca.has(v.id_venta as string));
      if (suyas.length === 0) return { ...base, teQueda: 0, ventaBruta: 0 };

      const { resumen } = await construirLineas(supabase, m.idMarca, suyas);
      return {
        ...base,
        teQueda: r2(resumen.comisionWiigo + resumen.ivaComision),
        ventaBruta: r2(resumen.ventaBruta),
      };
    })
  );
  marcas.sort((a, b) => b.teQueda - a.teQueda || a.nombre.localeCompare(b.nombre));

  return {
    desde,
    hasta,
    sale: { total: r2(sale.reduce((a, p) => a + p.monto, 0)), detalle: sale },
    entra: { total: r2(entra.reduce((a, m) => a + m.monto, 0)), detalle: entra },
    vencimientos,
    vencido,
    estaSemana,
    masAdelante,
    trabas,
    compras,
    marcas,
  };
}
