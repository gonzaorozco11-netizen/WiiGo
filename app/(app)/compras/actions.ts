"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { RECIBIDA_PARCIAL, CERRADA_INCOMPLETA } from "@/lib/estadosOrden";

// Compras funciona como una cinta: un pedido está en una sola etapa a la vez.
// Marcarlo como enviado es lo que lo saca de Órdenes y lo pone en Recepción.
//
// Es un paso a mano y no automático a propósito: el sistema no puede saber si
// alguien realmente le mandó el pedido al proveedor por WhatsApp o por
// teléfono. Que lo confirme una persona es lo que hace que el dato sirva.

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

export type OrigenOrden = "MARCA" | "PROVEEDOR";

function tablaDe(origen: OrigenOrden) {
  return origen === "MARCA" ? "ordenes_reposicion" : "ordenes_compra_proveedor";
}

export async function marcarOrdenEnviada(
  origen: OrigenOrden,
  idOrden: string
): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    const { error } = await supabase
      .from(tablaDe(origen))
      .update({ enviada_el: new Date().toISOString(), enviada_por: usuario })
      .eq("id_orden", idOrden)
      // Que siga sin enviar: si dos personas la marcan a la vez, queda la
      // firma de quien lo hizo primero.
      .is("enviada_el", null);
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/compras");
    revalidatePath("/compras/recepcion");
    revalidatePath("/");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo marcar como enviada" };
  }
}

/**
 * Deshacer: se marcó por error y todavía no llegó nada.
 *
 * Vuelve a Órdenes. No se puede si el pedido ya se recepcionó — ahí el
 * problema es otro y se resuelve en la recepción, no acá.
 */
export async function desmarcarOrdenEnviada(
  origen: OrigenOrden,
  idOrden: string
): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();

    const { data: orden } = await supabase
      .from(tablaDe(origen))
      .select("estado")
      .eq("id_orden", idOrden)
      .maybeSingle();
    if (!orden) return { error: "No se encontró la orden" };
    if (orden.estado !== "PENDIENTE") {
      return { error: "Este pedido ya se recepcionó, así que no se puede volver atrás desde acá." };
    }

    const { error } = await supabase
      .from(tablaDe(origen))
      .update({ enviada_el: null, enviada_por: null })
      .eq("id_orden", idOrden);
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/compras");
    revalidatePath("/compras/recepcion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo deshacer" };
  }
}

/**
 * Dar por terminado un pedido que llegó a medias.
 *
 * El proveedor avisó que no manda el resto, o pasó demasiado tiempo. Lo
 * decide administración desde Costeo, no el local: la operativa cuenta lo
 * que hay en la caja, no negocia con la marca.
 *
 * No borra el faltante — el pedido queda con lo pedido y lo recibido, y la
 * diferencia sigue ahí para el reclamo y para cuando llegue la factura.
 */
export async function cerrarOrdenIncompleta(
  origen: OrigenOrden,
  idOrden: string,
  motivo: string
): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    const { data: orden } = await supabase
      .from(tablaDe(origen))
      .select("estado, observaciones")
      .eq("id_orden", idOrden)
      .maybeSingle();
    if (!orden) return { error: "No se encontró la orden" };
    if (orden.estado !== RECIBIDA_PARCIAL) {
      return { error: "Solo se puede cerrar así un pedido que llegó a medias." };
    }

    const nota = `Cerrado incompleto por ${usuario ?? "administración"}: ${
      motivo.trim() || "el proveedor no envía el resto"
    }`;

    const { error } = await supabase
      .from(tablaDe(origen))
      .update({
        estado: CERRADA_INCOMPLETA,
        observaciones: orden.observaciones ? `${orden.observaciones}\n${nota}` : nota,
      })
      .eq("id_orden", idOrden)
      // Que siga a medias: si en el medio llegó el resto, el pedido ya se
      // cerró solo y cerrarlo de nuevo taparía esa entrega.
      .eq("estado", RECIBIDA_PARCIAL);
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/compras");
    revalidatePath("/compras/recepcion");
    revalidatePath("/compras/costeo");
    revalidatePath("/");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cerrar el pedido" };
  }
}
