import type { SupabaseClient } from "@supabase/supabase-js";

// La góndola del local (sql/gondola.sql): los módulos de izquierda a derecha y
// el lugar de cada producto. La ubica Gonzalo en Precios → Góndola y la ve el
// cliente en la pantalla asesora (Gonzalo, 2026-10-29). Sin imports de
// servidor en los tipos: los usan las dos pantallas.

export type AlturaFila = "arriba" | "ojos" | "manos" | "abajo";
export type FilaGondola = { altura: AlturaFila; lugares: number; grande?: boolean };
/**
 * `puesto` false = planificado: el lugar es suyo pero el producto todavía no
 * está en la góndola (sql/gondola-puesto.sql). La pantalla asesora no lo usa.
 */
export type LugarGondola = { fila: number; columna: number; idProducto: string; nombre: string; puesto: boolean; motivo: string | null };

/** Por qué falta poner un producto planificado (se elige en Precios → Góndola). */
export const MOTIVOS_FALTA = ["Proveedor sin stock", "Falta fraccionar", "Lo estoy probando"] as const;
/**
 * Qué mueble del local es (sql/gondola-local-entero.sql):
 * - MODULO: módulo de ganchos de la pared izquierda.
 * - ISLA: un lado de una isla del centro (numero 1 = la de la entrada, 2 = la
 *   del fondo; lado IZQ = mirando a los módulos, DER = mirando a Animalfit).
 * - ESTANTERIA: una parte de la estantería de la pared derecha (numero 1 =
 *   adelante, 2 = fondo).
 * - FREEZER: un freezer vertical de la pared izquierda, después del M5, en la
 *   parte de atrás (numero 1 = el pegado al M5). Hoy hay uno, el de Alta; van a
 *   ser tres (sql/gondola-freezer.sql, Gonzalo 2026-11-05).
 */
export type TipoZona = "MODULO" | "ISLA" | "ESTANTERIA" | "FREEZER";

export type ModuloGondola = {
  id: string;
  orden: number;
  titulo: string;
  subtitulo: string | null;
  filas: FilaGondola[];
  lugares: LugarGondola[];
  tipo: TipoZona;
  numero: number | null;
  lado: "IZQ" | "DER" | null;
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
  const [conTipo, conPuesto] = await Promise.all([
    supabase.from("gondola_modulos").select("id_modulo, orden, titulo, subtitulo, filas, tipo, numero, lado").eq("id_local", idLocal).order("orden"),
    supabase.from("gondola_lugares").select("id_modulo, fila, columna, id_producto, puesto, motivo_falta, productos(nombre)").eq("id_local", idLocal),
  ]);
  // Sin sql/gondola-puesto.sql no existen puesto/motivo_falta: todo cuenta como puesto.
  let lugares = conPuesto as { data: Record<string, unknown>[] | null; error: unknown };
  if (conPuesto.error) {
    lugares = (await supabase.from("gondola_lugares").select("id_modulo, fila, columna, id_producto, productos(nombre)").eq("id_local", idLocal)) as typeof lugares;
  }
  // Sin sql/gondola-local-entero.sql no existen tipo/numero/lado: se piden sin
  // ellas y todo es módulo, como antes.
  let mods = conTipo as { data: Record<string, unknown>[] | null; error: unknown };
  if (conTipo.error) {
    mods = (await supabase.from("gondola_modulos").select("id_modulo, orden, titulo, subtitulo, filas").eq("id_local", idLocal).order("orden")) as typeof mods;
  }
  if (mods.error || lugares.error) return null;
  return (mods.data ?? []).map((m) => ({
    id: m.id_modulo as string,
    orden: Number(m.orden),
    titulo: m.titulo as string,
    subtitulo: (m.subtitulo as string | null) ?? null,
    tipo: m.tipo === "ISLA" || m.tipo === "ESTANTERIA" || m.tipo === "FREEZER" ? (m.tipo as TipoZona) : "MODULO",
    numero: m.numero == null ? null : Number(m.numero),
    lado: m.lado === "IZQ" || m.lado === "DER" ? (m.lado as "IZQ" | "DER") : null,
    filas: leerFilas(m.filas),
    lugares: (lugares.data ?? [])
      .filter((l) => l.id_modulo === m.id_modulo)
      .map((l) => ({
        fila: Number(l.fila),
        columna: Number(l.columna),
        idProducto: l.id_producto as string,
        nombre: (l.productos as unknown as { nombre: string } | null)?.nombre ?? "Producto",
        puesto: l.puesto !== false,
        motivo: (l.motivo_falta as string | null | undefined) ?? null,
      })),
  }));
}

/**
 * La góndola como la ve el cliente: solo lo que está puesto. Lo planificado
 * (lugar elegido, producto todavía no en la góndola) no se muestra ni se usa
 * para guiarlo, así no lo manda a buscar algo que no está.
 */
export function soloLoPuesto(gondola: ModuloGondola[]): ModuloGondola[] {
  return gondola.map((m) => ({ ...m, lugares: m.lugares.filter((l) => l.puesto) }));
}

export function ubicacionDe(modulos: ModuloGondola[], idProducto: string): UbicacionGondola | null {
  for (const modulo of modulos) {
    const l = modulo.lugares.find((x) => x.idProducto === idProducto);
    if (l) return { modulo, fila: l.fila, columna: l.columna };
  }
  return null;
}

/** Solo los módulos de ganchos de la pared izquierda, en su orden. */
export function soloModulos(gondola: ModuloGondola[]) {
  return gondola.filter((m) => m.tipo === "MODULO");
}

/** "Mueble 4", "Isla 1", "Estantería": el nombre corto de dónde está, para botones y carteles. */
export function nombreCortoZona(gondola: ModuloGondola[], m: ModuloGondola) {
  if (m.tipo === "ISLA") return `Isla ${m.numero ?? ""}`.trim();
  if (m.tipo === "ESTANTERIA") return m.titulo;
  if (m.tipo === "FREEZER") return `Freezer ${m.numero ?? ""}`.trim();
  return `Mueble ${soloModulos(gondola).indexOf(m) + 1}`;
}

/** Los freezers de la parte de atrás, del pegado al M5 al del fondo. */
export function soloFreezers(gondola: ModuloGondola[]) {
  return gondola.filter((m) => m.tipo === "FREEZER").sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
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
