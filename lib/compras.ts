import { getSupabaseServerClient } from "@/lib/supabase";

// Compras: un solo circuito para pedirle mercadería a quien sea.
//
// El sistema tiene dos tablas distintas para lo mismo — `ordenes_reposicion`
// (a las marcas) y `ordenes_compra_proveedor` (a los proveedores) — porque
// nacieron en momentos distintos. Los pasos son idénticos: se pide, llega, se
// controla, y después se le pone precio.
//
// Este archivo NO fusiona las tablas: las lee juntas y devuelve una sola
// lista. Migrar datos para unificar sería el camino largo y riesgoso; leer
// las dos y normalizar da el mismo resultado en pantalla sin tocar un solo
// registro. Cada acción sigue yendo a su módulo de siempre.
//
// El precio de esto es que hay que acordarse de tocar los dos lados al
// agregar algo. Por eso las consultas viven acá juntas y no desparramadas.

export type OrigenCompra = "MARCA" | "PROVEEDOR";

export type OrdenCompra = {
  origen: OrigenCompra;
  idOrden: string;
  /** id de la marca o del proveedor, según el origen. */
  idContraparte: string;
  contraparte: string;
  idLocal: string | null;
  local: string;
  fecha: string;
  estado: string;
  totalUnidades: number;
  diasEsperando: number;
};

export type RecibidoSinCostear = {
  origen: OrigenCompra;
  idOrden: string;
  idRecepcion: string;
  contraparte: string;
  /** REMITO | PERIODO | LIQUIDACION_VENTA. Vacío en las marcas. */
  modoFacturacion: string;
  local: string;
  fecha: string;
  productos: number;
  diasSinCostear: number;
};

function diasDesde(iso: string) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

async function nombres(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const [{ data: marcas }, { data: proveedores }, { data: locales }] = await Promise.all([
    supabase.from("marcas").select("id_marca, nombre"),
    supabase.from("proveedores").select("id_proveedor, nombre, modo_facturacion"),
    supabase.from("locales").select("id_local, nombre"),
  ]);
  return {
    marca: new Map((marcas ?? []).map((m) => [m.id_marca as string, m.nombre as string])),
    proveedor: new Map((proveedores ?? []).map((p) => [p.id_proveedor as string, p.nombre as string])),
    modo: new Map((proveedores ?? []).map((p) => [p.id_proveedor as string, p.modo_facturacion as string])),
    local: new Map((locales ?? []).map((l) => [l.id_local as string, l.nombre as string])),
  };
}

/**
 * Las órdenes abiertas: pedidas y todavía sin recibir del todo.
 *
 * `soloPendientes` es lo que hace que la pantalla de Recepción abra mostrando
 * el trabajo del día en vez de un archivo histórico.
 */
export async function ordenesDeCompra(soloPendientes = false): Promise<OrdenCompra[]> {
  const supabase = getSupabaseServerClient();
  const estados = soloPendientes ? ["PENDIENTE"] : ["PENDIENTE", "RECIBIDA", "RECIBIDA_CON_DIFERENCIAS"];

  const [n, { data: reposicion }, { data: compras }] = await Promise.all([
    nombres(supabase),
    supabase
      .from("ordenes_reposicion")
      .select("id_orden, id_marca, id_local, fecha, estado, total_unidades")
      .in("estado", estados)
      .order("fecha", { ascending: false })
      .limit(200),
    supabase
      .from("ordenes_compra_proveedor")
      .select("id_orden, id_proveedor, id_local, fecha_alta, estado, total_unidades")
      .in("estado", estados)
      .order("fecha_alta", { ascending: false })
      .limit(200),
  ]);

  const deMarcas: OrdenCompra[] = (reposicion ?? []).map((o) => ({
    origen: "MARCA" as const,
    idOrden: o.id_orden as string,
    idContraparte: o.id_marca as string,
    contraparte: n.marca.get(o.id_marca as string) ?? "Marca",
    idLocal: (o.id_local as string) ?? null,
    local: n.local.get(o.id_local as string) ?? "—",
    fecha: o.fecha as string,
    estado: o.estado as string,
    totalUnidades: (o.total_unidades as number) ?? 0,
    diasEsperando: diasDesde(o.fecha as string),
  }));

  const deProveedores: OrdenCompra[] = (compras ?? []).map((o) => ({
    origen: "PROVEEDOR" as const,
    idOrden: o.id_orden as string,
    idContraparte: o.id_proveedor as string,
    contraparte: n.proveedor.get(o.id_proveedor as string) ?? "Proveedor",
    idLocal: (o.id_local as string) ?? null,
    local: n.local.get(o.id_local as string) ?? "—",
    fecha: o.fecha_alta as string,
    estado: o.estado as string,
    totalUnidades: (o.total_unidades as number) ?? 0,
    diasEsperando: diasDesde(o.fecha_alta as string),
  }));

  // Lo más viejo primero cuando se trata de trabajo pendiente: es lo que
  // lleva más tiempo esperando. En el listado general, lo último arriba.
  return [...deMarcas, ...deProveedores].sort((a, b) =>
    soloPendientes ? a.fecha.localeCompare(b.fecha) : b.fecha.localeCompare(a.fecha)
  );
}

/**
 * Lo que llegó y todavía no tiene precio cargado.
 *
 * Solo aplica a proveedores: a las marcas no se les costea nada, se les cobra
 * un royalty sobre el precio de venta. Por eso esta lista no tiene origen
 * MARCA — y es a propósito, no un olvido.
 */
export async function recibidosSinCostear(): Promise<RecibidoSinCostear[]> {
  const supabase = getSupabaseServerClient();

  const [n, { data: recepciones }] = await Promise.all([
    nombres(supabase),
    supabase
      .from("recepciones_proveedor")
      .select("id_recepcion, id_orden, id_proveedor, id_local, fecha")
      .eq("facturada", false)
      .order("fecha", { ascending: true })
      .limit(100),
  ]);
  if (!recepciones || recepciones.length === 0) return [];

  const { data: detalle } = await supabase
    .from("detalle_recepcion_proveedor")
    .select("id_recepcion")
    .in(
      "id_recepcion",
      recepciones.map((r) => r.id_recepcion as string)
    );
  const productos = new Map<string, number>();
  (detalle ?? []).forEach((d) => {
    const k = d.id_recepcion as string;
    productos.set(k, (productos.get(k) ?? 0) + 1);
  });

  return recepciones.map((r) => ({
    origen: "PROVEEDOR" as const,
    idOrden: r.id_orden as string,
    idRecepcion: r.id_recepcion as string,
    contraparte: n.proveedor.get(r.id_proveedor as string) ?? "Proveedor",
    modoFacturacion: n.modo.get(r.id_proveedor as string) ?? "REMITO",
    local: n.local.get(r.id_local as string) ?? "—",
    fecha: r.fecha as string,
    productos: productos.get(r.id_recepcion as string) ?? 0,
    diasSinCostear: diasDesde(r.fecha as string),
  }));
}

/** Los tres números de las etapas, para el menú y el tablero. */
export async function contadoresCompras(): Promise<{
  ordenesAbiertas: number;
  esperandoRecepcion: number;
  sinCostear: number;
  sinCostearVencidos: number;
}> {
  const supabase = getSupabaseServerClient();

  const [rep, prov, sinCostear] = await Promise.all([
    supabase
      .from("ordenes_reposicion")
      .select("id_orden", { count: "exact", head: true })
      .eq("estado", "PENDIENTE"),
    supabase
      .from("ordenes_compra_proveedor")
      .select("id_orden", { count: "exact", head: true })
      .eq("estado", "PENDIENTE"),
    supabase
      .from("recepciones_proveedor")
      .select("id_recepcion, fecha")
      .eq("facturada", false)
      .limit(100),
  ]);

  const pendientes = (rep.count ?? 0) + (prov.count ?? 0);
  const filas = sinCostear.data ?? [];
  // Más de tres días sin costear ya afecta la liquidación del mes: se marca.
  const vencidos = filas.filter((r) => diasDesde(r.fecha as string) > 3).length;

  return {
    ordenesAbiertas: pendientes,
    esperandoRecepcion: pendientes,
    sinCostear: filas.length,
    sinCostearVencidos: vencidos,
  };
}
