import type { SupabaseClient } from "@supabase/supabase-js";

// Las tareas de cambiar el cartel de góndola. Guardan los dos precios que dice
// el cartel puesto (tarjeta y efectivo) para que en Carteles se vea qué se
// reemplaza por qué (Gonzalo, 2026-10-29). El de efectivo llegó después
// (sql/carteles-efectivo-anterior.sql): si esa columna todavía no existe, la
// tarea se crea igual sin él.

export type FilaTareaEtiqueta = Record<string, unknown> & { efectivo_anterior?: number | null };

export async function insertarTareasEtiqueta(supabase: SupabaseClient, filas: FilaTareaEtiqueta[]) {
  if (filas.length === 0) return;
  const { error } = await supabase.from("tareas_etiqueta").insert(filas);
  if (error && /efectivo_anterior/.test(error.message ?? "")) {
    const sinEfectivo = filas.map((f) => {
      const copia = { ...f };
      delete copia.efectivo_anterior;
      return copia;
    });
    await supabase.from("tareas_etiqueta").insert(sinEfectivo);
  }
}
