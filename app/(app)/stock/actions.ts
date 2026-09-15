"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { simularConsumoFifo } from "@/lib/fifoProveedor";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

async function obtenerCantidad(supabase: ReturnType<typeof getSupabaseServerClient>, idVariante: string, idLocal: string) {
  const { data } = await supabase
    .from("stock")
    .select("cantidad")
    .eq("id_variante", idVariante)
    .eq("id_local", idLocal)
    .maybeSingle();
  return data?.cantidad ?? 0;
}

// Next.js redacta en producción el mensaje de un throw new Error() en una
// Server Action (queda solo un digest genérico) — por eso estas funciones
// devuelven { error } como dato en vez de tirar throw.
export async function ajustarStock(
  idVariante: string,
  idLocal: string,
  nuevaCantidad: number,
  motivo: string
): Promise<{ error: string | null }> {
  if (nuevaCantidad < 0) return { error: "La cantidad no puede ser negativa" };
  try {
    const supabase = getSupabaseServerClient();
    const actual = await obtenerCantidad(supabase, idVariante, idLocal);
    const delta = nuevaCantidad - actual;

    const { error: errorStock } = await supabase
      .from("stock")
      .upsert(
        { id_variante: idVariante, id_local: idLocal, cantidad: nuevaCantidad, fecha_actualizacion: new Date().toISOString() },
        { onConflict: "id_variante,id_local" }
      );
    if (errorStock) return { error: friendlyDbError(errorStock) };

    if (delta !== 0) {
      const usuario = await usuarioActual();
      const { error: errorMov } = await supabase.from("movimientos_stock").insert({
        id_variante: idVariante,
        id_local: idLocal,
        tipo: "AJUSTE",
        cantidad: delta,
        motivo: motivo || null,
        usuario,
      });
      if (errorMov) return { error: friendlyDbError(errorMov) };
    }

    revalidatePath("/stock");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo ajustar el stock" };
  }
}

// ===================== MERMA =====================
//
// Mercadería que se perdió: rota, vencida o robada.
//
// Se separa del ajuste de conteo a propósito. Los dos bajan el stock, pero
// significan cosas distintas: "conté mal" no le debe plata a nadie, y "se
// rompió" sí — con un proveedor que cobra por lo vendido (Alifrut), la merma
// se le liquida igual que una venta, porque el acuerdo es que la absorbe
// WiiGo. Con un botón solo para las dos cosas, el sistema no puede saber
// cuál de las dos pasó, y la mercadería rota terminaba sin pagarla nadie.

export const MOTIVOS_MERMA = ["ROTURA", "VENCIMIENTO", "ROBO", "OTRO"] as const;
export type MotivoMerma = (typeof MOTIVOS_MERMA)[number];

/**
 * Qué va a costar una merma antes de registrarla.
 *
 * Se calcula con el mismo FIFO que la liquidación, así el número que se
 * muestra en el modal es el que después se le va a pagar de verdad y no una
 * estimación parecida. Devuelve null si el producto no es de un proveedor
 * por liquidación: ahí la merma no le cuesta nada a nadie.
 */
export async function costoDeMerma(
  idVariante: string,
  cantidad: number
): Promise<{ costo: number; proveedor: string | null; estimado: boolean } | null> {
  if (cantidad <= 0) return null;
  const supabase = getSupabaseServerClient();

  const { data: variante } = await supabase
    .from("variantes_producto")
    .select("id_producto")
    .eq("id_variante", idVariante)
    .maybeSingle();
  if (!variante) return null;

  const { data: producto } = await supabase
    .from("productos")
    .select("id_proveedor_liquidacion, costo_informado")
    .eq("id_producto", variante.id_producto)
    .maybeSingle();
  const idProveedor = producto?.id_proveedor_liquidacion as string | null;
  if (!idProveedor) return null;

  const { data: proveedor } = await supabase
    .from("proveedores")
    .select("nombre")
    .eq("id_proveedor", idProveedor)
    .maybeSingle();

  const r = await simularConsumoFifo(
    supabase,
    idProveedor,
    idVariante,
    cantidad,
    (producto?.costo_informado as number | null) ?? null
  );

  return {
    costo: Math.round(r.costoTotal),
    proveedor: (proveedor?.nombre as string | null) ?? null,
    estimado: r.estimado,
  };
}

export async function registrarMerma(
  idVariante: string,
  idLocal: string,
  cantidad: number,
  motivo: string,
  detalle: string
): Promise<{ error: string | null }> {
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    return { error: "La cantidad tiene que ser un número entero mayor a 0" };
  }
  if (!MOTIVOS_MERMA.includes(motivo as MotivoMerma)) {
    return { error: "Elegí qué pasó con esa mercadería" };
  }

  try {
    const supabase = getSupabaseServerClient();

    // No se puede perder lo que no está. Sin este control, el stock queda en
    // negativo y la liquidación le cobra al proveedor mercadería que nunca
    // entró al local.
    const actual = await obtenerCantidad(supabase, idVariante, idLocal);
    if (cantidad > actual) {
      return {
        error:
          actual === 0
            ? "Este producto no tiene stock en este local, así que no se puede perder."
            : `Solo hay ${actual} en stock. No se pueden dar de baja ${cantidad}.`,
      };
    }

    const usuario = await usuarioActual();

    const { error: errorMerma } = await supabase.from("mermas").insert({
      id_variante: idVariante,
      id_local: idLocal,
      cantidad,
      motivo,
      detalle: detalle.trim() || null,
      usuario,
    });
    if (errorMerma) return { error: friendlyDbError(errorMerma) };

    const { error: errorStock } = await supabase
      .from("stock")
      .upsert(
        {
          id_variante: idVariante,
          id_local: idLocal,
          cantidad: actual - cantidad,
          fecha_actualizacion: new Date().toISOString(),
        },
        { onConflict: "id_variante,id_local" }
      );
    if (errorStock) return { error: friendlyDbError(errorStock) };

    // También en el libro de movimientos: la merma es mercadería que salió, y
    // ese libro tiene que explicar cada unidad que falta en la góndola.
    const { error: errorMov } = await supabase.from("movimientos_stock").insert({
      id_variante: idVariante,
      id_local: idLocal,
      tipo: "MERMA",
      cantidad: -cantidad,
      motivo: detalle.trim() ? `${motivo} — ${detalle.trim()}` : motivo,
      usuario,
    });
    if (errorMov) return { error: friendlyDbError(errorMov) };

    revalidatePath("/stock");
    revalidatePath("/proveedores");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar la merma" };
  }
}

export async function transferirStock(
  idVariante: string,
  idLocalOrigen: string,
  idLocalDestino: string,
  cantidad: number,
  motivo: string
): Promise<{ error: string | null }> {
  if (idLocalOrigen === idLocalDestino) return { error: "Elegí dos locales distintos" };
  if (cantidad <= 0) return { error: "La cantidad tiene que ser mayor a 0" };

  try {
    const supabase = getSupabaseServerClient();
    const cantidadOrigen = await obtenerCantidad(supabase, idVariante, idLocalOrigen);
    if (cantidadOrigen < cantidad) {
      return { error: `No hay suficiente stock en el local de origen (hay ${cantidadOrigen}).` };
    }
    const cantidadDestino = await obtenerCantidad(supabase, idVariante, idLocalDestino);

    const { error: errorOrigen } = await supabase
      .from("stock")
      .upsert(
        {
          id_variante: idVariante,
          id_local: idLocalOrigen,
          cantidad: cantidadOrigen - cantidad,
          fecha_actualizacion: new Date().toISOString(),
        },
        { onConflict: "id_variante,id_local" }
      );
    if (errorOrigen) return { error: friendlyDbError(errorOrigen) };

    const { error: errorDestino } = await supabase
      .from("stock")
      .upsert(
        {
          id_variante: idVariante,
          id_local: idLocalDestino,
          cantidad: cantidadDestino + cantidad,
          fecha_actualizacion: new Date().toISOString(),
        },
        { onConflict: "id_variante,id_local" }
      );
    if (errorDestino) return { error: friendlyDbError(errorDestino) };

    const usuario = await usuarioActual();
    const { error: errorMov } = await supabase.from("movimientos_stock").insert([
      {
        id_variante: idVariante,
        id_local: idLocalOrigen,
        tipo: "TRANSFERENCIA_SALIDA",
        cantidad: -cantidad,
        motivo: motivo || null,
        usuario,
      },
      {
        id_variante: idVariante,
        id_local: idLocalDestino,
        tipo: "TRANSFERENCIA_ENTRADA",
        cantidad,
        motivo: motivo || null,
        usuario,
      },
    ]);
    if (errorMov) return { error: friendlyDbError(errorMov) };

    revalidatePath("/stock");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo transferir el stock" };
  }
}
