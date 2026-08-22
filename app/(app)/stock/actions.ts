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
