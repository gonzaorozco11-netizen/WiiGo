import { getSupabaseServerClient } from "@/lib/supabase";

// La ficha de un producto: de dónde salió cada unidad y a dónde fue.
//
// Solo lee. No escribe nada, no cambia ningún estado y no toca el FIFO — es
// la foto de lo que ya pasó, para poder mostrársela al proveedor cuando los
// números no coinciden.
//
// Dos decisiones que vale la pena entender antes de tocar esto:
//
// 1. **El saldo se reconstruye hacia atrás.** Se arranca del stock de hoy
//    (que es la verdad) y se van deshaciendo los movimientos del más nuevo al
//    más viejo. Sumar desde cero para adelante daría otro número si alguna
//    vez un movimiento no quedó registrado, y el renglón de arriba —el que
//    la gente mira— dejaría de coincidir con la góndola. Es el mismo criterio
//    que usa lib/cobertura.ts.
//
// 2. **Lo que queda de cada lote se calcula acá, no se lee.** El sistema
//    descuenta `cantidad_disponible_fifo` recién al generar la liquidación,
//    no al vender. Leerlo crudo diría que el lote viejo sigue entero cuando
//    ya se vendió — justo el número que se le va a mostrar al proveedor.

export type MovimientoFicha = {
  id: string;
  fecha: string;
  tipo: string;
  motivo: string | null;
  usuario: string | null;
  cantidad: number;
  /** Cuánto había quedado en góndola después de este movimiento. */
  saldo: number;
};

export type LoteFicha = {
  idDetalle: string;
  fecha: string;
  idOrden: string | null;
  cantidad: number;
  costoUnitario: number | null;
  /** Calculado en vivo contra las ventas, no leído de la base. */
  quedan: number;
  /** Ya entró en una liquidación cerrada: su costo no se toca más. */
  liquidado: boolean;
};

export type FichaProducto = {
  idVariante: string;
  nombre: string;
  marca: string | null;
  proveedor: string | null;
  local: string | null;
  ivaPorcentaje: number;
  stockActual: number;
  costoActual: number | null;
  /** Stock por el costo del lote al que pertenece cada unidad. */
  valorEnGondola: number;
  vendidasEnElPeriodo: number;
  lotes: LoteFicha[];
  movimientos: MovimientoFicha[];
  /** Solo tiene sentido con proveedores propios; con marcas queda vacío. */
  resumenProveedor: {
    entregadas: number;
    vendidas: number;
    quedan: number;
    liquidado: number;
    faltaLiquidar: number;
  } | null;
};

export async function fichaDeProducto(
  idVariante: string,
  desde: string,
  hasta: string
): Promise<FichaProducto | null> {
  const supabase = getSupabaseServerClient();

  const { data: variante } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .eq("id_variante", idVariante)
    .maybeSingle();
  if (!variante) return null;

  const { data: producto } = await supabase
    .from("productos")
    .select("nombre, id_marca, id_proveedor_liquidacion, costo_informado, iva_porcentaje")
    .eq("id_producto", variante.id_producto as string)
    .maybeSingle();
  if (!producto) return null;

  const [marcaRes, proveedorRes, stockRes, movRes, lotesRes] = await Promise.all([
    producto.id_marca
      ? supabase.from("marcas").select("nombre").eq("id_marca", producto.id_marca as string).maybeSingle()
      : Promise.resolve({ data: null }),
    producto.id_proveedor_liquidacion
      ? supabase
          .from("proveedores")
          .select("nombre")
          .eq("id_proveedor", producto.id_proveedor_liquidacion as string)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("stock").select("id_local, cantidad").eq("id_variante", idVariante),
    // Todos los movimientos, del más nuevo al más viejo: el saldo se
    // reconstruye desde el stock de hoy hacia atrás.
    supabase
      .from("movimientos_stock")
      .select("id_movimiento, fecha, tipo, cantidad, motivo, usuario")
      .eq("id_variante", idVariante)
      .order("fecha", { ascending: false })
      .limit(400),
    supabase
      .from("detalle_recepcion_proveedor")
      .select("id_detalle, id_recepcion, cantidad_recibida, costo_unitario")
      .eq("id_variante", idVariante),
  ]);

  const stockActual = (stockRes.data ?? []).reduce((a, s) => a + ((s.cantidad as number) ?? 0), 0);
  const localNombre = null;

  // ---------- Movimientos, con el saldo hacia atrás ----------
  const movimientos: MovimientoFicha[] = [];
  let saldo = stockActual;
  for (const m of movRes.data ?? []) {
    movimientos.push({
      id: m.id_movimiento as string,
      fecha: m.fecha as string,
      tipo: (m.tipo as string) ?? "",
      motivo: (m.motivo as string | null) ?? null,
      usuario: (m.usuario as string | null) ?? null,
      cantidad: (m.cantidad as number) ?? 0,
      saldo,
    });
    // Deshacer este movimiento da el saldo que había ANTES, que es el que le
    // corresponde al siguiente de la lista (más viejo).
    saldo -= (m.cantidad as number) ?? 0;
  }

  // ---------- Lotes, con lo que queda calculado en vivo ----------
  const idsLote = (lotesRes.data ?? []).map((l) => l.id_detalle as string);
  const liquidados = new Set<string>();
  if (idsLote.length > 0) {
    const { data } = await supabase
      .from("detalle_liquidacion_proveedor")
      .select("id_detalle_recepcion")
      .in("id_detalle_recepcion", idsLote);
    (data ?? []).forEach((d) => liquidados.add(d.id_detalle_recepcion as string));
  }

  const recepciones = new Map<string, { fecha: string; idOrden: string | null }>();
  if ((lotesRes.data ?? []).length > 0) {
    const { data } = await supabase
      .from("recepciones_proveedor")
      .select("id_recepcion, fecha, id_orden")
      .in(
        "id_recepcion",
        (lotesRes.data ?? []).map((l) => l.id_recepcion as string)
      );
    (data ?? []).forEach((r) =>
      recepciones.set(r.id_recepcion as string, {
        fecha: r.fecha as string,
        idOrden: (r.id_orden as string | null) ?? null,
      })
    );
  }

  const lotesOrdenados = (lotesRes.data ?? [])
    .map((l) => ({
      idDetalle: l.id_detalle as string,
      cantidad: (l.cantidad_recibida as number) ?? 0,
      costoUnitario: (l.costo_unitario as number | null) ?? null,
      fecha: recepciones.get(l.id_recepcion as string)?.fecha ?? "",
      idOrden: recepciones.get(l.id_recepcion as string)?.idOrden ?? null,
    }))
    .filter((l) => l.cantidad > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Cuántas unidades se fueron en total (ventas, devoluciones al proveedor,
  // ajustes en menos). Es contra eso que se consumen los lotes, del más viejo
  // al más nuevo.
  const salidas = (movRes.data ?? []).reduce(
    (a, m) => a + Math.max(0, -((m.cantidad as number) ?? 0)),
    0
  );
  let porConsumir = salidas;
  const lotes: LoteFicha[] = lotesOrdenados.map((l) => {
    const consumido = Math.min(porConsumir, l.cantidad);
    porConsumir -= consumido;
    return {
      idDetalle: l.idDetalle,
      fecha: l.fecha,
      idOrden: l.idOrden,
      cantidad: l.cantidad,
      costoUnitario: l.costoUnitario,
      quedan: l.cantidad - consumido,
      liquidado: liquidados.has(l.idDetalle),
    };
  });

  const valorEnGondola = lotes.reduce((a, l) => a + l.quedan * (l.costoUnitario ?? 0), 0);

  // ---------- Lo del período elegido ----------
  const dentro = (iso: string) => iso >= `${desde}T00:00:00` && iso <= `${hasta}T23:59:59`;
  const vendidasEnElPeriodo = (movRes.data ?? [])
    .filter((m) => m.tipo === "VENTA" && dentro(m.fecha as string))
    .reduce((a, m) => a + Math.abs((m.cantidad as number) ?? 0), 0);

  const esDeProveedor = Boolean(producto.id_proveedor_liquidacion) && lotes.length > 0;
  const resumenProveedor = esDeProveedor
    ? {
        entregadas: lotes.reduce((a, l) => a + l.cantidad, 0),
        vendidas: salidas,
        quedan: lotes.reduce((a, l) => a + l.quedan, 0),
        liquidado: lotes
          .filter((l) => l.liquidado)
          .reduce((a, l) => a + (l.cantidad - l.quedan) * (l.costoUnitario ?? 0), 0),
        faltaLiquidar: lotes
          .filter((l) => !l.liquidado)
          .reduce((a, l) => a + (l.cantidad - l.quedan) * (l.costoUnitario ?? 0), 0),
      }
    : null;

  return {
    idVariante,
    nombre: `${producto.nombre as string}${variante.nombre !== "Único" ? ` — ${variante.nombre}` : ""}`,
    marca: (marcaRes.data as { nombre?: string } | null)?.nombre ?? null,
    proveedor: (proveedorRes.data as { nombre?: string } | null)?.nombre ?? null,
    local: localNombre,
    ivaPorcentaje: (producto.iva_porcentaje as number | null) ?? 21,
    stockActual,
    costoActual: (producto.costo_informado as number | null) ?? null,
    valorEnGondola,
    vendidasEnElPeriodo,
    lotes,
    movimientos,
    resumenProveedor,
  };
}
