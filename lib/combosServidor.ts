import type { SupabaseClient } from "@supabase/supabase-js";
import type { Combo, GrupoCombo } from "@/lib/combos";

/**
 * Los combos activos (tabla `combos`, sql/combos.sql). Si la tabla todavía no
 * existe o algo falla, no hay combos: la venta sigue igual que siempre.
 */
export async function traerCombos(supabase: SupabaseClient): Promise<Combo[]> {
  try {
    const { data, error } = await supabase.from("combos").select("*").eq("estado", "ACTIVO").order("orden", { ascending: true });
    if (error || !data) return [];
    return data
      .map((c) => {
        const grupos = (Array.isArray(c.grupos) ? c.grupos : [])
          .map((g: { cantidad?: unknown; productos?: unknown }) => ({
            cantidad: Math.max(1, Math.floor(Number(g?.cantidad) || 1)),
            productos: Array.isArray(g?.productos) ? (g.productos as unknown[]).filter((x): x is string => typeof x === "string") : [],
          }))
          .filter((g: GrupoCombo) => g.productos.length > 0);
        return {
          id: c.id_combo as string,
          nombre: c.nombre as string,
          marca: (c.marca as string | null) ?? null,
          precio: Number(c.precio) || 0,
          precioEfectivo: c.precio_efectivo == null ? null : Number(c.precio_efectivo),
          imagen: (c.imagen as string | null) ?? null,
          grupos,
          orden: Number(c.orden) || 0,
        } satisfies Combo;
      })
      .filter((c) => c.precio > 0 && c.grupos.length > 0);
  } catch {
    return [];
  }
}

/** El producto de cada variante, para saber a qué combo puede entrar cada renglón. */
export async function productoDeVariantes(supabase: SupabaseClient, idsVariante: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(idsVariante.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("variantes_producto").select("id_variante, id_producto").in("id_variante", ids);
  return new Map((data ?? []).map((v) => [v.id_variante as string, v.id_producto as string]));
}
