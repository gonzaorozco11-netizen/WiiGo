import type { SupabaseClient } from "@supabase/supabase-js";

// Opiniones de los clientes sobre los productos (Gonzalo, 18/11; maqueta
// «Para vos y opiniones»). sql/opiniones-productos.sql.
//
// - Opina solo quien lo compró: cada opinión cuelga de una venta suya (online
//   o en la estación con su DNI), hasta 30 días después.
// - Las estrellas se publican solas. El comentario espera a un operativo en
//   Comentarios (Publicar / Ocultar). Borrar, solo el dueño.
// - 10 puntos WiiGo Club la primera vez que opina sobre una compra.
// - Las marcas las leen en su portal; la tienda y la pantalla asesora muestran
//   las estrellas.
//
// Sin la tabla (SQL sin correr) todo devuelve vacío y nada se rompe.

export const DIAS_PARA_OPINAR = 30;
export const PUNTOS_POR_OPINAR = 10;

export type Calificacion = {
  /** Promedio de estrellas, con un decimal. */
  prom: number;
  /** Cuántas opiniones (con o sin comentario). */
  cant: number;
  /** Los últimos comentarios publicados (hasta 3). */
  ultimas: { n: string; e: number; c: string; f: string }[];
};

/** «Martina G.»: el nombre y la inicial del apellido. */
function nombreCorto(nombre: string | null, apellido: string | null) {
  const n = String(nombre ?? "").trim().split(/\s+/)[0] || "Cliente";
  const a = String(apellido ?? "").trim();
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() + (a ? ` ${a.charAt(0).toUpperCase()}.` : "");
}

/** Las estrellas de cada producto, para la tienda, la pantalla asesora y el portal. */
export async function calificaciones(supabase: SupabaseClient, idsProducto?: string[]): Promise<Map<string, Calificacion>> {
  const salida = new Map<string, Calificacion>();
  try {
    const filas: { id_producto: string; estrellas: number; comentario: string | null; comentario_estado: string; creado: string; clientes: { nombre: string | null; apellido: string | null } | null }[] = [];
    for (let i = 0; ; i += 1000) {
      let q = supabase
        .from("opiniones_producto")
        .select("id_producto, estrellas, comentario, comentario_estado, creado, clientes(nombre, apellido)")
        .order("creado", { ascending: false })
        .range(i, i + 999);
      if (idsProducto) q = q.in("id_producto", idsProducto);
      const { data, error } = await q;
      if (error) return salida;
      filas.push(...((data ?? []) as unknown as typeof filas));
      if ((data ?? []).length < 1000) break;
    }
    const suma = new Map<string, number>();
    for (const f of filas) {
      const c = salida.get(f.id_producto) ?? { prom: 0, cant: 0, ultimas: [] };
      c.cant += 1;
      suma.set(f.id_producto, (suma.get(f.id_producto) ?? 0) + Number(f.estrellas));
      if (f.comentario_estado === "PUBLICADO" && f.comentario && c.ultimas.length < 3) {
        c.ultimas.push({ n: nombreCorto(f.clientes?.nombre ?? null, f.clientes?.apellido ?? null), e: Number(f.estrellas), c: f.comentario, f: f.creado.slice(0, 10) });
      }
      salida.set(f.id_producto, c);
    }
    for (const [id, c] of salida) c.prom = Math.round(((suma.get(id) ?? 0) / c.cant) * 10) / 10;
  } catch {
    /* sin la tabla */
  }
  return salida;
}

/** Lo que ya opinó un cliente: venta → producto → estrellas. */
export async function opinionesDelCliente(supabase: SupabaseClient, idCliente: string): Promise<Map<string, Map<string, number>>> {
  const salida = new Map<string, Map<string, number>>();
  try {
    const { data, error } = await supabase.from("opiniones_producto").select("id_venta, id_producto, estrellas").eq("id_cliente", idCliente);
    if (error) return salida;
    for (const o of data ?? []) {
      const m = salida.get(o.id_venta as string) ?? new Map<string, number>();
      m.set(o.id_producto as string, Number(o.estrellas));
      salida.set(o.id_venta as string, m);
    }
  } catch {
    /* sin la tabla */
  }
  return salida;
}

/**
 * Guarda lo que opinó sobre una compra. Controla que la venta sea suya, que no
 * hayan pasado más de 30 días y que cada producto esté en esa venta. Lo que ya
 * había opinado de esa compra se reemplaza (puede cambiar las estrellas).
 */
export async function guardarOpiniones(
  supabase: SupabaseClient,
  idCliente: string,
  idVenta: string,
  items: { idProducto: string; estrellas: number; comentario?: string | null }[]
): Promise<{ error?: string; puntos?: number }> {
  const { data: venta } = await supabase.from("ventas").select("id_venta, id_cliente, fecha, estado").eq("id_venta", idVenta).maybeSingle();
  if (!venta || venta.id_cliente !== idCliente || /CANCEL|ANUL|PENDIENTE/i.test(String(venta.estado ?? ""))) return { error: "No encontramos esa compra en tu cuenta." };
  if (Date.now() - new Date(venta.fecha as string).getTime() > DIAS_PARA_OPINAR * 86400000) return { error: `Se puede opinar hasta ${DIAS_PARA_OPINAR} días después de la compra.` };

  const { data: detalle } = await supabase.from("detalle_ventas").select("variantes_producto(id_producto)").eq("id_venta", idVenta);
  const compro = new Set((detalle ?? []).map((d) => (d.variantes_producto as unknown as { id_producto: string } | null)?.id_producto).filter(Boolean) as string[]);
  const validos = items
    .filter((i) => compro.has(i.idProducto) && Number.isInteger(i.estrellas) && i.estrellas >= 1 && i.estrellas <= 5)
    .map((i) => {
      const comentario = String(i.comentario ?? "").trim().slice(0, 500);
      return {
        id_producto: i.idProducto,
        id_cliente: idCliente,
        id_venta: idVenta,
        estrellas: i.estrellas,
        comentario: comentario || null,
        comentario_estado: comentario ? "PENDIENTE" : "SIN",
        revisado_por: null,
        revisado_el: null,
      };
    });
  if (validos.length === 0) return { error: "Tocá las estrellas de al menos un producto." };

  const { data: antes, error: e0 } = await supabase.from("opiniones_producto").select("id_opinion").eq("id_cliente", idCliente).eq("id_venta", idVenta).limit(1);
  if (e0) return { error: "Las opiniones todavía no están habilitadas. Probá más tarde." };
  const { error } = await supabase.from("opiniones_producto").upsert(validos, { onConflict: "id_cliente,id_producto,id_venta" });
  if (error) return { error: "No se pudo guardar tu opinión. Probá de nuevo." };

  // 10 puntos la primera vez que opina sobre esta compra.
  let puntos = 0;
  if (!(antes ?? []).length) {
    const { data: c } = await supabase.from("clientes").select("puntos").eq("id_cliente", idCliente).maybeSingle();
    const saldo = Number(c?.puntos ?? 0);
    const { error: e2 } = await supabase.from("clientes").update({ puntos: saldo + PUNTOS_POR_OPINAR }).eq("id_cliente", idCliente);
    if (!e2) {
      puntos = PUNTOS_POR_OPINAR;
      // El historial de puntos, si la tabla lo acepta (no frena nada).
      await supabase
        .from("movimientos_puntos")
        .insert({ id_cliente: idCliente, id_venta: idVenta, tipo: "OPINION", puntos: PUNTOS_POR_OPINAR, saldo_anterior: saldo, saldo_nuevo: saldo + PUNTOS_POR_OPINAR, motivo: "Opinó sobre su compra" })
        .then(
          () => undefined,
          () => undefined
        );
    }
  }
  return { puntos };
}

export type ComentarioParaRevisar = {
  id: string;
  producto: string;
  marca: string | null;
  cliente: string;
  estrellas: number;
  comentario: string;
  estado: string;
  creado: string;
};

/** Para la pantalla Comentarios: los que esperan (y los últimos revisados). */
export async function comentariosParaRevisar(supabase: SupabaseClient): Promise<{ pendientes: ComentarioParaRevisar[]; revisados: ComentarioParaRevisar[]; sinTabla: boolean }> {
  const { data, error } = await supabase
    .from("opiniones_producto")
    .select("id_opinion, estrellas, comentario, comentario_estado, creado, revisado_el, productos(nombre, marcas(nombre)), clientes(nombre, apellido)")
    .neq("comentario_estado", "SIN")
    .order("creado", { ascending: false })
    .limit(200);
  if (error) return { pendientes: [], revisados: [], sinTabla: true };
  type Fila = { id_opinion: string; estrellas: number; comentario: string | null; comentario_estado: string; creado: string; productos: { nombre: string; marcas: { nombre: string } | null } | null; clientes: { nombre: string | null; apellido: string | null } | null };
  const filas = ((data ?? []) as unknown as Fila[]).map((f) => ({
    id: f.id_opinion,
    producto: f.productos?.nombre ?? "Producto",
    marca: f.productos?.marcas?.nombre ?? null,
    cliente: nombreCorto(f.clientes?.nombre ?? null, f.clientes?.apellido ?? null),
    estrellas: Number(f.estrellas),
    comentario: f.comentario ?? "",
    estado: f.comentario_estado,
    creado: f.creado,
  }));
  return { pendientes: filas.filter((f) => f.estado === "PENDIENTE").reverse(), revisados: filas.filter((f) => f.estado !== "PENDIENTE").slice(0, 30), sinTabla: false };
}

/** Cuántos comentarios esperan (para el número del menú y el Inicio). */
export async function comentariosPendientes(supabase: SupabaseClient): Promise<number> {
  try {
    const { count, error } = await supabase.from("opiniones_producto").select("id_opinion", { count: "exact", head: true }).eq("comentario_estado", "PENDIENTE");
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}
