"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

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
