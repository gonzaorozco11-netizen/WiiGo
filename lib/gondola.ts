import type { SupabaseClient } from "@supabase/supabase-js";

// La góndola del local (sql/gondola.sql): los módulos de izquierda a derecha y
// el lugar de cada producto. La ubica Gonzalo en Precios → Góndola y la ve el
// cliente en la pantalla asesora (Gonzalo, 2026-10-29). Sin imports de
// servidor en los tipos: los usan las dos pantallas.

export type AlturaFila = "arriba" | "ojos" | "manos" | "abajo";
export type FilaGondola = { altura: AlturaFila; lugares: number; grande?: boolean };
export type LugarGondola = { fila: number; columna: number; idProducto: string; nombre: string };
export type ModuloGondola = {
  id: string;
  orden: number;
  titulo: string;
  subtitulo: string | null;
  filas: FilaGondola[];
  lugares: LugarGondola[];
};
export type UbicacionGondola = { modulo: ModuloGondola; fila: number; columna: number };

export const NOMBRE_ALTURA: Record<AlturaFila, string> = { arriba: "Arriba", ojos: "Ojos", manos: "Manos", abajo: "Abajo" };

const ALTURAS: AlturaFila[] = ["arriba", "ojos", "manos", "abajo"];
function leerFilas(v: unknown): FilaGondola[] {
  if (!Array.isArray(v)) return [];
  return v.map((f) => {
    const o = (f ?? {}) as Record<string, unknown>;
    const altura = ALTURAS.includes(o.altura as AlturaFila) ? (o.altura as AlturaFila) : "manos";
    const lugares = Math.min(12, Math.max(1, Math.round(Number(o.lugares) || 6)));
    return { altura, lugares, grande: Boolean(o.grande) };
  });
}

/** Los módulos de un local con lo que hay en cada lugar. null si falta correr sql/gondola.sql. */
export async function cargarGondola(supabase: SupabaseClient, idLocal: string): Promise<ModuloGondola[] | null> {
  const [mods, lugares] = await Promise.all([
    supabase.from("gondola_modulos").select("id_modulo, orden, titulo, subtitulo, filas").eq("id_local", idLocal).order("orden"),
    supabase.from("gondola_lugares").select("id_modulo, fila, columna, id_producto, productos(nombre)").eq("id_local", idLocal),
  ]);
  if (mods.error || lugares.error) return null;
  return (mods.data ?? []).map((m) => ({
    id: m.id_modulo as string,
    orden: Number(m.orden),
    titulo: m.titulo as string,
    subtitulo: (m.subtitulo as string | null) ?? null,
    filas: leerFilas(m.filas),
    lugares: (lugares.data ?? [])
      .filter((l) => l.id_modulo === m.id_modulo)
      .map((l) => ({
        fila: Number(l.fila),
        columna: Number(l.columna),
        idProducto: l.id_producto as string,
        nombre: (l.productos as unknown as { nombre: string } | null)?.nombre ?? "Producto",
      })),
  }));
}

export function ubicacionDe(modulos: ModuloGondola[], idProducto: string): UbicacionGondola | null {
  for (const modulo of modulos) {
    const l = modulo.lugares.find((x) => x.idProducto === idProducto);
    if (l) return { modulo, fila: l.fila, columna: l.columna };
  }
  return null;
}

/** "El primero de la izquierda", "el 3.º desde la izquierda", "el último, a la derecha". */
export function textoPosicionModulo(orden: number, total: number) {
  if (orden === 1) return "El primero de la izquierda";
  if (orden === total) return "El último, a la derecha";
  return `El ${orden}.º desde la izquierda`;
}

/** Un color de relleno para la ventanita de la bolsa, siempre el mismo para cada producto. */
export function colorDeProducto(nombre: string) {
  const tonos = ["#a57349", "#9b6a43", "#c9a46e", "#d8b07a", "#7a4a2a", "#3d2a2a", "#9b2f3a", "#e3cfa2", "#e6c56a", "#5a3a22", "#8fa05a", "#b5864f"];
  let h = 0;
  for (const ch of nombre) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return tonos[h % tonos.length];
}
