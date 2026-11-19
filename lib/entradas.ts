import { getSupabaseServerClient } from "@/lib/supabase";
import { esCodigoInterno } from "@/lib/codigos";
import { cargarMarcasSinCodigo, cargarProductosSinCodigo } from "@/lib/marcasSinCodigo";
import { PARAMETRO_CARTELES_IMPRESOS, cargarCodigosImpresos, cargarImpresos } from "@/lib/codigosImpresos";
import { ESTADO_GRANEL } from "@/lib/granel";

// Lo que entra al local: lo que manda una marca (RECEPCION), lo que se le compra a
// un proveedor como Alifrut (COMPRA_PROVEEDOR; Gonzalo 19/11: las Granola Cream
// recibidas no pedían su sticker) y lo embolsado en el local (FRACCIONADO).
// El granel del depósito (en gramos) entra igual, pero no lleva sticker ni cartel.
const TIPOS_ENTRADA = ["RECEPCION", "COMPRA_PROVEEDOR", "FRACCIONADO"];

/**
 * Los productos que entraron en los últimos días (recepción o fraccionado),
 * con la fecha de la última entrada: para los carteles de góndola de lo nuevo
 * (Gonzalo, 2026-11-11). Uno por producto, no por sabor: el cartel es uno.
 */
export async function productosQueEntraron(dias = 7): Promise<Map<string, string>> {
  const supabase = getSupabaseServerClient();
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);
  const { data: movs } = await supabase
    .from("movimientos_stock")
    .select("id_variante, fecha")
    // Los carteles siguen como antes (sin lo de proveedores): no se pidió cambiarlos.
    .in("tipo", ["RECEPCION", "FRACCIONADO"])
    .gt("cantidad", 0)
    .gte("fecha", desde.toISOString())
    .range(0, 4999);
  const filas = (movs ?? []) as { id_variante: string; fecha: string }[];
  if (!filas.length) return new Map();
  const { data: vars } = await supabase.from("variantes_producto").select("id_variante, id_producto, productos(estado)").in("id_variante", [...new Set(filas.map((m) => m.id_variante))]);
  const productoDe = new Map(
    (vars ?? [])
      .filter((v) => (v.productos as unknown as { estado: string } | null)?.estado !== ESTADO_GRANEL)
      .map((v) => [v.id_variante as string, v.id_producto as string])
  );
  const ultima = new Map<string, string>();
  for (const m of filas) {
    const id = productoDe.get(m.id_variante);
    if (id && (!ultima.has(id) || m.fecha > ultima.get(id)!)) ultima.set(id, m.fecha);
  }
  return ultima;
}

/** Cuántos productos entraron en la semana y todavía no tienen su cartel de góndola impreso. */
export async function cartelesNuevosPendientes(): Promise<number> {
  const supabase = getSupabaseServerClient();
  const [entraron, impresos] = await Promise.all([
    productosQueEntraron(),
    cargarImpresos(supabase, PARAMETRO_CARTELES_IMPRESOS).catch(() => ({}) as Record<string, string>),
  ]);
  let n = 0;
  for (const [id, entro] of entraron) if (!(impresos[id] && impresos[id] >= entro)) n++;
  return n;
}

/**
 * Cuántos productos entraron (recepción o fraccionado) y llevan sticker de
 * WiiGo que todavía no se imprimió: lo embolsado acá, las marcas sin código
 * (Alta, Fruppi, Crislo) y los productos sueltos sin código (granolas). Es el
 * número rojo de «Códigos de barras» en el inicio del equipo, para que no se
 * olviden de etiquetar lo que entró (Gonzalo, 2026-11-11).
 */
export async function stickersPorPegar(): Promise<{ productos: number; unidades: number }> {
  const faltan = await entradasSinSticker();
  return { productos: faltan.length, unidades: faltan.reduce((t, e) => t + e.cantidad, 0) };
}

/**
 * Lo que entró y todavía no tiene su sticker impreso, ya filtrado: solo lo que
 * lleva sticker de WiiGo y no se anotó como impreso después de entrar. Es la
 * misma cuenta que «Sin sticker todavía» en Códigos. El cartel de Recepción
 * usaba la lista sin filtrar y seguía pidiendo los 11 de Fruppi que ya se
 * habían impreso (2026-11-12).
 */
export async function entradasSinSticker(): Promise<EntradaPendiente[]> {
  const supabase = getSupabaseServerClient();
  const entradas = await entradasQueNecesitanCodigo();
  if (!entradas.length) return [];
  const [{ data: vars }, { data: marcasPropias }, marcasSin, productosSin, impresos] = await Promise.all([
    supabase.from("variantes_producto").select("id_variante, productos(id_producto, id_marca, id_envase)").in("id_variante", entradas.map((e) => e.idVariante)),
    supabase.from("marcas").select("id_marca").eq("tipo_comercializacion", "PROPIA"),
    cargarMarcasSinCodigo(supabase).catch(() => new Set<string>()),
    cargarProductosSinCodigo(supabase).catch(() => new Set<string>()),
    cargarCodigosImpresos(supabase).catch(() => ({}) as Record<string, string>),
  ]);
  const propias = new Set((marcasPropias ?? []).map((m) => m.id_marca as string));
  const llevaSticker = new Map(
    (vars ?? []).map((v) => {
      const p = v.productos as unknown as { id_producto: string; id_marca: string; id_envase: string | null } | null;
      const lleva = Boolean(p) && ((propias.has(p!.id_marca) && Boolean(p!.id_envase)) || marcasSin.has(p!.id_marca) || productosSin.has(p!.id_producto));
      return [v.id_variante as string, lleva];
    })
  );
  return entradas.filter((e) => llevaSticker.get(e.idVariante) && !(impresos[e.idVariante] && impresos[e.idVariante] >= e.ultima));
}

/**
 * Lo mismo que entradasSinSticker, con el nombre: para sumarlo a la hoja de las
 * etiquetas de la tanda de Fraccionar (Gonzalo, 19/11: «así aprovecho toda la plancha»).
 * Sin lo embolsado en el local: eso ya va en la tanda por su lado.
 */
export type RecibidoSinCodigo = { idVariante: string; nombre: string; n: number };

export async function recibidosSinCodigo(): Promise<RecibidoSinCodigo[]> {
  const supabase = getSupabaseServerClient();
  const faltan = await entradasSinSticker();
  if (!faltan.length) return [];
  const { data } = await supabase
    .from("variantes_producto")
    .select("id_variante, nombre, productos(nombre, id_envase)")
    .in("id_variante", faltan.map((e) => e.idVariante));
  const info = new Map(
    ((data ?? []) as unknown as { id_variante: string; nombre: string; productos: { nombre: string; id_envase: string | null } | null }[]).map((v) => [v.id_variante, v])
  );
  return faltan
    .filter((e) => info.get(e.idVariante)?.productos && !info.get(e.idVariante)!.productos!.id_envase)
    .map((e) => {
      const v = info.get(e.idVariante)!;
      return { idVariante: e.idVariante, nombre: `${v.productos!.nombre}${v.nombre && v.nombre !== "Único" ? ` — ${v.nombre}` : ""}`, n: e.cantidad };
    });
}

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
    // También lo que se embolsó en el local (Fraccionar): son bolsitas que
    // necesitan su sticker igual que lo que llega embolsado.
    .in("tipo", TIPOS_ENTRADA)
    .gt("cantidad", 0)
    .gte("fecha", desde.toISOString());

  const filas = (movimientos ?? []) as { id_variante: string; cantidad: number; fecha: string }[];
  if (filas.length === 0) return [];

  // Solo las que llevan código impreso por nosotros: si el envase trae el
  // suyo, no hay nada que pegarle.
  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante,codigo_barras,productos(estado)")
    .in("id_variante", [...new Set(filas.map((m) => m.id_variante))])
    .eq("estado", "ACTIVO");

  const necesitan = new Set(
    ((variantes ?? []) as unknown as { id_variante: string; codigo_barras: string | null; productos: { estado: string } | null }[])
      .filter((v) => v.productos?.estado !== ESTADO_GRANEL)
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
