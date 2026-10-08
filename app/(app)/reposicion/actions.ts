"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import {
  estaAbierta,
  estadoSegunRecibido,
  PENDIENTE,
  PROPUESTA,
  RECHAZADA,
  RECIBIDA,
  type OrigenOrden,
} from "@/lib/estadosOrden";
import { guardarRemito } from "@/lib/remitoRecepcion";
import { sugerirReposicion, type SugerenciaVariante } from "@/lib/reposicionSugerida";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

// ===================== MERCADERÍA A DEVOLVER A LA MARCA =====================
//
// Lo que un cliente devolvió fallado, vencido o abierto no vuelve a la
// góndola (ver registrarDevolucion en ventas/actions.ts): queda apartado en
// el local. Sin una lista, esa pila crece en el depósito y nadie se acuerda
// de qué había que devolverle a quién — y esa merma la termina comiendo
// WiiGo cuando en realidad es de la marca.

export type MercaderiaADevolver = {
  idDetalleDev: string;
  idMarca: string | null;
  marca: string;
  producto: string;
  cantidad: number;
  fecha: string;
  motivo: string;
  numeroVenta: number | null;
};

export async function mercaderiaParaDevolverAMarca(): Promise<MercaderiaADevolver[]> {
  const supabase = getSupabaseServerClient();

  const { data: devoluciones } = await supabase
    .from("devoluciones")
    .select("id_devolucion, fecha, motivo, id_venta")
    .eq("destino", "NO_VUELVE")
    .order("fecha", { ascending: true })
    .limit(300);
  if (!devoluciones || devoluciones.length === 0) return [];

  const { data: renglones } = await supabase
    .from("detalle_devoluciones")
    .select("id_detalle_dev, id_devolucion, id_variante, id_marca, cantidad")
    .in(
      "id_devolucion",
      devoluciones.map((d) => d.id_devolucion as string)
    )
    .is("devuelto_a_marca_el", null);
  if (!renglones || renglones.length === 0) return [];

  const devPorId = new Map(devoluciones.map((d) => [d.id_devolucion as string, d]));

  const idsVariante = [...new Set(renglones.map((r) => r.id_variante as string))];
  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_variante", idsVariante);
  const varPorId = new Map((variantes ?? []).map((v) => [v.id_variante as string, v]));
  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto as string))];
  const { data: productos } = idsProducto.length
    ? await supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProducto)
    : { data: [] };
  const prodPorId = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));

  const idsMarca = [...new Set(renglones.map((r) => r.id_marca as string).filter(Boolean))];
  const { data: marcas } = idsMarca.length
    ? await supabase.from("marcas").select("id_marca, nombre").in("id_marca", idsMarca)
    : { data: [] };
  const marcaPorId = new Map((marcas ?? []).map((m) => [m.id_marca as string, m.nombre as string]));

  const idsVenta = [...new Set(devoluciones.map((d) => d.id_venta as string))];
  const { data: ventas } = await supabase.from("ventas").select("id_venta, numero").in("id_venta", idsVenta);
  const numeroPorVenta = new Map((ventas ?? []).map((v) => [v.id_venta as string, v.numero as number]));

  return renglones.map((r) => {
    const dev = devPorId.get(r.id_devolucion as string);
    const v = varPorId.get(r.id_variante as string);
    const nombreProd = v ? prodPorId.get(v.id_producto as string) ?? "Producto" : "Producto";
    const nombreVar = v && v.nombre !== "Único" ? ` — ${v.nombre}` : "";
    return {
      idDetalleDev: r.id_detalle_dev as string,
      idMarca: (r.id_marca as string | null) ?? null,
      marca: r.id_marca ? marcaPorId.get(r.id_marca as string) ?? "Sin marca" : "Sin marca",
      producto: `${nombreProd}${nombreVar}`,
      cantidad: (r.cantidad as number) ?? 0,
      fecha: (dev?.fecha as string) ?? "",
      motivo: (dev?.motivo as string) ?? "",
      numeroVenta: dev ? numeroPorVenta.get(dev.id_venta as string) ?? null : null,
    };
  });
}

/** Se le entregó a la marca. Queda quién y cuándo, como todo lo demás. */
export async function marcarDevueltaAMarca(ids: string[]): Promise<{ error: string | null }> {
  if (ids.length === 0) return { error: "No hay nada seleccionado." };
  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();
    const { error } = await supabase
      .from("detalle_devoluciones")
      .update({ devuelto_a_marca_el: new Date().toISOString(), devuelto_a_marca_por: usuario })
      .in("id_detalle_dev", ids)
      // Que siga pendiente: si dos personas la entregan a la vez, no se
      // pisa la firma de quien lo hizo primero.
      .is("devuelto_a_marca_el", null);
    if (error) return { error: friendlyDbError(error) };

    // Estas acciones se llaman desde Compras: /reposicion ya solo redirige.
    revalidatePath("/compras");
    revalidatePath("/compras/recepcion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar la entrega" };
  }
}

// Next.js redacta en producción el mensaje de un Error tirado desde una
// Server Action (queda solo un digest genérico en el navegador) — por eso
// estas funciones no throwean para errores esperables: devuelven { error }.
/**
 * Qué pedirle a una marca, según lo que de verdad se vendió.
 *
 * La cuenta vive en lib/reposicionSugerida.ts. Esto solo la expone a la
 * pantalla que arma la orden: lo que devuelve precarga los renglones y
 * administración los revisa antes de mandar nada.
 */
export async function sugerenciaDeReposicion(
  idMarca: string,
  idLocal: string
): Promise<SugerenciaVariante[]> {
  if (!idMarca || !idLocal) return [];
  const supabase = getSupabaseServerClient();
  const mapa = await sugerirReposicion(supabase, { idMarca, idLocal });
  return [...mapa.values()];
}

/**
 * Mete la orden y su detalle. Lo comparten las tres puertas por las que puede
 * nacer: la que arma administración, la que propone la marca y la que se
 * abre cuando llega mercadería sin pedido.
 *
 * `origen` se intenta y si la columna no existe se reintenta sin ella, igual
 * que con `marcas.orden`: así la pantalla anda aunque todavía no se haya
 * corrido sql/reposicion-propuesta.sql, nada más que sin distinguir de dónde
 * salió cada orden.
 */
async function insertarOrden(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  datos: {
    idMarca: string;
    idLocal: string;
    estado: string;
    origen: OrigenOrden;
    items: { idVariante: string; cantidad: number }[];
    observaciones: string;
  }
): Promise<{ error: string | null; idOrden?: string }> {
  const totalUnidades = datos.items.reduce((acc, i) => acc + i.cantidad, 0);
  const base = {
    id_marca: datos.idMarca,
    id_local: datos.idLocal,
    estado: datos.estado,
    total_unidades: totalUnidades,
    observaciones: datos.observaciones || null,
  };

  let orden: { id_orden: string } | null = null;
  const conOrigen = await supabase
    .from("ordenes_reposicion")
    .insert({ ...base, origen: datos.origen })
    .select("id_orden")
    .single();

  if (conOrigen.error) {
    if (!esColumnaQueFalta(conOrigen.error)) return { error: friendlyDbError(conOrigen.error) };
    const sinOrigen = await supabase
      .from("ordenes_reposicion")
      .insert(base)
      .select("id_orden")
      .single();
    if (sinOrigen.error) return { error: friendlyDbError(sinOrigen.error) };
    orden = sinOrigen.data as { id_orden: string };
  } else {
    orden = conOrigen.data as { id_orden: string };
  }

  const filas = datos.items.map((i) => ({
    id_orden: orden.id_orden,
    id_variante: i.idVariante,
    cantidad_solicitada: i.cantidad,
    cantidad_recibida: 0,
  }));
  const { error: errorDetalle } = await supabase.from("detalle_reposicion").insert(filas);
  if (errorDetalle) return { error: friendlyDbError(errorDetalle) };

  return { error: null, idOrden: orden.id_orden };
}

/** La columna no existe todavía: falta correr el SQL. */
function esColumnaQueFalta(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" || error.code === "PGRST204";
}

export async function crearOrden(
  idMarca: string,
  idLocal: string,
  items: { idVariante: string; cantidad: number }[],
  observaciones: string
): Promise<{ error: string | null }> {
  const validos = items.filter((i) => i.cantidad > 0);
  if (validos.length === 0) return { error: "Agregá al menos un producto con cantidad mayor a 0" };

  try {
    const supabase = getSupabaseServerClient();
    const r = await insertarOrden(supabase, {
      idMarca,
      idLocal,
      estado: PENDIENTE,
      origen: "WIIGO",
      items: validos,
      observaciones,
    });
    if (r.error) return { error: r.error };

    // Estas acciones se llaman desde Compras: /reposicion ya solo redirige.
    revalidatePath("/compras");
    revalidatePath("/compras/recepcion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la orden" };
  }
}

export type PropuestaPendiente = {
  idOrden: string;
  origen: OrigenOrden;
  marca: string;
  local: string;
  fecha: string;
  observaciones: string | null;
  items: {
    idDetalle: string;
    idVariante: string;
    producto: string;
    cantidad: number;
    /** Lo que hay hoy en ese local, para decidir con la góndola adelante. */
    stock: number;
  }[];
};

/**
 * Lo que espera que administración decida.
 *
 * Devuelve lista vacía —y no un error— si la columna `origen` todavía no
 * existe: antes de correr sql/reposicion-propuesta.sql no hay ninguna
 * propuesta posible, así que no hay nada que mostrar.
 */
export async function propuestasPendientes(): Promise<PropuestaPendiente[]> {
  const supabase = getSupabaseServerClient();

  const { data: ordenes, error } = await supabase
    .from("ordenes_reposicion")
    .select("id_orden, id_marca, id_local, fecha, observaciones, origen")
    .eq("estado", PROPUESTA)
    .order("fecha", { ascending: true });
  if (error || !ordenes || ordenes.length === 0) return [];

  const idsOrden = ordenes.map((o) => o.id_orden as string);
  const idsMarca = [...new Set(ordenes.map((o) => o.id_marca as string).filter(Boolean))];
  const idsLocal = [...new Set(ordenes.map((o) => o.id_local as string).filter(Boolean))];

  const [{ data: detalles }, { data: marcas }, { data: locales }] = await Promise.all([
    supabase
      .from("detalle_reposicion")
      .select("id_detalle, id_orden, id_variante, cantidad_solicitada")
      .in("id_orden", idsOrden),
    idsMarca.length
      ? supabase.from("marcas").select("id_marca, nombre").in("id_marca", idsMarca)
      : Promise.resolve({ data: [] }),
    idsLocal.length
      ? supabase.from("locales").select("id_local, nombre").in("id_local", idsLocal)
      : Promise.resolve({ data: [] }),
  ]);

  const idsVariante = [...new Set((detalles ?? []).map((d) => d.id_variante as string))];
  const [{ data: variantes }, { data: stock }] = await Promise.all([
    idsVariante.length
      ? supabase
          .from("variantes_producto")
          .select("id_variante, id_producto, nombre")
          .in("id_variante", idsVariante)
      : Promise.resolve({ data: [] }),
    idsVariante.length
      ? supabase.from("stock").select("id_variante, id_local, cantidad").in("id_variante", idsVariante)
      : Promise.resolve({ data: [] }),
  ]);

  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto as string))];
  const { data: productos } = idsProducto.length
    ? await supabase.from("productos").select("id_producto, nombre").in("id_producto", idsProducto)
    : { data: [] };

  const nombreProducto = new Map((productos ?? []).map((p) => [p.id_producto as string, p.nombre as string]));
  const infoVariante = new Map(
    (variantes ?? []).map((v) => [
      v.id_variante as string,
      {
        producto: nombreProducto.get(v.id_producto as string) ?? "Producto",
        variante: (v.nombre as string) ?? "",
      },
    ])
  );
  const nombreMarca = new Map((marcas ?? []).map((m) => [m.id_marca as string, m.nombre as string]));
  const nombreLocal = new Map((locales ?? []).map((l) => [l.id_local as string, l.nombre as string]));
  const stockPorClave = new Map(
    (stock ?? []).map((s) => [`${s.id_variante}_${s.id_local}`, (s.cantidad as number) ?? 0])
  );

  return ordenes.map((o) => {
    const idOrden = o.id_orden as string;
    const idLocal = o.id_local as string;
    return {
      idOrden,
      origen: ((o.origen as OrigenOrden) ?? "MARCA") as OrigenOrden,
      marca: nombreMarca.get(o.id_marca as string) ?? "Marca",
      local: nombreLocal.get(idLocal) ?? "Local",
      fecha: (o.fecha as string) ?? "",
      observaciones: (o.observaciones as string) ?? null,
      items: (detalles ?? [])
        .filter((d) => d.id_orden === idOrden)
        .map((d) => {
          const idVariante = d.id_variante as string;
          const info = infoVariante.get(idVariante);
          const nombre = info
            ? info.variante && info.variante !== "Único"
              ? `${info.producto} — ${info.variante}`
              : info.producto
            : "Producto";
          return {
            idDetalle: d.id_detalle as string,
            idVariante,
            producto: nombre,
            cantidad: (d.cantidad_solicitada as number) ?? 0,
            stock: stockPorClave.get(`${idVariante}_${idLocal}`) ?? 0,
          };
        }),
    };
  });
}

/**
 * Llegó mercadería que nadie pidió.
 *
 * El operativo la tiene adelante: no sirve decirle "no la recibas". Lo que
 * hace falta es que quede registrada —qué, cuánto, de quién, con el remito—
 * y que NO entre a la venta hasta que administración la acepte.
 *
 * Por eso abre una orden en PROPUESTA y no toca el stock. La mercadería está
 * físicamente en el depósito pero no en la góndola, que es exactamente donde
 * tiene que estar mientras se decide. Al aprobarla pasa a PENDIENTE y se
 * recepciona por el circuito de siempre.
 */
export async function registrarLlegadaSinOrden(
  idMarca: string,
  idLocal: string,
  items: { idVariante: string; cantidad: number }[],
  observaciones: string
): Promise<{ error: string | null }> {
  const validos = items.filter((i) => i.cantidad > 0);
  if (validos.length === 0) return { error: "Cargá al menos un producto con cantidad mayor a 0" };
  if (!idMarca || !idLocal) return { error: "Elegí de qué marca es y a qué local llegó" };

  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();
    const nota = [`Llegó sin pedido. Lo recibió ${usuario ?? "el local"}.`, observaciones]
      .filter(Boolean)
      .join(" ");

    const r = await insertarOrden(supabase, {
      idMarca,
      idLocal,
      estado: PROPUESTA,
      origen: "SIN_PEDIDO",
      items: validos,
      observaciones: nota,
    });
    if (r.error) return { error: r.error };

    revalidatePath("/compras");
    revalidatePath("/compras/recepcion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar la llegada" };
  }
}

/**
 * Administración acepta una propuesta. Hace dos cosas distintas según de
 * dónde salió, porque son dos situaciones distintas:
 *
 *   SIN_PEDIDO — la mercadería YA está en el depósito y el operativo ya la
 *     contó al cargarla. Entra al stock de una. Mandarla de vuelta a
 *     Recepción sería contar dos veces lo mismo.
 *
 *   MARCA — todavía no salió de la marca. Pasa a PENDIENTE y queda en
 *     Recepción esperando la entrega, como cualquier orden.
 *
 * Las cantidades se pueden ajustar antes: si la marca mandó 20 y se le
 * aceptan 12, se aprueba por 12 y las otras 8 vuelven.
 */
export async function aprobarPropuesta(
  idOrden: string,
  ajustes?: { idDetalle: string; cantidad: number }[]
): Promise<{ error: string | null; aviso?: string }> {
  try {
    const supabase = getSupabaseServerClient();

    // `origen` puede no existir todavía: sin él se trata como propuesta de
    // marca, que es el camino conservador (no toca el stock).
    let origen: OrigenOrden = "MARCA";
    let orden: { estado?: unknown; id_local?: unknown; id_marca?: unknown } | null = null;

    const conOrigen = await supabase
      .from("ordenes_reposicion")
      .select("estado, id_local, id_marca, origen")
      .eq("id_orden", idOrden)
      .maybeSingle();
    if (conOrigen.error && !esColumnaQueFalta(conOrigen.error)) {
      return { error: friendlyDbError(conOrigen.error) };
    }
    if (conOrigen.error) {
      const sin = await supabase
        .from("ordenes_reposicion")
        .select("estado, id_local, id_marca")
        .eq("id_orden", idOrden)
        .maybeSingle();
      if (sin.error) return { error: friendlyDbError(sin.error) };
      orden = sin.data;
    } else {
      orden = conOrigen.data;
      origen = ((conOrigen.data?.origen as OrigenOrden) ?? "MARCA") as OrigenOrden;
    }

    if (!orden) return { error: "No se encontró la orden" };
    if (orden.estado !== PROPUESTA) return { error: "Esta orden ya fue resuelta." };

    for (const a of ajustes ?? []) {
      if (a.cantidad < 0) return { error: "No se puede aprobar una cantidad negativa." };
      const { error } = await supabase
        .from("detalle_reposicion")
        .update({ cantidad_solicitada: a.cantidad })
        .eq("id_detalle", a.idDetalle);
      if (error) return { error: friendlyDbError(error) };
    }

    // Los totales se releen de la base y no de lo que mandó la pantalla: si
    // se ajustaron cantidades, lo de la cabecera quedó viejo.
    const { data: renglones } = await supabase
      .from("detalle_reposicion")
      .select("id_detalle, id_variante, cantidad_solicitada")
      .eq("id_orden", idOrden);
    const lineas = renglones ?? [];
    const total = lineas.reduce((a, r) => a + ((r.cantidad_solicitada as number) ?? 0), 0);
    if (total <= 0) return { error: "No se puede aprobar sin unidades. Rechazala." };

    const usuario = await usuarioActual();
    const idLocal = orden.id_local as string;

    if (origen === "SIN_PEDIDO") {
      const r = await entrarAlStock(supabase, {
        idOrden,
        idMarca: orden.id_marca as string,
        idLocal,
        usuario,
        lineas: lineas.map((l) => ({
          idDetalle: l.id_detalle as string,
          idVariante: l.id_variante as string,
          cantidad: (l.cantidad_solicitada as number) ?? 0,
        })),
      });
      if (r.error) return { error: r.error };
    }

    const estadoFinal = origen === "SIN_PEDIDO" ? RECIBIDA : PENDIENTE;
    const cambios: Record<string, unknown> = { estado: estadoFinal, total_unidades: total };
    const conSello = await supabase
      .from("ordenes_reposicion")
      .update({ ...cambios, aprobada_por: usuario, aprobada_el: new Date().toISOString() })
      .eq("id_orden", idOrden);
    if (conSello.error) {
      if (!esColumnaQueFalta(conSello.error)) return { error: friendlyDbError(conSello.error) };
      const { error } = await supabase
        .from("ordenes_reposicion")
        .update(cambios)
        .eq("id_orden", idOrden);
      if (error) return { error: friendlyDbError(error) };
    }

    revalidatePath("/compras");
    revalidatePath("/compras/recepcion");
    revalidatePath("/stock");
    return {
      error: null,
      aviso:
        origen === "SIN_PEDIDO"
          ? `${total} unidades entraron al stock. Ya se pueden vender.`
          : `Aprobada por ${total} unidades. Queda en Recepción esperando la entrega.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo aprobar" };
  }
}

/**
 * Mete al stock lo que llegó sin pedido, con su recepción y sus movimientos.
 *
 * Deja el mismo rastro que una recepción normal —quién, cuándo, cuánto— para
 * que la mercadería no aparezca en el stock sin explicación. La diferencia es
 * que no hubo nada que comparar: lo solicitado ES lo que llegó, así que todos
 * los renglones cierran en COMPLETA.
 */
async function entrarAlStock(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  datos: {
    idOrden: string;
    idMarca: string;
    idLocal: string;
    usuario: string | null;
    lineas: { idDetalle: string; idVariante: string; cantidad: number }[];
  }
): Promise<{ error: string | null }> {
  const { data: recepcion, error: errorRecepcion } = await supabase
    .from("recepciones")
    .insert({
      id_orden: datos.idOrden,
      id_marca: datos.idMarca,
      id_local: datos.idLocal,
      usuario: datos.usuario,
      observaciones: "Llegó sin pedido y se aceptó desde Compras.",
    })
    .select("id_recepcion")
    .single();
  if (errorRecepcion) return { error: friendlyDbError(errorRecepcion) };

  for (const l of datos.lineas) {
    if (l.cantidad <= 0) continue;

    const { error: e1 } = await supabase
      .from("detalle_reposicion")
      .update({ cantidad_recibida: l.cantidad })
      .eq("id_detalle", l.idDetalle);
    if (e1) return { error: friendlyDbError(e1) };

    const { error: e2 } = await supabase.from("detalle_recepciones").insert({
      id_recepcion: recepcion.id_recepcion,
      id_orden: datos.idOrden,
      id_variante: l.idVariante,
      cantidad_solicitada: l.cantidad,
      cantidad_recibida: l.cantidad,
      estado_control: "COMPLETA",
      diferencia: 0,
    });
    if (e2) return { error: friendlyDbError(e2) };

    const { data: actual } = await supabase
      .from("stock")
      .select("cantidad")
      .eq("id_variante", l.idVariante)
      .eq("id_local", datos.idLocal)
      .maybeSingle();

    const { error: e3 } = await supabase.from("stock").upsert(
      {
        id_variante: l.idVariante,
        id_local: datos.idLocal,
        cantidad: (actual?.cantidad ?? 0) + l.cantidad,
        fecha_actualizacion: new Date().toISOString(),
      },
      { onConflict: "id_variante,id_local" }
    );
    if (e3) return { error: friendlyDbError(e3) };

    const { error: e4 } = await supabase.from("movimientos_stock").insert({
      id_variante: l.idVariante,
      id_local: datos.idLocal,
      tipo: "RECEPCION",
      cantidad: l.cantidad,
      motivo: "Llegó sin pedido, aceptado por administración",
      id_referencia: datos.idOrden,
      usuario: datos.usuario,
    });
    if (e4) return { error: friendlyDbError(e4) };
  }

  return { error: null };
}

/** Administración no la quiere. La mercadería vuelve a la marca. */
export async function rechazarPropuesta(
  idOrden: string,
  motivo: string
): Promise<{ error: string | null }> {
  const texto = motivo.trim();
  // Sin motivo, la marca vuelve a mandar lo mismo la semana que viene.
  if (!texto) return { error: "Escribí por qué la rechazás: la marca lo va a ver." };

  try {
    const supabase = getSupabaseServerClient();
    const { data: orden } = await supabase
      .from("ordenes_reposicion")
      .select("estado")
      .eq("id_orden", idOrden)
      .maybeSingle();
    if (!orden) return { error: "No se encontró la orden" };
    if (orden.estado !== PROPUESTA) return { error: "Esta orden ya fue resuelta." };

    const conMotivo = await supabase
      .from("ordenes_reposicion")
      .update({ estado: RECHAZADA, motivo_rechazo: texto })
      .eq("id_orden", idOrden);
    if (conMotivo.error) {
      if (!esColumnaQueFalta(conMotivo.error)) return { error: friendlyDbError(conMotivo.error) };
      const { error } = await supabase
        .from("ordenes_reposicion")
        .update({ estado: RECHAZADA, observaciones: `Rechazada: ${texto}` })
        .eq("id_orden", idOrden);
      if (error) return { error: friendlyDbError(error) };
    }

    revalidatePath("/compras");
    revalidatePath("/compras/recepcion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo rechazar" };
  }
}

export async function recepcionarOrden(
  idOrden: string,
  items: { idDetalle: string; idVariante: string; cantidadSolicitada: number; cantidadRecibida: number }[],
  observaciones: string,
  /** El remito que trajo la marca. Opcional. */
  comprobante?: File | null
): Promise<{ error: string | null; aviso?: string }> {
  try {
    const supabase = getSupabaseServerClient();

    const { data: orden, error: errorOrdenGet } = await supabase
      .from("ordenes_reposicion")
      .select("id_marca, id_local, estado")
      .eq("id_orden", idOrden)
      .maybeSingle();
    if (errorOrdenGet) return { error: friendlyDbError(errorOrdenGet) };
    if (!orden) return { error: "No se encontró la orden" };
    if (!estaAbierta(orden.estado as string)) {
      return { error: "Este pedido ya está cerrado. No se le puede cargar otra entrega." };
    }

    // Lo que ya entró en entregas anteriores. Se lee de la base y no del
    // navegador, para que dos personas cargando a la vez sumen en vez de
    // pisarse.
    const { data: previos, error: errorPrevios } = await supabase
      .from("detalle_reposicion")
      .select("id_detalle, cantidad_recibida")
      .eq("id_orden", idOrden);
    if (errorPrevios) return { error: friendlyDbError(errorPrevios) };

    const yaRecibido = new Map(
      (previos ?? []).map((d) => [d.id_detalle as string, (d.cantidad_recibida as number) ?? 0])
    );

    if (items.every((i) => i.cantidadRecibida <= 0)) {
      return { error: "No cargaste ninguna unidad. Si no llegó nada, dejá el pedido como está." };
    }
    if (items.some((i) => i.cantidadRecibida < 0)) {
      return { error: "No se puede recibir una cantidad negativa." };
    }

    const usuario = await usuarioActual();

    const { data: recepcion, error: errorRecepcion } = await supabase
      .from("recepciones")
      .insert({
        id_orden: idOrden,
        id_marca: orden.id_marca,
        id_local: orden.id_local,
        usuario,
        observaciones: observaciones || null,
      })
      .select("id_recepcion")
      .single();
    if (errorRecepcion) return { error: friendlyDbError(errorRecepcion) };

  for (const item of items) {
    const previo = yaRecibido.get(item.idDetalle) ?? 0;
    const acumulado = previo + item.cantidadRecibida;
    // La diferencia se mide contra el pedido entero, no contra esta entrega.
    const diferencia = acumulado - item.cantidadSolicitada;
    const estadoControl = diferencia === 0 ? "COMPLETA" : diferencia < 0 ? "FALTANTE" : "SOBRANTE";

    const { error: errorUpdateDetalle } = await supabase
      .from("detalle_reposicion")
      .update({ cantidad_recibida: acumulado })
      .eq("id_detalle", item.idDetalle);
    if (errorUpdateDetalle) return { error: friendlyDbError(errorUpdateDetalle) };

    // El renglón de la recepción guarda solo lo que llegó AHORA: es el
    // registro de esta entrega puntual, con su fecha y su remito.
    const { error: errorDetalleRecepcion } = await supabase.from("detalle_recepciones").insert({
      id_recepcion: recepcion.id_recepcion,
      id_orden: idOrden,
      id_variante: item.idVariante,
      cantidad_solicitada: item.cantidadSolicitada,
      cantidad_recibida: item.cantidadRecibida,
      estado_control: estadoControl,
      diferencia,
    });
    if (errorDetalleRecepcion) return { error: friendlyDbError(errorDetalleRecepcion) };

    if (item.cantidadRecibida > 0) {
      const { data: stockActual } = await supabase
        .from("stock")
        .select("cantidad")
        .eq("id_variante", item.idVariante)
        .eq("id_local", orden.id_local)
        .maybeSingle();
      const nuevaCantidad = (stockActual?.cantidad ?? 0) + item.cantidadRecibida;

      const { error: errorStock } = await supabase
        .from("stock")
        .upsert(
          {
            id_variante: item.idVariante,
            id_local: orden.id_local,
            cantidad: nuevaCantidad,
            fecha_actualizacion: new Date().toISOString(),
          },
          { onConflict: "id_variante,id_local" }
        );
      if (errorStock) return { error: friendlyDbError(errorStock) };

      const { error: errorMov } = await supabase.from("movimientos_stock").insert({
        id_variante: item.idVariante,
        id_local: orden.id_local,
        tipo: "RECEPCION",
        cantidad: item.cantidadRecibida,
        motivo: "Recepción de orden de reposición",
        id_referencia: idOrden,
        usuario,
      });
      if (errorMov) return { error: friendlyDbError(errorMov) };
    }
  }

    // Si todavía falta algo, el pedido queda abierto y vuelve a aparecer en
    // Recepción esperando el resto. No lo decide quien recibe: sale de las
    // cantidades.
    const nuevoEstado = estadoSegunRecibido(
      items.map((i) => ({
        solicitada: i.cantidadSolicitada,
        recibidaAcumulada: (yaRecibido.get(i.idDetalle) ?? 0) + i.cantidadRecibida,
      }))
    );

    const { error: errorEstado } = await supabase
      .from("ordenes_reposicion")
      .update({ estado: nuevoEstado })
      .eq("id_orden", idOrden);
    if (errorEstado) return { error: friendlyDbError(errorEstado) };

    // Al final y sin frenar nada, igual que en la recepción a proveedor: acá
    // el remito es además el ÚNICO comprobante que va a existir, porque un
    // pedido a una marca no pasa por Costeo.
    const aviso = await guardarRemito(supabase, "recepciones", recepcion.id_recepcion, comprobante);

    // Estas acciones se llaman desde Compras: /reposicion ya solo redirige.
    revalidatePath("/compras");
    revalidatePath("/compras/recepcion");
    revalidatePath("/stock");
    return { error: null, aviso };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar la recepción" };
  }
}
