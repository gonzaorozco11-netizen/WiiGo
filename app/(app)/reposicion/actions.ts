"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

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

    revalidatePath("/reposicion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar la entrega" };
  }
}

// Next.js redacta en producción el mensaje de un Error tirado desde una
// Server Action (queda solo un digest genérico en el navegador) — por eso
// estas funciones no throwean para errores esperables: devuelven { error }.
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
    const totalUnidades = validos.reduce((acc, i) => acc + i.cantidad, 0);

    const { data: orden, error: errorOrden } = await supabase
      .from("ordenes_reposicion")
      .insert({
        id_marca: idMarca,
        id_local: idLocal,
        estado: "PENDIENTE",
        total_unidades: totalUnidades,
        observaciones: observaciones || null,
      })
      .select("id_orden")
      .single();
    if (errorOrden) return { error: friendlyDbError(errorOrden) };

    const filas = validos.map((i) => ({
      id_orden: orden.id_orden,
      id_variante: i.idVariante,
      cantidad_solicitada: i.cantidad,
      cantidad_recibida: 0,
    }));
    const { error: errorDetalle } = await supabase.from("detalle_reposicion").insert(filas);
    if (errorDetalle) return { error: friendlyDbError(errorDetalle) };

    revalidatePath("/reposicion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la orden" };
  }
}

export async function recepcionarOrden(
  idOrden: string,
  items: { idDetalle: string; idVariante: string; cantidadSolicitada: number; cantidadRecibida: number }[],
  observaciones: string
): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();

    const { data: orden, error: errorOrdenGet } = await supabase
      .from("ordenes_reposicion")
      .select("id_marca, id_local")
      .eq("id_orden", idOrden)
      .maybeSingle();
    if (errorOrdenGet) return { error: friendlyDbError(errorOrdenGet) };
    if (!orden) return { error: "No se encontró la orden" };

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

  let todoCompleto = true;

  for (const item of items) {
    const diferencia = item.cantidadRecibida - item.cantidadSolicitada;
    const estadoControl = diferencia === 0 ? "COMPLETA" : diferencia < 0 ? "FALTANTE" : "SOBRANTE";
    if (diferencia !== 0) todoCompleto = false;

    const { error: errorUpdateDetalle } = await supabase
      .from("detalle_reposicion")
      .update({ cantidad_recibida: item.cantidadRecibida })
      .eq("id_detalle", item.idDetalle);
    if (errorUpdateDetalle) return { error: friendlyDbError(errorUpdateDetalle) };

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

    const { error: errorEstado } = await supabase
      .from("ordenes_reposicion")
      .update({ estado: todoCompleto ? "RECIBIDA" : "RECIBIDA_CON_DIFERENCIAS" })
      .eq("id_orden", idOrden);
    if (errorEstado) return { error: friendlyDbError(errorEstado) };

    revalidatePath("/reposicion");
    revalidatePath("/stock");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar la recepción" };
  }
}
