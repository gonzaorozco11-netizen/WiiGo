import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina } from "@/lib/horarios";

// Días de cobertura: cuántos días le quedan de góndola a un producto al ritmo
// al que se está vendiendo.
//
// Por qué esto y no el mínimo fijo: un mínimo de 5 unidades no dice nada. Si
// el producto vende 1 por semana, 5 son más de un mes; si empieza a vender 3
// por día, son día y medio — y nadie se entera de que cambió. La cobertura se
// recalcula sola y no hay que mantener ningún número a mano.
//
// La ventana es de 28 días: suficiente para promediar sin arrastrar una
// temporada vieja.
const DIAS_VENTANA = 28;

/** Días de historial para que el número sirva de verdad. Antes de eso se muestra, pero avisando. */
export const DIAS_PARA_CONFIAR = 21;
/** Antes de esto ni siquiera se muestra: con 3 días de ventas el promedio es ruido. */
export const DIAS_MINIMOS = 7;

export type Cobertura = {
  /** Unidades por día en la ventana observada. */
  porDia: number;
  /** Cuántos días dura el stock actual a ese ritmo. null si no vende nada. */
  dias: number | null;
  /** Cuántos días de historial hay detrás del número. */
  diasObservados: number;
  /** false mientras haya poco historial: el número se muestra en gris. */
  confiable: boolean;
};

export type MapaCobertura = {
  /** Clave `${idVariante}_${idLocal}`. */
  porVarianteLocal: Map<string, Cobertura>;
  /** Días desde la primera venta del sistema. Es lo que define si ya hay algo que mostrar. */
  diasDeHistorial: number;
  /** true cuando todavía no hay ventas suficientes para calcular nada. */
  sinDatos: boolean;
};

/**
 * Calcula la cobertura de cada variante en cada local.
 *
 * Ojo con una trampa clásica que este cálculo TODAVÍA NO resuelve: los días en
 * que el producto estuvo en cero cuentan como "no vendió", cuando en realidad
 * fue "no se pudo vender". Eso hace que el sistema pida cada vez menos de los
 * productos que más se agotan — justo los mejores.
 *
 * No corre apuro y no se está perdiendo el dato: `movimientos_stock` registra
 * TODOS los cambios de stock, incluidas las ventas (tipo VENTA, tanto del POS
 * como del tótem), así que el stock de cualquier día pasado se reconstruye
 * restando los movimientos posteriores al stock de hoy. Cuando se arme el
 * recomendado automático hay que descontar esos días acá antes de dividir.
 */
export async function calcularCobertura(
  supabase: SupabaseClient,
  stockActual: { id_variante: string; id_local: string; cantidad: number }[]
): Promise<MapaCobertura> {
  const vacio: MapaCobertura = { porVarianteLocal: new Map(), diasDeHistorial: 0, sinDatos: true };

  const hoy = new Date(`${fechaHoraArgentina().fecha}T23:59:59-03:00`);
  const desde = new Date(hoy.getTime() - DIAS_VENTANA * 86400000);

  const { data: ventas } = await supabase
    .from("ventas")
    .select("id_venta, id_local, fecha")
    .eq("estado", "PAGADA")
    .gte("fecha", desde.toISOString());

  if (!ventas || ventas.length === 0) return vacio;

  // El historial se mide desde la primera venta registrada, no desde el borde
  // de la ventana: recién abierto, 4 ventas en 2 días no son 28 días de dato.
  const primera = ventas.reduce(
    (min, v) => Math.min(min, new Date(v.fecha as string).getTime()),
    Number.POSITIVE_INFINITY
  );
  const diasDeHistorial = Math.max(1, Math.round((hoy.getTime() - primera) / 86400000));
  if (diasDeHistorial < DIAS_MINIMOS) {
    return { porVarianteLocal: new Map(), diasDeHistorial, sinDatos: true };
  }

  const localDeVenta = new Map(ventas.map((v) => [v.id_venta as string, (v.id_local as string) ?? ""]));

  const { data: lineas } = await supabase
    .from("detalle_ventas")
    .select("id_venta, id_variante, cantidad")
    .in("id_venta", [...localDeVenta.keys()]);

  const vendidas = new Map<string, number>();
  (lineas ?? []).forEach((l) => {
    const idLocal = localDeVenta.get(l.id_venta as string);
    if (!idLocal) return;
    const clave = `${l.id_variante as string}_${idLocal}`;
    vendidas.set(clave, (vendidas.get(clave) ?? 0) + ((l.cantidad as number) ?? 0));
  });

  // El divisor es el historial real, acotado a la ventana: con 10 días desde
  // la apertura se divide por 10, no por 28, o el ritmo saldría 3 veces menor.
  const divisor = Math.min(diasDeHistorial, DIAS_VENTANA);
  const confiable = diasDeHistorial >= DIAS_PARA_CONFIAR;

  const porVarianteLocal = new Map<string, Cobertura>();
  stockActual.forEach((s) => {
    const clave = `${s.id_variante}_${s.id_local}`;
    const porDia = (vendidas.get(clave) ?? 0) / divisor;
    porVarianteLocal.set(clave, {
      porDia,
      dias: porDia > 0 ? s.cantidad / porDia : null,
      diasObservados: diasDeHistorial,
      confiable,
    });
  });

  return { porVarianteLocal, diasDeHistorial, sinDatos: false };
}
