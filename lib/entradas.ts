import { getSupabaseServerClient } from "@/lib/supabase";
import { esCodigoInterno } from "@/lib/codigos";

/**
 * Lo que entró por recepción y todavía necesita que le impriman el código.
 *
 * Nace de una cosa concreta de la operativa: los frutos secos vienen
 * embolsados pero sin código de barras. Si entraron 6 bolsas de almendras, hay
 * que imprimir 6 stickers y pegarlos antes de que vayan a la góndola.
 *
 * Se lee de `movimientos_stock` y no de la orden porque así cubre los dos
 * caminos —lo que manda una marca y lo que se le compra a un proveedor— con
 * una sola consulta, y sobre todo porque sigue estando ahí si la operativa
 * cerró la pantalla sin imprimir. La orden se recepciona una vez; la etiqueta
 * puede quedar pendiente hasta el día siguiente.
 */
export type EntradaPendiente = {
  idVariante: string;
  /** Unidades que entraron y hay que etiquetar. */
  cantidad: number;
  /** Cuándo entró la última, para poder decir "hoy" o "el martes". */
  ultima: string;
};

export async function entradasQueNecesitanCodigo(dias = 7): Promise<EntradaPendiente[]> {
  const supabase = getSupabaseServerClient();
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);

  const { data: movimientos } = await supabase
    .from("movimientos_stock")
    .select("id_variante,cantidad,fecha")
    .eq("tipo", "RECEPCION")
    .gte("fecha", desde.toISOString());

  const filas = (movimientos ?? []) as { id_variante: string; cantidad: number; fecha: string }[];
  if (filas.length === 0) return [];

  // Solo las que llevan código impreso por nosotros: si el envase trae el
  // suyo, no hay nada que pegarle.
  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante,codigo_barras")
    .in("id_variante", [...new Set(filas.map((m) => m.id_variante))])
    .eq("estado", "ACTIVO");

  const necesitan = new Set(
    ((variantes ?? []) as { id_variante: string; codigo_barras: string | null }[])
      .filter((v) => !v.codigo_barras || esCodigoInterno(v.codigo_barras))
      .map((v) => v.id_variante)
  );

  const porVariante = new Map<string, EntradaPendiente>();
  for (const m of filas) {
    if (!necesitan.has(m.id_variante)) continue;
    const actual = porVariante.get(m.id_variante);
    if (actual) {
      actual.cantidad += m.cantidad;
      if (m.fecha > actual.ultima) actual.ultima = m.fecha;
    } else {
      porVariante.set(m.id_variante, {
        idVariante: m.id_variante,
        cantidad: m.cantidad,
        ultima: m.fecha,
      });
    }
  }

  return [...porVariante.values()].sort((a, b) => b.ultima.localeCompare(a.ultima));
}
