"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionMarca } from "@/lib/marcaSesion";
import { fechaHoraArgentina } from "@/lib/horarios";
import { NIVEL } from "@/lib/planesMarca";

// "Con qué se vende junto lo tuyo": el dato que la marca no puede conseguir
// de ningún otro lado.
//
// Ella sabe cuánto vendió —se lo decimos todos los meses— pero no sabe qué
// más había en esa misma bolsa, ni qué día. Eso solo lo sabe el que tiene la
// caja. Es lo más valioso que podemos darle y no nos cuesta nada: sale de
// ventas que ya están cargadas.
//
// Sale SIEMPRE agregado y sin nombres: nunca quién compró, y nunca de qué
// marca era lo que se llevó además. Que una marca se entere de que su cliente
// se lleva la proteína de la competencia es útil; saber de cuál, no es asunto
// suyo y nos pondría en el medio.

/** Cuánto para atrás se mira. */
const DIAS = 90;

/** Por debajo de esto cualquier porcentaje es ruido. */
const VENTAS_MINIMAS = 20;

const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];

export type CanastaPortal = {
  /** Null = la marca no tiene el plan. */
  habilitada: boolean;
  /** Ventas del período que incluyeron algún producto suyo. */
  ventas: number;
  /** Con tan pocas ventas los porcentajes no dicen nada todavía. */
  pocasVentas: boolean;
  desde: string;
  hasta: string;
  /** Qué más se llevaron, por rubro y sin decir de qué marca. */
  acompanantes: { etiqueta: string; porcentaje: number }[];
  /** Ventas donde no se llevaron nada más. */
  soloLoTuyo: number;
  /** Unidades suyas vendidas por día de la semana. */
  porDia: { dia: string; unidades: number }[];
};

export async function canastaPortal(): Promise<CanastaPortal | null> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return null;

  const vacio = (habilitada: boolean): CanastaPortal => ({
    habilitada,
    ventas: 0,
    pocasVentas: true,
    desde: "",
    hasta: "",
    acompanantes: [],
    soloLoTuyo: 0,
    porDia: ORDEN_SEMANA.map((d) => ({ dia: DIAS_SEMANA[d], unidades: 0 })),
  });

  // El plan se vuelve a mirar acá y no solo en el menú: esconder un link no
  // protege nada, la página se abre igual escribiendo la URL.
  if (NIVEL[sesion.plan] < NIVEL.GOLD) return vacio(false);

  const supabase = getSupabaseServerClient();
  const hasta = fechaHoraArgentina().fecha;
  const d = new Date(`${hasta}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - DIAS);
  const desde = d.toISOString().slice(0, 10);

  // Las anuladas quedan afuera: una venta que se devolvió no dice nada de lo
  // que la gente se lleva.
  const { data: ventas } = await supabase
    .from("ventas")
    .select("id_venta, fecha")
    .eq("estado", "PAGADA")
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);

  const fechaDeVenta = new Map((ventas ?? []).map((v) => [v.id_venta as string, v.fecha as string]));
  if (fechaDeVenta.size === 0) return { ...vacio(true), desde, hasta };

  // Las ventas que incluyeron algo suyo. Son el universo entero del informe:
  // el resto de las ventas del local no es asunto de esta marca.
  const { data: mios } = await supabase
    .from("detalle_ventas")
    .select("id_venta, cantidad")
    .eq("id_marca", sesion.idMarca)
    .in("id_venta", [...fechaDeVenta.keys()]);

  const unidadesPorVenta = new Map<string, number>();
  for (const r of mios ?? []) {
    const id = r.id_venta as string;
    unidadesPorVenta.set(id, (unidadesPorVenta.get(id) ?? 0) + ((r.cantidad as number) ?? 0));
  }
  const idsConLoMio = [...unidadesPorVenta.keys()];
  if (idsConLoMio.length === 0) return { ...vacio(true), desde, hasta };

  // Por día de la semana, en unidades suyas.
  const porDiaCrudo = new Map<number, number>();
  for (const [idVenta, unidades] of unidadesPorVenta) {
    const fecha = fechaDeVenta.get(idVenta);
    if (!fecha) continue;
    const dia = new Date(`${fecha.slice(0, 10)}T12:00:00Z`).getUTCDay();
    porDiaCrudo.set(dia, (porDiaCrudo.get(dia) ?? 0) + unidades);
  }

  // Todo lo demás que había en esas mismas ventas.
  const { data: acompanando } = await supabase
    .from("detalle_ventas")
    .select("id_venta, id_variante, id_marca")
    .in("id_venta", idsConLoMio)
    .neq("id_marca", sesion.idMarca);

  const rubroPorVariante = await rubrosDeVariante(
    supabase,
    [...new Set((acompanando ?? []).map((r) => r.id_variante as string))]
  );

  // Se cuenta una vez por venta y por rubro: dos barras de la misma categoría
  // en la misma bolsa son una sola señal, no dos.
  const ventasPorRubro = new Map<string, Set<string>>();
  const ventasConAlgoMas = new Set<string>();
  for (const r of acompanando ?? []) {
    const idVenta = r.id_venta as string;
    ventasConAlgoMas.add(idVenta);
    const rubro = rubroPorVariante.get(r.id_variante as string) ?? "Otros productos";
    if (!ventasPorRubro.has(rubro)) ventasPorRubro.set(rubro, new Set());
    ventasPorRubro.get(rubro)!.add(idVenta);
  }

  const total = idsConLoMio.length;
  const acompanantes = [...ventasPorRubro.entries()]
    .map(([etiqueta, ventas]) => ({
      etiqueta,
      porcentaje: Math.round((ventas.size / total) * 100),
    }))
    .filter((a) => a.porcentaje > 0)
    .sort((a, b) => b.porcentaje - a.porcentaje)
    .slice(0, 6);

  return {
    habilitada: true,
    ventas: total,
    pocasVentas: total < VENTAS_MINIMAS,
    desde,
    hasta,
    acompanantes,
    soloLoTuyo: Math.round(((total - ventasConAlgoMas.size) / total) * 100),
    porDia: ORDEN_SEMANA.map((d) => ({ dia: DIAS_SEMANA[d], unidades: porDiaCrudo.get(d) ?? 0 })),
  };
}

/**
 * De cada variante, el rubro con el que se la nombra.
 *
 * La subcategoría y no la marca, a propósito: "se llevan una proteína" es útil
 * para decidir un combo; "se llevan la proteína de Star Nutrition" la pone a
 * competir con un vecino al que le alquilamos la misma góndola.
 */
async function rubrosDeVariante(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  idsVariante: string[]
): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  if (idsVariante.length === 0) return salida;

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto")
    .in("id_variante", idsVariante);

  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto as string))];
  if (idsProducto.length === 0) return salida;

  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, id_subcategoria")
    .in("id_producto", idsProducto);

  const idsSub = [
    ...new Set((productos ?? []).map((p) => p.id_subcategoria as string | null).filter(Boolean)),
  ] as string[];
  const { data: subs } = idsSub.length
    ? await supabase.from("subcategorias").select("id_subcategoria, nombre").in("id_subcategoria", idsSub)
    : { data: [] as Record<string, unknown>[] };

  const nombreSub = new Map((subs ?? []).map((s) => [s.id_subcategoria as string, s.nombre as string]));
  const subDeProducto = new Map(
    (productos ?? []).map((p) => [
      p.id_producto as string,
      nombreSub.get(p.id_subcategoria as string) ?? "Otros productos",
    ])
  );

  for (const v of variantes ?? []) {
    salida.set(v.id_variante as string, subDeProducto.get(v.id_producto as string) ?? "Otros productos");
  }
  return salida;
}
