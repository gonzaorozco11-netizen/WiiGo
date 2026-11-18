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
export async function resolverDiferencia(idDiferencia: string, causa: CausaDiferencia, nota: string, volverStock = false) {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "stock-conteos")) return { error: "No tenés permiso para resolver diferencias." };
  if (!CAUSAS.includes(causa)) return { error: "Elegí qué pasó." };
  const supabase = getSupabaseServerClient();
  // «Volver el stock» (Gonzalo, 18/11): si contaron mal, se deshace el ajuste del conteo sobre el
  // stock de HOY (las ventas que hubo después se respetan), con su movimiento en el historial.
  if (volverStock && causa === "CONTARON_MAL") {
    const { data: d } = await supabase
      .from("diferencias_stock")
      .select("id_variante, id_local, diferencia, contado_por, contado_en, estado")
      .eq("id_diferencia", idDiferencia)
      .maybeSingle();
    if (!d || d.estado === "RESUELTA") return { error: "Esa diferencia ya estaba cerrada." };
    const { data: st } = await supabase.from("stock").select("cantidad").eq("id_variante", d.id_variante).eq("id_local", d.id_local).maybeSingle();
    const hoy = Number(st?.cantidad ?? 0);
    const nuevo = Math.max(0, hoy - Number(d.diferencia));
    if (nuevo !== hoy) {
      const { error: e1 } = await supabase
        .from("stock")
        .upsert({ id_variante: d.id_variante, id_local: d.id_local, cantidad: nuevo, fecha_actualizacion: new Date().toISOString() }, { onConflict: "id_variante,id_local" });
      if (e1) return { error: friendlyDbError(e1) };
      const dia = new Date(d.contado_en as string).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "numeric" });
      await supabase.from("movimientos_stock").insert({
        id_variante: d.id_variante,
        id_local: d.id_local,
        tipo: "AJUSTE",
        cantidad: nuevo - hoy,
        motivo: `Contaron mal (${d.contado_por ?? "conteo"}, ${dia}): el stock vuelve a lo que había`,
        usuario: sesion.nombre,
      });
      revalidatePath("/stock");
    }
  }
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
