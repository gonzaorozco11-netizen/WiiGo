import type { SupabaseClient } from "@supabase/supabase-js";

// Las tareas de cambiar el cartel de góndola. Guardan los dos precios que dice
// el cartel puesto (tarjeta y efectivo) para que en Carteles se vea qué se
// reemplaza por qué (Gonzalo, 2026-10-29). El de efectivo llegó después
// (sql/carteles-efectivo-anterior.sql): si esa columna todavía no existe, la
// tarea se crea igual sin él.
//
// Si el precio vuelve a cambiar antes de que pongan el cartel, no se abre otra
// tarea: se actualiza la que ya estaba con el precio nuevo. Se quedan la fecha
// del pedido y los precios "de antes" de la primera, porque el cartel puesto
// sigue diciendo eso y está desactualizado desde ese día (Gonzalo, 2026-10-29).
//
// Precio al poner el cartel (sql/carteles-precio-al-poner.sql): las tareas de
// la marca propia llevan aplicar_al_poner. El precio de la caja, el tótem y el
// asesor no cambia al "Pasar a la venta": cambia cuando el operativo marca el
// cartel como puesto. Así la caja nunca cobra distinto de lo que dice la
// góndola (Gonzalo, 2026-10-29).

export type FilaTareaEtiqueta = Record<string, unknown> & { efectivo_anterior?: number | null };

export async function insertarTareasEtiqueta(supabase: SupabaseClient, filas: FilaTareaEtiqueta[]) {
  if (filas.length === 0) return;

  const cambios = filas.filter((f) => f.tipo === "CAMBIO_PRECIO");
  const abiertas = new Map<string, string>();
  if (cambios.length) {
    const { data } = await supabase
      .from("tareas_etiqueta")
      .select("id_tarea, id_producto, id_local")
      .eq("tipo", "CAMBIO_PRECIO")
      .in("estado", ["PENDIENTE", "VENCIDA"])
      .in("id_producto", [...new Set(cambios.map((f) => f.id_producto as string))]);
    for (const t of data ?? []) abiertas.set(`${t.id_producto}:${t.id_local}`, t.id_tarea as string);
  }

  const nuevas: FilaTareaEtiqueta[] = [];
  for (const f of filas) {
    const id = f.tipo === "CAMBIO_PRECIO" ? abiertas.get(`${f.id_producto}:${f.id_local}`) : undefined;
    if (!id) {
      nuevas.push(f);
      continue;
    }
    const cambio: Record<string, unknown> = { precio_nuevo: f.precio_nuevo };
    if ("efectivo_nuevo" in f) cambio.efectivo_nuevo = f.efectivo_nuevo;
    if ("aplicar_al_poner" in f) cambio.aplicar_al_poner = f.aplicar_al_poner;
    // WiiGo: el precio nuevo entra en el próximo cierre de turno, no en el del
    // pedido anterior. (En las marcas no se toca: si el precio anterior ya entró,
    // el cartel viejo sigue a la vista y tiene que seguir en rojo.)
    if (f.aplicar_al_poner === true && "vence_el" in f) {
      cambio.vence_el = f.vence_el;
      cambio.estado = "PENDIENTE";
    }
    await supabase.from("tareas_etiqueta").update(cambio).eq("id_tarea", id);
  }
  if (nuevas.length === 0) return;

  const { error } = await supabase.from("tareas_etiqueta").insert(nuevas);
  if (error && /efectivo_anterior/.test(error.message ?? "")) {
    const sinEfectivo = nuevas.map((f) => {
      const copia = { ...f };
      delete copia.efectivo_anterior;
      return copia;
    });
    await supabase.from("tareas_etiqueta").insert(sinEfectivo);
  }
}

/**
 * Después de marcar carteles como puestos: los precios que esperaban el cartel
 * entran en todo el sistema. Si hay varios locales, entra cuando el último
 * puso el suyo (hasta entonces, el que ya lo puso cobra menos de lo que dice:
 * eso está permitido; lo contrario, no).
 */
export async function aplicarPreciosDeCarteles(supabase: SupabaseClient, idsTarea: string[], idUsuario: string | null): Promise<number> {
  if (idsTarea.length === 0) return 0;
  const { data: hechas, error } = await supabase
    .from("tareas_etiqueta")
    .select("id_producto, precio_nuevo, efectivo_nuevo, hecha_el")
    .in("id_tarea", idsTarea)
    .eq("aplicar_al_poner", true);
  if (error || !hechas?.length) return 0;

  const ids = [...new Set(hechas.map((t) => t.id_producto as string))];
  const { data: siguenAbiertas } = await supabase
    .from("tareas_etiqueta")
    .select("id_producto")
    .in("id_producto", ids)
    .eq("aplicar_al_poner", true)
    .in("estado", ["PENDIENTE", "VENCIDA"]);
  const esperan = new Set((siguenAbiertas ?? []).map((t) => t.id_producto as string));
  const { data: productos } = await supabase.from("productos").select("id_producto, precio_venta").in("id_producto", ids);
  const hoy = new Map((productos ?? []).map((p) => [p.id_producto as string, p.precio_venta == null ? null : Number(p.precio_venta)]));

  let aplicados = 0;
  const ahora = new Date().toISOString();
  for (const id of ids) {
    if (esperan.has(id)) continue;
    const t = hechas.find((h) => h.id_producto === id)!;
    const lista = Number(t.precio_nuevo);
    if (!(lista > 0)) continue;
    const efectivo = t.efectivo_nuevo == null ? lista : Number(t.efectivo_nuevo);
    const { error: e } = await supabase.from("productos").update({ precio_venta: lista, precio_efectivo: efectivo, fecha_actualizacion: ahora }).eq("id_producto", id);
    if (e) continue;
    aplicados++;
    if (hoy.get(id) !== lista) {
      await supabase.from("historial_precios").insert({
        id_producto: id,
        precio_anterior: hoy.get(id) ?? null,
        precio_nuevo: lista,
        cambiado_por: idUsuario,
        motivo: "Módulo Precios · cartel puesto",
      });
    }
  }
  return aplicados;
}

/** Un producto con el cartel sin poner: se marca puesto de a uno, con todas sus tareas de ese local. */
export type CartelPendiente = { idProducto: string; nombre: string; precio: number | null; idsTarea: string[] };
export type CartelesPendientes = { cantidad: number; items: CartelPendiente[] };

/** Los carteles con precio cambiado que siguen sin poner en un local (para no irse sin ponerlos). */
export async function cartelesPendientesDelLocal(supabase: SupabaseClient, idLocal: string): Promise<CartelesPendientes | null> {
  const { data, error } = await supabase
    .from("tareas_etiqueta")
    .select("id_tarea, id_producto, precio_nuevo, creada_el, vence_el, aplicar_al_poner, productos!inner(nombre, estado)")
    .eq("tipo", "CAMBIO_PRECIO")
    .in("estado", ["PENDIENTE", "VENCIDA"])
    // Un producto inactivo no está en la góndola ni en Carteles: su cartel no
    // puede frenar la salida de nadie (las 4 Mermeladas con Azúcar, 2026-11-12).
    .eq("productos.estado", "ACTIVO")
    .or(`id_local.eq.${idLocal},id_local.is.null`)
    .order("creada_el");
  if (error || !data?.length) return null;
  const porProducto = new Map<string, CartelPendiente>();
  const ahora = Date.now();
  for (const t of data) {
    // El precio nuevo de una marca que todavía no entró (se aprobó para las
    // 23:00): el cartel saldría con el viejo, así que no frena a nadie hoy.
    if (!t.aplicar_al_poner && new Date(t.vence_el as string).getTime() > ahora) continue;
    const id = t.id_producto as string;
    const previo = porProducto.get(id);
    porProducto.set(id, {
      idProducto: id,
      nombre: (t.productos as unknown as { nombre: string } | null)?.nombre ?? "Producto",
      // El del pedido más nuevo: es el que va en el cartel.
      precio: t.precio_nuevo == null ? previo?.precio ?? null : Number(t.precio_nuevo),
      idsTarea: [...(previo?.idsTarea ?? []), t.id_tarea as string],
    });
  }
  const items = [...porProducto.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  if (!items.length) return null;
  return { cantidad: items.length, items };
}

/**
 * Los carteles urgentes: el precio de una marca ya entró en la caja y en la
 * góndola sigue el cartel con el viejo. Salen en rojo en todas las pantallas
 * del equipo hasta que se ponen (Gonzalo, 2026-11-10: «sino pasa desapercibido»).
 * Los productos que nunca tuvieron cartel no cuentan acá: no hay un precio
 * viejo a la vista.
 */
export async function contarCartelesUrgentes(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("tareas_etiqueta")
    .select("id_producto, productos!inner(estado)")
    .eq("tipo", "CAMBIO_PRECIO")
    .in("estado", ["PENDIENTE", "VENCIDA"])
    .eq("productos.estado", "ACTIVO")
    .or("aplicar_al_poner.is.null,aplicar_al_poner.eq.false")
    .not("precio_anterior", "is", null)
    .lte("vence_el", new Date().toISOString())
    .limit(1000);
  if (error) return 0;
  return new Set((data ?? []).map((t) => t.id_producto as string)).size;
}

/**
 * Al cierre del turno (13:00 y 21:00), el precio nuevo de WiiGo que todavía
 * espera el cartel entra solo, igual que el de las marcas (Gonzalo,
 * 2026-11-11). Si el operativo puso el cartel antes y tocó «Lo puse», ya había
 * entrado en ese momento. Desde acá la tarea queda como la de una marca:
 * precio en la caja, cartel por cambiar (franja roja y no se ficha la salida
 * sin ponerlo).
 */
export async function aplicarPreciosPropiosDelTurno(supabase: SupabaseClient): Promise<number> {
  const ahora = new Date().toISOString();
  const { data: tareas, error } = await supabase
    .from("tareas_etiqueta")
    .select("id_tarea, id_producto, precio_nuevo, efectivo_nuevo, creada_el")
    .eq("tipo", "CAMBIO_PRECIO")
    .eq("aplicar_al_poner", true)
    .in("estado", ["PENDIENTE", "VENCIDA"])
    .lte("vence_el", ahora)
    .limit(1000);
  if (error || !tareas?.length) return 0;

  const porProducto = new Map<string, (typeof tareas)[number]>();
  for (const t of tareas) {
    const previa = porProducto.get(t.id_producto as string);
    if (!previa || String(t.creada_el) > String(previa.creada_el)) porProducto.set(t.id_producto as string, t);
  }
  const ids = [...porProducto.keys()];
  const { data: productos } = await supabase.from("productos").select("id_producto, precio_venta").in("id_producto", ids);
  const hoy = new Map((productos ?? []).map((p) => [p.id_producto as string, p.precio_venta == null ? null : Number(p.precio_venta)]));

  let aplicados = 0;
  for (const [id, t] of porProducto) {
    const lista = Number(t.precio_nuevo);
    if (!(lista > 0)) continue;
    const efectivo = t.efectivo_nuevo == null ? lista : Number(t.efectivo_nuevo);
    const { error: e } = await supabase.from("productos").update({ precio_venta: lista, precio_efectivo: efectivo, fecha_actualizacion: ahora }).eq("id_producto", id);
    if (e) continue;
    aplicados++;
    if (hoy.get(id) !== lista) {
      await supabase.from("historial_precios").insert({
        id_producto: id,
        precio_anterior: hoy.get(id) ?? null,
        precio_nuevo: lista,
        cambiado_por: null,
        motivo: "Módulo Precios · cierre de turno",
      });
    }
  }
  // Ya no espera el cartel: el precio está en la caja y el cartel queda por cambiar.
  await supabase
    .from("tareas_etiqueta")
    .update({ aplicar_al_poner: false })
    .in("id_tarea", tareas.map((t) => t.id_tarea as string));
  return aplicados;
}

/** El operativo se va sin poder ponerlos: queda el motivo y le aparece a administración. */
export async function postergarCarteles(supabase: SupabaseClient, idLocal: string, motivo: string, quien: string) {
  await supabase
    .from("tareas_etiqueta")
    .update({ postergada_motivo: motivo, postergada_por: quien, postergada_el: new Date().toISOString() })
    .eq("tipo", "CAMBIO_PRECIO")
    .in("estado", ["PENDIENTE", "VENCIDA"])
    .or(`id_local.eq.${idLocal},id_local.is.null`);
}
