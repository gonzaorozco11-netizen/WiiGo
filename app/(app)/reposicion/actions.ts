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
