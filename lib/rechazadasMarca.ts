import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Las solicitudes que WiiGo no aprobó y la marca todavía no volvió a mandar.
 *
 * Una rechazada queda RECHAZADA para siempre (es el registro), así que contar
 * todas las rechazadas dejaba el aviso «Una solicitud que no se aprobó» puesto
 * aunque la marca ya la hubiera corregido. Se da por corregida cuando hay una
 * solicitud posterior del mismo tipo para el mismo producto (que no haya
 * cancelado ella). Las altas de producto nuevo todavía no tienen producto: ahí
 * se compara por el nombre que mandó.
 *
 * Caso que lo destapó (2026-11-07): Animalfit mandó las cookies a $1.100 en
 * vez de $11.000, se rechazó, y el aviso lo llevaba a una lista de 60 donde
 * esa solicitud ni aparecía.
 */
export type Rechazada = { idSolicitud: string; idProducto: string | null; tipo: string };

export async function rechazadasSinCorregir(supabase: SupabaseClient, idMarca: string): Promise<Rechazada[]> {
  const { data } = await supabase
    .from("solicitudes_marca")
    .select("id_solicitud, id_producto, tipo, estado, solicitada_el, datos")
    .eq("id_marca", idMarca)
    .range(0, 4999);
  const filas = (data ?? []) as {
    id_solicitud: string;
    id_producto: string | null;
    tipo: string;
    estado: string;
    solicitada_el: string;
    datos: Record<string, unknown> | null;
  }[];

  const clave = (f: (typeof filas)[number]) =>
    `${f.tipo}|${f.id_producto ?? `nuevo:${String(f.datos?.nombre ?? "").trim().toLowerCase()}`}`;

  return filas
    .filter((r) => r.estado === "RECHAZADA")
    .filter(
      (r) =>
        !filas.some(
          (o) => o.id_solicitud !== r.id_solicitud && o.estado !== "CANCELADA" && clave(o) === clave(r) && o.solicitada_el > r.solicitada_el
        )
    )
    .map((r) => ({ idSolicitud: r.id_solicitud, idProducto: r.id_producto, tipo: r.tipo }));
}
