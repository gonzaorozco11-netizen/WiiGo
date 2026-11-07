"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";

export type CausaDiferencia = "CONTARON_MAL" | "FALTANTE" | "RECEPCION";
const CAUSAS: CausaDiferencia[] = ["CONTARON_MAL", "FALTANTE", "RECEPCION"];

/**
 * Cierra una diferencia con lo que pasó. El stock no se toca: ya quedó en lo
 * contado al momento del conteo. Si «contaron mal», el número correcto se
 * corrige en Stock como cualquier ajuste.
 */
export async function resolverDiferencia(idDiferencia: string, causa: CausaDiferencia, nota: string) {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "stock-conteos")) return { error: "No tenés permiso para resolver diferencias." };
  if (!CAUSAS.includes(causa)) return { error: "Elegí qué pasó." };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("diferencias_stock")
    .update({
      estado: "RESUELTA",
      causa,
      nota: nota.trim().slice(0, 500) || null,
      resuelto_por: sesion.nombre,
      resuelto_en: new Date().toISOString(),
    })
    .eq("id_diferencia", idDiferencia)
    .neq("estado", "RESUELTA");
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/stock/conteos");
  revalidatePath("/");
  return { ok: true as const };
}
