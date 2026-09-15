"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { RECIBIDA_PARCIAL, CERRADA_INCOMPLETA, PENDIENTE, CANCELADA } from "@/lib/estadosOrden";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";

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

/**
 * Mover un pedido de etapa es trabajo de quien tiene la pantalla de Órdenes.
 *
 * El control va acá y no solo en el botón: un archivo "use server" es un
 * endpoint público, así que cualquiera que esté logueado puede llamar a estas
 * funciones con el id que se le ocurra. Esconder el botón no alcanza.
 */
async function requierePantalla(...claves: string[]) {
  const sesion = await obtenerSesionConPantallas();
  if (claves.some((c) => puedeVerPantalla(sesion, c))) return null;
  return "No tenés permiso para esto — lo maneja administración desde Compras.";
}

/** Mover pedidos entre etapas: pantalla de Órdenes de compra. */
const requierePantallaOrdenes = () => requierePantalla("compras");

export type OrigenOrden = "MARCA" | "PROVEEDOR";

function redondear2(v: number) {
  return Math.round(v * 100) / 100;
}

function tablaDe(origen: OrigenOrden) {
  return origen === "MARCA" ? "ordenes_reposicion" : "ordenes_compra_proveedor";
}

export async function marcarOrdenEnviada(
  origen: OrigenOrden,
  idOrden: string
): Promise<{ error: string | null }> {
  const sinPermiso = await requierePantallaOrdenes();
  if (sinPermiso) return { error: sinPermiso };
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
 * Deshacer: se marcó como enviada por error y todavía no llegó nada.
 *
 * Vuelve a Órdenes. No se puede si el pedido ya se recepcionó — ahí el
 * problema es otro y se resuelve en la recepción, no acá.
 */
export async function desmarcarOrdenEnviada(
  origen: OrigenOrden,
  idOrden: string
): Promise<{ error: string | null }> {
  const sinPermiso = await requierePantallaOrdenes();
  if (sinPermiso) return { error: sinPermiso };
  try {
    const supabase = getSupabaseServerClient();

    const { data: orden } = await supabase
      .from(tablaDe(origen))
      .select("estado")
      .eq("id_orden", idOrden)
      .maybeSingle();
    if (!orden) return { error: "No se encontró la orden" };
    if (orden.estado !== PENDIENTE) {
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
 * Corregir un pedido recién hecho.
 *
 * Solo mientras NO se envió. Una vez que salió, el proveedor tiene tu pedido
 * en la mano: editarlo de tu lado dejaría tu orden y la suya diciendo cosas
 * distintas, y nadie se enteraría hasta que llegue el camión. Para eso está
 * "Deshacer envío" — un paso consciente antes de poder tocarlo.
 *
 * Y si ya se recibió algo, ni con deshacer: hay mercadería en el stock y
 * lotes con costo, y cambiar lo pedido dejaría números que no cierran.
 *
 * Reemplaza los renglones enteros en vez de ir comparando cuál cambió: son
 * pocas filas, nada cuelga de ellas todavía, y una sola forma de guardar es
 * más difícil de romper que tres caminos según qué se tocó.
 */
export async function editarOrden(
  origen: OrigenOrden,
  idOrden: string,
  items: { idVariante: string; cantidad: number }[],
  observaciones: string
): Promise<{ error: string | null }> {
  const sinPermiso = await requierePantallaOrdenes();
  if (sinPermiso) return { error: sinPermiso };

  const validos = items.filter((i) => i.cantidad > 0);
  if (validos.length === 0) return { error: "El pedido tiene que tener al menos un producto." };

  try {
    const supabase = getSupabaseServerClient();
    const tabla = tablaDe(origen);
    const tablaDetalle = origen === "MARCA" ? "detalle_reposicion" : "detalle_orden_compra";

    const { data: orden } = await supabase
      .from(tabla)
      .select("estado, enviada_el")
      .eq("id_orden", idOrden)
      .maybeSingle();
    if (!orden) return { error: "No se encontró la orden" };
    if (orden.estado !== PENDIENTE) {
      return { error: "Este pedido ya recibió mercadería, así que no se puede editar." };
    }
    if (orden.enviada_el) {
      return {
        error: "Este pedido ya se envió. Usá «Deshacer envío» primero, y avisale al proveedor del cambio.",
      };
    }

    const { error: errorBorrar } = await supabase.from(tablaDetalle).delete().eq("id_orden", idOrden);
    if (errorBorrar) return { error: friendlyDbError(errorBorrar) };

    const { error: errorInsertar } = await supabase.from(tablaDetalle).insert(
      validos.map((i) => ({
        id_orden: idOrden,
        id_variante: i.idVariante,
        cantidad_solicitada: i.cantidad,
        cantidad_recibida: 0,
      }))
    );
    if (errorInsertar) return { error: friendlyDbError(errorInsertar) };

    const { error: errorTotal } = await supabase
      .from(tabla)
      .update({
        total_unidades: validos.reduce((a, i) => a + i.cantidad, 0),
        observaciones: observaciones || null,
      })
      .eq("id_orden", idOrden)
      // Que siga sin enviar: si alguien la mandó mientras se editaba, no se
      // pisa — el guardado falla y se vuelve a mirar.
      .is("enviada_el", null);
    if (errorTotal) return { error: friendlyDbError(errorTotal) };

    revalidatePath("/compras");
    revalidatePath("/proveedores");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo guardar el pedido" };
  }
}

/**
 * Anular un pedido mal hecho.
 *
 * Solo si NO llegó nada todavía: si ya entró mercadería, esa mercadería está
 * en el local y en el stock, y borrar el pedido dejaría stock sin explicación.
 * Ese caso se cierra con "cerrar pedido como está", que sí deja el rastro.
 *
 * No se borra la fila: queda como CANCELADA con el motivo. Un pedido que
 * desaparece es un pedido sobre el que nadie puede preguntar después.
 */
export async function cancelarOrden(
  origen: OrigenOrden,
  idOrden: string,
  motivo: string
): Promise<{ error: string | null }> {
  const sinPermiso = await requierePantallaOrdenes();
  if (sinPermiso) return { error: sinPermiso };
  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    const { data: orden } = await supabase
      .from(tablaDe(origen))
      .select("estado, observaciones")
      .eq("id_orden", idOrden)
      .maybeSingle();
    if (!orden) return { error: "No se encontró la orden" };
    if (orden.estado !== PENDIENTE) {
      return {
        error:
          "Este pedido ya recibió mercadería, así que no se puede anular. Si no va a llegar el resto, usá «Cerrar pedido como está» desde Costeo.",
      };
    }

    const nota = `Anulada por ${usuario ?? "administración"}: ${motivo.trim() || "sin motivo"}`;

    const { error } = await supabase
      .from(tablaDe(origen))
      .update({
        estado: CANCELADA,
        observaciones: orden.observaciones ? `${orden.observaciones}\n${nota}` : nota,
      })
      .eq("id_orden", idOrden)
      // Que siga pendiente: si en el medio alguien recepcionó, no se anula.
      .eq("estado", PENDIENTE);
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/compras");
    revalidatePath("/compras/recepcion");
    revalidatePath("/");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo anular el pedido" };
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
  motivo: string,
  /**
   * Si esa mercadería que no llegó ya estaba facturada, cuánto te cobraron
   * de más. Nace un reclamo de nota de crédito con ese importe.
   *
   * Se pregunta en vez de calcularse: el sistema sabe cuántas unidades
   * faltaron, pero no si el proveedor las facturó ni a qué precio. Adivinarlo
   * daría un número que nadie puede defender frente al proveedor.
   */
  facturado?: { neto: number; iva: number } | null
): Promise<{ error: string | null; aviso?: string }> {
  // El botón vive en Costeo y en Recepción, así que alcanza con cualquiera
  // de las dos. En Recepción la pantalla además lo esconde si el usuario solo
  // tiene el permiso del local: cerrar un pedido es decisión de compras.
  const sinPermiso = await requierePantalla("compras", "compras-costeo");
  if (sinPermiso) return { error: sinPermiso };
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

    // Si eso que no llegó ya estaba facturado, es plata que pagaste por
    // mercadería que no tenés. Nace el reclamo para ir a buscarla.
    let aviso: string | undefined;
    const totalReclamo = facturado ? redondear2((facturado.neto || 0) + (facturado.iva || 0)) : 0;
    if (origen === "PROVEEDOR" && totalReclamo > 0) {
      const { data: ordenProv } = await supabase
        .from("ordenes_compra_proveedor")
        .select("id_proveedor")
        .eq("id_orden", idOrden)
        .maybeSingle();

      if (ordenProv) {
        // Se cuelga de la última entrega del pedido: es la que tiene la
        // factura asociada y la que da el hilo para seguirlo después.
        const { data: ultima } = await supabase
          .from("recepciones_proveedor")
          .select("id_recepcion, id_factura")
          .eq("id_orden", idOrden)
          .order("fecha", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { error: errorReclamo } = await supabase.from("reclamos_proveedor").insert({
          id_proveedor: ordenProv.id_proveedor,
          id_factura: (ultima?.id_factura as string | null) ?? null,
          id_recepcion: (ultima?.id_recepcion as string | null) ?? null,
          neto: redondear2(facturado?.neto ?? 0),
          iva: redondear2(facturado?.iva ?? 0),
          impuestos: 0,
          retenciones: 0,
          total: totalReclamo,
          motivo: `Pedido cerrado incompleto — facturaron mercadería que no entró: ${
            motivo.trim() || "el proveedor no envía el resto"
          }`,
          estado: "PENDIENTE",
          usuario,
        });
        if (errorReclamo) return { error: friendlyDbError(errorReclamo) };
        aviso = `Queda un reclamo de nota de crédito por $${totalReclamo.toLocaleString("es-AR")} en Compras → Reclamos.`;
      }
    }

    revalidatePath("/compras");
    revalidatePath("/compras/recepcion");
    revalidatePath("/compras/costeo");
    revalidatePath("/compras/reclamos");
    revalidatePath("/");
    return { error: null, aviso };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cerrar el pedido" };
  }
}
