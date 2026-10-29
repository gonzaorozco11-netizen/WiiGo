"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { esRolInterno } from "@/lib/rolesInternos";

// Precios → Góndola: en qué lugar de qué módulo va cada producto. La pantalla
// asesora lo lee para decirle al cliente dónde está (Gonzalo, 2026-10-29).

const FALTA_SQL = "Falta correr sql/gondola.sql en Supabase.";

async function sesionDePrecios() {
  const s = await obtenerSesionConPantallas();
  return s && esRolInterno(s.rol) && puedeVerPantalla(s, "precios") ? s : null;
}

/**
 * Pone un producto en un lugar (o lo deja libre, con idProducto null). Si el
 * producto estaba en otro lugar del mismo local, se mueve: está en uno solo.
 * Lo que había en ese lugar queda sin lugar.
 */
export async function ponerEnLugar(idModulo: string, fila: number, columna: number, idProducto: string | null): Promise<{ error: string | null }> {
  if (!(await sesionDePrecios())) return { error: "No tenés permiso para Precios." };
  if (!Number.isInteger(fila) || !Number.isInteger(columna) || fila < 0 || columna < 0) return { error: "Ese lugar no existe." };
  const supabase = getSupabaseServerClient();

  const { data: modulo, error: e1 } = await supabase.from("gondola_modulos").select("id_modulo, id_local, filas").eq("id_modulo", idModulo).maybeSingle();
  if (e1) return { error: FALTA_SQL };
  if (!modulo) return { error: "No encontré ese módulo." };
  const filas = Array.isArray(modulo.filas) ? (modulo.filas as { lugares?: number }[]) : [];
  if (fila >= filas.length || columna >= Math.round(Number(filas[fila]?.lugares) || 6)) return { error: "Ese lugar no existe en el módulo." };
  const idLocal = modulo.id_local as string;

  if (idProducto) {
    const { data: prod } = await supabase.from("productos").select("id_producto").eq("id_producto", idProducto).eq("estado", "ACTIVO").maybeSingle();
    if (!prod) return { error: "No encontré ese producto." };
    // Si estaba en otro lado, se mueve.
    await supabase.from("gondola_lugares").delete().eq("id_local", idLocal).eq("id_producto", idProducto);
  }
  // Lo que había en el lugar queda sin lugar.
  const { error: e2 } = await supabase.from("gondola_lugares").delete().eq("id_modulo", idModulo).eq("fila", fila).eq("columna", columna);
  if (e2) return { error: "No se pudo guardar. Probá de nuevo." };
  if (idProducto) {
    const { error: e3 } = await supabase
      .from("gondola_lugares")
      .insert({ id_modulo: idModulo, id_local: idLocal, fila, columna, id_producto: idProducto, actualizado_el: new Date().toISOString() });
    if (e3) return { error: "No se pudo guardar. Probá de nuevo." };
  }
  revalidatePath("/precios");
  return { error: null };
}
