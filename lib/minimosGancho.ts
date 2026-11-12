import type { SupabaseClient } from "@supabase/supabase-js";

// Lo que va colgado en los ganchos de la pared (los blisteros) de la marca
// propia: 5 en el blistero y 3 guardados en el cajón (Gonzalo, 2026-11-12).
// Mínimo 5: cuando se vacía el cajón entra en el pedido, y mientras llega el
// blistero sigue lleno. Máximo 8: blistero más cajón.
export const MINIMO_GANCHO = 5;
export const MAXIMO_GANCHO = 8;

/**
 * Al colgar un producto propio en un gancho, toma 5 y 8.
 *
 * Solo si todavía tiene los números de cuando se cargó (3 y 5, o nada): si
 * alguien ya le puso los suyos en Mínimos y objetivos, se respetan. Nunca
 * tira: el lugar en la góndola ya quedó guardado, esto es lo accesorio.
 */
export async function minMaxAlColgar(supabase: SupabaseClient, idModulo: string, idProducto: string): Promise<void> {
  try {
    const [{ data: modulo }, { data: producto }] = await Promise.all([
      supabase.from("gondola_modulos").select("tipo").eq("id_modulo", idModulo).maybeSingle(),
      supabase.from("productos").select("id_marca, marcas(tipo_comercializacion)").eq("id_producto", idProducto).maybeSingle(),
    ]);
    // Sin tipo es un módulo de pared, como en lib/gondola.ts.
    const esGancho = Boolean(modulo) && (!modulo!.tipo || modulo!.tipo === "MODULO");
    const propia = (producto?.marcas as { tipo_comercializacion?: string } | null)?.tipo_comercializacion === "PROPIA";
    if (!esGancho || !propia) return;
    const { data: variantes } = await supabase.from("variantes_producto").select("id_variante, stock_minimo, stock_objetivo").eq("id_producto", idProducto);
    const deFabrica = (variantes ?? []).filter((v) => {
      const min = Number(v.stock_minimo ?? 0);
      const max = Number(v.stock_objetivo ?? 0);
      return (min === 3 && max === 5) || (min === 0 && max === 0);
    });
    if (deFabrica.length === 0) return;
    await supabase
      .from("variantes_producto")
      .update({ stock_minimo: MINIMO_GANCHO, stock_objetivo: MAXIMO_GANCHO })
      .in("id_variante", deFabrica.map((v) => v.id_variante as string));
  } catch {
    // Silencio a propósito: ver arriba.
  }
}
