import type { SupabaseClient } from "@supabase/supabase-js";
import { ESTADOS_ABIERTOS } from "@/lib/estadosOrden";
import { ESTADO_GRANEL, asegurarGraneles } from "@/lib/granel";

// El pedido a Alifrut que arma el equipo del local (Gonzalo, 2026-11-12).
//
// Los chicos lo arman con lo que llegó al mínimo, Gonzalo lo carga a mano en
// la web de Alifrut y marca lo que no tienen. Es la orden de compra de
// siempre (ordenes_compra_proveedor): sin enviar mientras Gonzalo no la cargó,
// enviada cuando la cargó, y se recibe en Recepción como cualquier otra.
//
// La cuenta:
//   - Se pide lo que llegó a su mínimo («con esto o menos, se pide») y se
//     llena hasta el máximo. En los ganchos de la pared es 5 y 8: cinco en el
//     blistero y tres en el cajón (lib/minimosGancho.ts).
//   - Las bolsitas no se le piden a Alifrut: se le pide el granel en kilos.
//     Si en el depósito ya hay granel, primero se fracciona; se pide lo que
//     falta, redondeado al kilo (o a la bolsa entera, si Alifrut vende así).
//   - Lo envasado se pide por unidad, o por caja si Alifrut vende la caja.
//   - Lo que ya está pedido y no llegó se descuenta, esté enviado o no.

export const PARAMETRO_NO_TENIA = "ALIFRUT_NO_TENIA";
/** Con esto empiezan las observaciones de los pedidos que arma el equipo: así se distinguen de los de Compras. */
export const MARCA_ARMADO_EN_LOCAL = "Armado en el local";

/**
 * El proveedor del pedido: el que liquida por lo vendido (Alifrut), que es el
 * que tiene el granel y la mercadería de la marca propia.
 */
export async function proveedorDelPedido(supabase: SupabaseClient): Promise<{ id: string; nombre: string } | null> {
  const { data } = await supabase
    .from("proveedores")
    .select("id_proveedor, nombre")
    .eq("estado", "ACTIVO")
    .eq("modo_facturacion", "LIQUIDACION_VENTA")
    .order("nombre")
    .limit(1);
  const p = data?.[0];
  return p ? { id: p.id_proveedor as string, nombre: p.nombre as string } : null;
}

/**
 * Cuántos productos hay para pedir hoy: lo que se va juntando para el
 * próximo pedido (Gonzalo pide cuando quiere, 2026-11-12). La misma cuenta
 * que la pantalla, así el número coincide con lo que después ve ahí.
 */
export async function cuantosParaPedir(supabase: SupabaseClient, idProveedor: string, idLocal: string): Promise<number> {
  const s = await sugerirPedidoProveedor(supabase, idProveedor, idLocal, { asegurarGranel: false });
  return s.granel.filter((g) => g.pedirG > 0).length + s.envasados.length;
}

export type PedidoEsperando = { idOrden: string; idProveedor: string; quien: string; fecha: string; productos: number };

/** Los pedidos que armó el equipo y todavía nadie cargó en el proveedor. */
export async function pedidosEsperando(supabase: SupabaseClient): Promise<PedidoEsperando[]> {
  const { data } = await supabase
    .from("ordenes_compra_proveedor")
    .select("id_orden, id_proveedor, usuario, fecha_alta, detalle_orden_compra(id_detalle)")
    .eq("estado", "PENDIENTE")
    .is("enviada_el", null)
    .like("observaciones", `${MARCA_ARMADO_EN_LOCAL}%`)
    .order("fecha_alta", { ascending: true });
  return (data ?? []).map((o) => ({
    idOrden: o.id_orden as string,
    idProveedor: o.id_proveedor as string,
    quien: (o.usuario as string | null) ?? "el equipo",
    fecha: o.fecha_alta as string,
    productos: ((o.detalle_orden_compra as unknown[]) ?? []).length,
  }));
}

export type LineaParaCargar = {
  idDetalle: string;
  nombreProveedor: string;
  rubro: string;
  /** Lo que dice nuestro sistema, por si el nombre del proveedor no alcanza. */
  nombreNuestro: string;
  esGranel: boolean;
  /** Gramos si es granel; unidades si no. */
  cantidad: number;
  /** Kilos por bolsa (granel en bolsa) o unidades por caja: el paso para subir o bajar. */
  paso: number;
  unidadVenta: "KG" | "BULTO" | "CAJA" | "UNIDAD";
  /** Lo envasado que el proveedor vende por kilo (una granola de 1 kg): cuántos kilos es cada unidad. */
  kgPorUnidad: number | null;
};

/** El pedido como lo ve Gonzalo para cargarlo en la web del proveedor: con sus nombres y por rubro. */
export async function pedidoParaCargar(
  supabase: SupabaseClient,
  idOrden: string
): Promise<{ idOrden: string; proveedor: string; quien: string; fecha: string; enviado: boolean; estado: string; lineas: LineaParaCargar[] } | null> {
  const { data: orden } = await supabase
    .from("ordenes_compra_proveedor")
    .select("id_orden, estado, enviada_el, usuario, fecha_alta, proveedores(nombre)")
    .eq("id_orden", idOrden)
    .maybeSingle();
  if (!orden) return null;
  const { data: det } = await supabase
    .from("detalle_orden_compra")
    .select("id_detalle, id_variante, cantidad_solicitada, variantes_producto(nombre, productos(nombre, estado, id_granel, peso_neto_g))")
    .eq("id_orden", idOrden);
  type D = {
    id_detalle: string;
    cantidad_solicitada: number;
    variantes_producto: { nombre: string | null; productos: { nombre: string; estado: string; id_granel: string | null; peso_neto_g: number | null } | null } | null;
  };
  const filas = (det ?? []) as unknown as D[];
  const idsGranel = [...new Set(filas.map((f) => f.variantes_producto?.productos?.id_granel).filter((x): x is string => Boolean(x)))];
  const { data: costos } = idsGranel.length
    ? await supabase.from("costos_granel").select("id_granel, nombre, unidad, kg_bulto, id_item").in("id_granel", idsGranel)
    : { data: [] as Record<string, unknown>[] };
  const costoDe = new Map((costos ?? []).map((c) => [c.id_granel as string, c]));
  const idsItem = (costos ?? []).map((c) => c.id_item as string | null).filter((x): x is string => Boolean(x));
  const { data: items } = idsItem.length
    ? await supabase.from("catalogo_proveedor").select("id_item, nombre, categoria").in("id_item", idsItem)
    : { data: [] as Record<string, unknown>[] };
  const itemDe = new Map((items ?? []).map((i) => [i.id_item as string, i]));

  const lineas: LineaParaCargar[] = filas.map((f) => {
    const p = f.variantes_producto?.productos;
    const c = p?.id_granel ? costoDe.get(p.id_granel) : undefined;
    const it = c?.id_item ? itemDe.get(c.id_item as string) : undefined;
    const esGranel = p?.estado === ESTADO_GRANEL;
    const unidad = (c?.unidad as string | undefined) ?? "UNIDAD";
    const unidadVenta: LineaParaCargar["unidadVenta"] = esGranel ? (unidad === "BULTO" ? "BULTO" : "KG") : unidad === "CAJA" ? "CAJA" : "UNIDAD";
    const porBulto = Math.max(1, Number(c?.kg_bulto ?? 1));
    const nombreNuestro = (p?.nombre ?? "Producto").replace(/ · a granel$/, "");
    return {
      idDetalle: f.id_detalle,
      nombreProveedor: ((it?.nombre as string | undefined) ?? (c?.nombre as string | undefined) ?? nombreNuestro).replace(/\s+-\s+\(.*\)$/, ""),
      rubro: (it?.categoria as string | undefined) ?? "Otros",
      nombreNuestro,
      esGranel,
      cantidad: Number(f.cantidad_solicitada ?? 0),
      paso: esGranel ? (unidadVenta === "BULTO" ? porBulto * 1000 : 1000) : unidadVenta === "CAJA" ? Math.round(porBulto) : 1,
      unidadVenta,
      kgPorUnidad: !esGranel && (unidad === "KG" || unidad === "BULTO") && Number(p?.peso_neto_g ?? 0) > 0 ? Number(p?.peso_neto_g) / 1000 : null,
    };
  });
  lineas.sort((a, b) => a.rubro.localeCompare(b.rubro, "es") || a.nombreProveedor.localeCompare(b.nombreProveedor, "es"));
  return {
    idOrden,
    proveedor: ((orden.proveedores as unknown as { nombre: string } | null)?.nombre as string) ?? "el proveedor",
    quien: (orden.usuario as string | null) ?? "el equipo",
    fecha: orden.fecha_alta as string,
    enviado: Boolean(orden.enviada_el),
    estado: orden.estado as string,
    lineas,
  };
}

/** Lo que el proveedor no tenía la última vez (id_variante → fecha), para avisarle al equipo. */
export async function cargarNoTenia(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", PARAMETRO_NO_TENIA).maybeSingle();
  try {
    const v = data?.valor ? JSON.parse(data.valor as string) : {};
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export type BolsitaPedido = {
  idVariante: string;
  nombre: string;
  gramos: number;
  hay: number;
  minimo: number;
  maximo: number;
  /** Bolsitas que faltan para llegar al máximo. */
  faltan: number;
  /** Cuántas de esas salen del granel que ya está en el depósito. */
  delDeposito: number;
};

export type LineaGranel = {
  idGranel: string;
  /** La variante del granel interno: es lo que va en la orden, en gramos. */
  idVarianteGranel: string;
  nombreProveedor: string;
  rubro: string;
  unidad: "KG" | "BULTO";
  /** Kilos por bolsa, si el proveedor vende en bolsa. */
  kgBulto: number;
  enDepositoG: number;
  enCaminoG: number;
  bolsitas: BolsitaPedido[];
  /** Gramos que hay que pedir, ya redondeados al kilo o a la bolsa. 0 = alcanza con el depósito. */
  pedirG: number;
  noTenia: string | null;
};

export type LineaEnvasado = {
  idVariante: string;
  nombre: string;
  nombreProveedor: string;
  rubro: string;
  hay: number;
  minimo: number;
  maximo: number;
  enCamino: number;
  /** Unidades por caja si el proveedor vende la caja (barritas x16); 1 si vende por unidad. */
  porCaja: number;
  /** Unidades a pedir, ya redondeadas a la caja. */
  pedir: number;
  noTenia: string | null;
};

export type PedidoSugerido = {
  granel: LineaGranel[];
  envasados: LineaEnvasado[];
};

type Prod = { id_producto: string; nombre: string; estado: string; id_granel: string | null; id_envase: string | null; peso_neto_g: number | null };

/**
 * Lo que habría que pedirle hoy a un proveedor para un local.
 * Nunca tira: si algo no se puede leer, esa parte sale vacía.
 */
export async function sugerirPedidoProveedor(
  supabase: SupabaseClient,
  idProveedor: string,
  idLocal: string,
  opciones: { asegurarGranel?: boolean } = {}
): Promise<PedidoSugerido> {
  // Cualquier producto que se empezó a embolsar tiene su granel (lib/granel.ts).
  // El contador de Mis Tareas no lo hace: es solo mirar.
  if (opciones.asegurarGranel !== false) await asegurarGraneles(supabase).catch(() => 0);

  const { data: prodsData } = await supabase
    .from("productos")
    .select("id_producto, nombre, estado, id_granel, id_envase, peso_neto_g")
    .eq("id_proveedor_liquidacion", idProveedor)
    .in("estado", ["ACTIVO", ESTADO_GRANEL])
    .range(0, 4999);
  const prods = (prodsData ?? []) as Prod[];
  if (prods.length === 0) return { granel: [], envasados: [] };

  const { data: varsData } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre, stock_minimo, stock_objetivo")
    .in("id_producto", prods.map((p) => p.id_producto))
    .eq("estado", "ACTIVO")
    .range(0, 9999);
  const vars = (varsData ?? []) as { id_variante: string; id_producto: string; nombre: string | null; stock_minimo: number | null; stock_objetivo: number | null }[];
  const ids = vars.map((v) => v.id_variante);

  const idsGranel = [...new Set(prods.map((p) => p.id_granel).filter((x): x is string => Boolean(x)))];
  const [stockRes, ordenesRes, costosRes, noTenia] = await Promise.all([
    supabase.from("stock").select("id_variante, cantidad").eq("id_local", idLocal).in("id_variante", ids).range(0, 9999),
    supabase.from("ordenes_compra_proveedor").select("id_orden").eq("id_proveedor", idProveedor).eq("id_local", idLocal).in("estado", ESTADOS_ABIERTOS),
    idsGranel.length
      ? supabase.from("costos_granel").select("id_granel, nombre, unidad, kg_bulto, id_item").in("id_granel", idsGranel)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    cargarNoTenia(supabase),
  ]);
  const hay = new Map<string, number>();
  for (const s of stockRes.data ?? []) hay.set(s.id_variante as string, (hay.get(s.id_variante as string) ?? 0) + Number(s.cantidad ?? 0));

  // Pedido y todavía no llegado (en cualquier orden abierta, enviada o no).
  const enCamino = new Map<string, number>();
  const idsOrden = (ordenesRes.data ?? []).map((o) => o.id_orden as string);
  if (idsOrden.length) {
    const { data: det } = await supabase.from("detalle_orden_compra").select("id_variante, cantidad_solicitada, cantidad_recibida").in("id_orden", idsOrden);
    for (const d of det ?? []) {
      const falta = Number(d.cantidad_solicitada ?? 0) - Number(d.cantidad_recibida ?? 0);
      if (falta > 0) enCamino.set(d.id_variante as string, (enCamino.get(d.id_variante as string) ?? 0) + falta);
    }
  }

  // Cómo lo llama y en qué rubro lo pone el proveedor: así se encuentra en su web.
  const costos = (costosRes.data ?? []) as { id_granel: string; nombre: string; unidad: string | null; kg_bulto: number | null; id_item: string | null }[];
  const costoDe = new Map(costos.map((c) => [c.id_granel, c]));
  const idsItem = costos.map((c) => c.id_item).filter((x): x is string => Boolean(x));
  const { data: items } = idsItem.length
    ? await supabase.from("catalogo_proveedor").select("id_item, nombre, categoria").in("id_item", idsItem)
    : { data: [] as Record<string, unknown>[] };
  const itemDe = new Map((items ?? []).map((i) => [i.id_item as string, i as { nombre: string; categoria: string | null }]));
  const datosProveedor = (idGranel: string | null) => {
    const c = idGranel ? costoDe.get(idGranel) : undefined;
    const it = c?.id_item ? itemDe.get(c.id_item) : undefined;
    return { nombre: it?.nombre ?? c?.nombre ?? null, rubro: it?.categoria ?? "Otros", costo: c };
  };

  const variantesDe = new Map<string, typeof vars>();
  for (const v of vars) variantesDe.set(v.id_producto, [...(variantesDe.get(v.id_producto) ?? []), v]);
  const nombreDe = (p: Prod, v: (typeof vars)[number]) => (v.nombre && v.nombre !== "Único" ? `${p.nombre} — ${v.nombre}` : p.nombre);

  // El granel interno de cada costo (su stock son los gramos del depósito).
  const varianteGranel = new Map<string, string>();
  for (const p of prods) {
    if (p.estado !== ESTADO_GRANEL || !p.id_granel) continue;
    const v = (variantesDe.get(p.id_producto) ?? [])[0];
    if (v) varianteGranel.set(p.id_granel, v.id_variante);
  }

  const granel = new Map<string, LineaGranel>();
  const envasados: LineaEnvasado[] = [];

  for (const p of prods) {
    if (p.estado !== "ACTIVO") continue;
    for (const v of variantesDe.get(p.id_producto) ?? []) {
      const minimo = Number(v.stock_minimo ?? 0);
      const maximo = Number(v.stock_objetivo ?? 0);
      if (maximo <= 0) continue;
      const stock = hay.get(v.id_variante) ?? 0;
      // Llegó al mínimo: con esto o menos, se pide.
      if (stock > minimo) continue;
      const prov = datosProveedor(p.id_granel);

      const esBolsita = Boolean(p.id_envase) && Boolean(p.id_granel) && Number(p.peso_neto_g ?? 0) > 0;
      const idVarGranel = p.id_granel ? varianteGranel.get(p.id_granel) : undefined;
      if (esBolsita && idVarGranel && p.id_granel) {
        const faltan = Math.max(0, maximo - stock - (enCamino.get(v.id_variante) ?? 0));
        if (faltan === 0) continue;
        let linea = granel.get(p.id_granel);
        if (!linea) {
          const unidad = prov.costo?.unidad === "BULTO" ? "BULTO" : "KG";
          linea = {
            idGranel: p.id_granel,
            idVarianteGranel: idVarGranel,
            nombreProveedor: prov.nombre ?? p.nombre,
            rubro: prov.rubro,
            unidad,
            kgBulto: unidad === "BULTO" ? Math.max(1, Number(prov.costo?.kg_bulto ?? 1)) : 1,
            enDepositoG: Math.max(0, hay.get(idVarGranel) ?? 0),
            enCaminoG: enCamino.get(idVarGranel) ?? 0,
            bolsitas: [],
            pedirG: 0,
            noTenia: noTenia[idVarGranel] ?? null,
          };
          granel.set(p.id_granel, linea);
        }
        linea.bolsitas.push({ idVariante: v.id_variante, nombre: nombreDe(p, v), gramos: Number(p.peso_neto_g), hay: stock, minimo, maximo, faltan, delDeposito: 0 });
        continue;
      }

      const porCaja = prov.costo?.unidad === "CAJA" ? Math.max(1, Math.round(Number(prov.costo?.kg_bulto ?? 1))) : 1;
      const llegando = enCamino.get(v.id_variante) ?? 0;
      const faltan = maximo - stock - llegando;
      if (faltan <= 0) continue;
      envasados.push({
        idVariante: v.id_variante,
        nombre: nombreDe(p, v),
        nombreProveedor: prov.nombre ?? p.nombre,
        rubro: prov.rubro,
        hay: stock,
        minimo,
        maximo,
        enCamino: llegando,
        porCaja,
        pedir: Math.ceil(faltan / porCaja) * porCaja,
        noTenia: noTenia[v.id_variante] ?? null,
      });
    }
  }

  // Granel: primero lo del depósito (las más vacías primero), después se pide.
  for (const g of granel.values()) {
    let deposito = g.enDepositoG;
    let camino = g.enCaminoG;
    g.bolsitas.sort((a, b) => a.hay - b.hay);
    let faltaG = 0;
    for (const b of g.bolsitas) {
      // Lo que está en el depósito se fracciona ya.
      const deDeposito = Math.min(b.faltan, Math.floor(deposito / b.gramos));
      deposito -= deDeposito * b.gramos;
      b.delDeposito = deDeposito;
      // Lo que ya viene en camino cuenta como si estuviera: no se pide dos veces.
      const resto = b.faltan - deDeposito;
      const deCamino = Math.min(resto, Math.floor(camino / b.gramos));
      camino -= deCamino * b.gramos;
      faltaG += (resto - deCamino) * b.gramos;
    }
    const paso = g.kgBulto * 1000;
    g.pedirG = faltaG > 0 ? Math.ceil(faltaG / paso) * paso : 0;
  }

  const porRubro = <T extends { rubro: string; nombreProveedor: string }>(a: T, b: T) =>
    a.rubro.localeCompare(b.rubro, "es") || a.nombreProveedor.localeCompare(b.nombreProveedor, "es");
  return {
    granel: [...granel.values()].sort(porRubro),
    envasados: envasados.sort(porRubro),
  };
}
