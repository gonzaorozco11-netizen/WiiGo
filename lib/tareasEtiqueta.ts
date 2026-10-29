import type { SupabaseClient } from "@supabase/supabase-js";

// Las tareas de cambiar el cartel de góndola. Guardan los dos precios que dice
// el cartel puesto (tarjeta y efectivo) para que en Carteles se vea qué se
// reemplaza por qué (Gonzalo, 2026-10-29). El de efectivo llegó después
// (sql/carteles-efectivo-anterior.sql): si esa columna todavía no existe, la
// tarea se crea igual sin él.
//
// Si el precio vuelve a cambiar antes de que pongan el cartel, no se abre otra
// tarea: se actualiza la que ya estaba con el precio nuevo. Se quedan la fecha
// del pedido y los precios "de antes" de la primera, porque el cartel puesto
// sigue diciendo eso y está desactualizado desde ese día (Gonzalo, 2026-10-29).

export type FilaTareaEtiqueta = Record<string, unknown> & { efectivo_anterior?: number | null };

export async function insertarTareasEtiqueta(supabase: SupabaseClient, filas: FilaTareaEtiqueta[]) {
  if (filas.length === 0) return;

  const cambios = filas.filter((f) => f.tipo === "CAMBIO_PRECIO");
  const abiertas = new Map<string, string>();
  if (cambios.length) {
    const { data } = await supabase
      .from("tareas_etiqueta")
      .select("id_tarea, id_producto, id_local")
      .eq("tipo", "CAMBIO_PRECIO")
      .in("estado", ["PENDIENTE", "VENCIDA"])
      .in("id_producto", [...new Set(cambios.map((f) => f.id_producto as string))]);
    for (const t of data ?? []) abiertas.set(`${t.id_producto}:${t.id_local}`, t.id_tarea as string);
  }

  const nuevas: FilaTareaEtiqueta[] = [];
  for (const f of filas) {
    const id = f.tipo === "CAMBIO_PRECIO" ? abiertas.get(`${f.id_producto}:${f.id_local}`) : undefined;
    if (id) await supabase.from("tareas_etiqueta").update({ precio_nuevo: f.precio_nuevo }).eq("id_tarea", id);
    else nuevas.push(f);
  }
  if (nuevas.length === 0) return;

  const { error } = await supabase.from("tareas_etiqueta").insert(nuevas);
  if (error && /efectivo_anterior/.test(error.message ?? "")) {
    const sinEfectivo = nuevas.map((f) => {
      const copia = { ...f };
      delete copia.efectivo_anterior;
      return copia;
    });
    await supabase.from("tareas_etiqueta").insert(sinEfectivo);
  }
}
