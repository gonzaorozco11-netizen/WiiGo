// Cuánto pedirle a una marca, calculado con lo que de verdad se vendió.
//
// Antes la sugerencia salía de `stock_minimo` y `stock_objetivo`: dos números
// que alguien escribió una vez al cargar la variante y que nadie vuelve a
// tocar. Sirven de piso, pero no saben que un producto pasó de vender dos por
// semana a vender nueve.
//
// La cuenta es la de cualquier reposición de retail:
//
//   por semana = vendidas en la ventana / semanas de la ventana
//   objetivo   = por semana × semanas de cobertura
//   sugerido   = objetivo − lo que hay − lo que ya está pedido y no llegó
//
// Las dos restas del final son las que evitan los dos errores caros: pedir lo
// que ya está en la góndola, y pedir de nuevo lo que viene en camino.
//
// NO decide sola: el resultado precarga la pantalla de armar la orden y
// administración lo revisa antes de mandar. En consignación la mercadería es
// de la marca pero la góndola es de WiiGo, y cuánto espacio ocupa cada marca
// es una decisión comercial, no una cuenta.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ESTADOS_ABIERTOS } from "@/lib/estadosOrden";

/** Por qué salió ese número. La pantalla lo muestra para que se pueda discutir. */
export type MotivoSugerencia =
  /** Manda la velocidad de venta. */
  | "VENTAS"
  /** Vendió poco o nada, pero hay que tenerlo en góndola igual. */
  | "MINIMO"
  /** Todavía no hay ventas en la ventana: solo se mira el mínimo. */
  | "SIN_HISTORIA";

export type SugerenciaVariante = {
  idVariante: string;
  /** Unidades vendidas en la ventana, en ese local. */
  vendidas: number;
  porSemana: number;
  /** Lo que hay hoy en ese local. */
  stock: number;
  /** Pedido en órdenes todavía abiertas y que no llegó. */
  pendiente: number;
  objetivo: number;
  sugerido: number;
  motivo: MotivoSugerencia;
};

export type OpcionesSugerencia = {
  idMarca: string;
  idLocal: string;
  /** Cuánto para atrás se mira para medir la velocidad. */
  semanasHistoria?: number;
  /** Para cuántas semanas se quiere tener mercadería. */
  semanasCobertura?: number;
};

/**
 * Cuántas semanas de mercadería tener. Cuatro atrás y tres adelante son el
 * arranque razonable para una dietética: cuatro semanas alcanzan para que una
 * semana floja no mueva la media, y tres de cobertura dan aire para que una
 * entrega que se atrasa no deje la góndola vacía.
 *
 * Por marca va a convenir que cambie —una de ticket alto que vende de a poco
 * quiere más cobertura— pero eso es un campo que todavía no existe, y un
 * default sensato sirve hasta que exista.
 */
export const SEMANAS_HISTORIA = 4;
export const SEMANAS_COBERTURA = 3;

/**
 * Qué pedirle a una marca para un local.
 *
 * Devuelve un mapa por variante, incluidas las que dan cero: la pantalla
 * necesita poder mostrar "este no hace falta" y por qué.
 *
 * Nunca tira: si una consulta falla, esa parte cuenta como cero y la
 * sugerencia sale igual con lo que haya. Una reposición a medias se corrige
 * mirando; una pantalla que no abre, no.
 */
export async function sugerirReposicion(
  supabase: SupabaseClient,
  opciones: OpcionesSugerencia
): Promise<Map<string, SugerenciaVariante>> {
  const {
    idMarca,
    idLocal,
    semanasHistoria = SEMANAS_HISTORIA,
    semanasCobertura = SEMANAS_COBERTURA,
  } = opciones;

  const salida = new Map<string, SugerenciaVariante>();
  if (!idMarca || !idLocal) return salida;

  // Las variantes de la marca, con su piso.
  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto")
    .eq("id_marca", idMarca)
    .eq("estado", "ACTIVO");
  const idsProducto = (productos ?? []).map((p) => p.id_producto as string);
  if (idsProducto.length === 0) return salida;

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, stock_minimo, stock_objetivo")
    .in("id_producto", idsProducto)
    .eq("estado", "ACTIVO");
  const lista = variantes ?? [];
  if (lista.length === 0) return salida;

  const ids = lista.map((v) => v.id_variante as string);

  const [vendidas, stock, pendiente] = await Promise.all([
    vendidasPorVariante(supabase, ids, idLocal, semanasHistoria),
    stockPorVariante(supabase, ids, idLocal),
    pendientePorVariante(supabase, idMarca, idLocal, ids),
  ]);

  for (const v of lista) {
    const id = v.id_variante as string;
    const minimo = (v.stock_minimo as number) ?? 0;
    // El objetivo cargado a mano sigue valiendo de piso cuando no hay ventas:
    // es lo que alguien decidió que tiene que estar en la góndola.
    const objetivoFijo = (v.stock_objetivo as number) ?? 0;

    const vend = vendidas.get(id) ?? 0;
    const hay = stock.get(id) ?? 0;
    const enCamino = pendiente.get(id) ?? 0;

    const porSemana = semanasHistoria > 0 ? vend / semanasHistoria : 0;
    const porVentas = Math.ceil(porSemana * semanasCobertura);

    // Nunca por debajo de lo que se decidió tener en góndola. Un producto que
    // no vendió nada este mes igual tiene que estar: si no está, no se vende,
    // y la próxima medición vuelve a dar cero. Es la trampa clásica de
    // reponer solo por ventas.
    const piso = Math.max(minimo, objetivoFijo);
    const objetivo = Math.max(porVentas, piso);

    const sugerido = Math.max(0, objetivo - hay - enCamino);

    const motivo: MotivoSugerencia =
      vend === 0 ? "SIN_HISTORIA" : porVentas >= piso ? "VENTAS" : "MINIMO";

    salida.set(id, {
      idVariante: id,
      vendidas: vend,
      porSemana: Math.round(porSemana * 10) / 10,
      stock: hay,
      pendiente: enCamino,
      objetivo,
      sugerido,
      motivo,
    });
  }

  return salida;
}

/** Unidades vendidas por variante en ese local, en la ventana. */
async function vendidasPorVariante(
  supabase: SupabaseClient,
  idsVariante: string[],
  idLocal: string,
  semanas: number
): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const desde = new Date();
  desde.setDate(desde.getDate() - semanas * 7);

  // Solo las pagadas: un carrito abandonado no es demanda.
  const { data: ventas } = await supabase
    .from("ventas")
    .select("id_venta")
    .eq("estado", "PAGADA")
    .eq("id_local", idLocal)
    .gte("fecha", desde.toISOString());

  const idsVenta = (ventas ?? []).map((v) => v.id_venta as string);
  if (idsVenta.length === 0) return mapa;

  // De a tandas: una lista de ids de varios meses de ventas no entra en una
  // sola URL de PostgREST.
  for (let i = 0; i < idsVenta.length; i += 200) {
    const tanda = idsVenta.slice(i, i + 200);
    const { data: renglones } = await supabase
      .from("detalle_ventas")
      .select("id_variante, cantidad")
      .in("id_venta", tanda)
      .in("id_variante", idsVariante);
    for (const r of renglones ?? []) {
      const id = r.id_variante as string;
      mapa.set(id, (mapa.get(id) ?? 0) + ((r.cantidad as number) ?? 0));
    }
  }

  return mapa;
}

async function stockPorVariante(
  supabase: SupabaseClient,
  idsVariante: string[],
  idLocal: string
): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const { data } = await supabase
    .from("stock")
    .select("id_variante, cantidad")
    .eq("id_local", idLocal)
    .in("id_variante", idsVariante);
  for (const s of data ?? []) {
    const id = s.id_variante as string;
    mapa.set(id, (mapa.get(id) ?? 0) + ((s.cantidad as number) ?? 0));
  }
  return mapa;
}

/**
 * Lo pedido y todavía no recibido.
 *
 * Sin esto, armar una orden el jueves cuando la del lunes no llegó pide todo
 * de nuevo, y a la semana hay el doble de mercadería de la marca en el
 * depósito — que en consignación es plata de ella parada en el local de WiiGo.
 */
async function pendientePorVariante(
  supabase: SupabaseClient,
  idMarca: string,
  idLocal: string,
  idsVariante: string[]
): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();

  const { data: ordenes } = await supabase
    .from("ordenes_reposicion")
    .select("id_orden")
    .eq("id_marca", idMarca)
    .eq("id_local", idLocal)
    .in("estado", ESTADOS_ABIERTOS);

  const idsOrden = (ordenes ?? []).map((o) => o.id_orden as string);
  if (idsOrden.length === 0) return mapa;

  const { data: renglones } = await supabase
    .from("detalle_reposicion")
    .select("id_variante, cantidad_solicitada, cantidad_recibida")
    .in("id_orden", idsOrden)
    .in("id_variante", idsVariante);

  for (const r of renglones ?? []) {
    const falta = ((r.cantidad_solicitada as number) ?? 0) - ((r.cantidad_recibida as number) ?? 0);
    if (falta <= 0) continue;
    const id = r.id_variante as string;
    mapa.set(id, (mapa.get(id) ?? 0) + falta);
  }

  return mapa;
}
