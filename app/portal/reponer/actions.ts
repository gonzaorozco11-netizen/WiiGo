"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionMarca } from "@/lib/marcaSesion";
import { fechaHoraArgentina } from "@/lib/horarios";
import { sugerirReposicion, topeDeVariante } from "@/lib/reposicionSugerida";
import { ESTADOS_ABIERTOS } from "@/lib/estadosOrden";
import { leerDias, diasHastaProxima, nombrarDias, DIAS_SEMANA } from "@/lib/recepcion";

// La orden de reposición, del lado de la marca.
//
// No se arma: ya está armada. La marca entra, mira y manda. Todo el cálculo
// sale de `sugerirReposicion`, que es el mismo que usa WiiGo del lado de
// adentro — si cada lado calculara lo suyo, la marca y nosotros veríamos
// números distintos del mismo producto y la discusión sería sobre quién tiene
// razón en vez de sobre cuánto mandar.
//
// Por qué módulo propio y no un botón en Mis productos: un botón hay que
// acordarse de apretarlo. Una pantalla con contador en el menú reclama sola.

const PENDIENTE = "PENDIENTE";
const PROPUESTA = "PROPUESTA";

export type RenglonReponer = {
  idVariante: string;
  producto: string;
  variante: string;
  /** Lo que hay hoy en la góndola. */
  stock: number;
  minimo: number;
  objetivo: number;
  /** En camino: pedido en una orden abierta que todavía no llegó. */
  enCamino: number;
  porSemana: number;
  /** Lo que el sistema propone mandar. 0 = no hace falta. */
  sugerido: number;
  /** Lo máximo que puede entrar sin que lo tenga que aprobar WiiGo. */
  tope: number;
  estado: "AGOTADO" | "BAJO" | "OK";
};

export type GondolaReponer = {
  nombre: string;
  renglones: RenglonReponer[];
};

export type DatosReponer = {
  gondolas: GondolaReponer[];
  agotados: number;
  bajos: number;
  /** Unidades y pesos a precio de venta de lo sugerido. */
  unidades: number;
  valorizado: number;
  /** Cuándo es la próxima recepción. */
  proxima: { etiqueta: string; faltanDias: number; horario: string } | null;
  /** Una orden ya mandada y todavía sin recibir. */
  yaMandado: { unidades: number; estado: string } | null;
};

export async function miReposicion(): Promise<DatosReponer | null> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();

  const { data: locales } = await supabase
    .from("locales")
    .select("id_local")
    .eq("estado", "ACTIVO")
    .limit(1);
  const idLocal = (locales ?? [])[0]?.id_local as string | undefined;
  if (!idLocal) return null;

  const [sugerencias, { data: productos }, { data: config }] = await Promise.all([
    sugerirReposicion(supabase, { idMarca: sesion.idMarca, idLocal }),
    supabase
      .from("productos")
      .select("id_producto, nombre, precio_venta, subcategorias(nombre)")
      .eq("id_marca", sesion.idMarca)
      .eq("estado", "ACTIVO"),
    supabase
      .from("configuracion")
      .select("parametro, valor")
      .in("parametro", ["RECEPCION_DIAS", "RECEPCION_HORA_DESDE", "RECEPCION_HORA_HASTA"]),
  ]);

  const idsProducto = (productos ?? []).map((p) => p.id_producto as string);
  const { data: variantes } = idsProducto.length
    ? await supabase
        .from("variantes_producto")
        .select("id_variante, id_producto, nombre, stock_minimo, stock_objetivo")
        .in("id_producto", idsProducto)
        .eq("estado", "ACTIVO")
    : { data: [] as Record<string, unknown>[] };

  const datosProducto = new Map(
    (productos ?? []).map((p) => [
      p.id_producto as string,
      {
        nombre: (p.nombre as string) ?? "Producto",
        precio: (p.precio_venta as number | null) ?? 0,
        gondola: ((p.subcategorias as { nombre?: string } | null)?.nombre as string) ?? "Sin góndola",
      },
    ])
  );

  const porGondola = new Map<string, RenglonReponer[]>();
  let agotados = 0;
  let bajos = 0;
  let unidades = 0;
  let valorizado = 0;

  for (const v of variantes ?? []) {
    const idVariante = v.id_variante as string;
    const prod = datosProducto.get(v.id_producto as string);
    if (!prod) continue;

    const s = sugerencias.get(idVariante);
    const stock = s?.stock ?? 0;
    const minimo = (v.stock_minimo as number | null) ?? 0;
    const objetivo = s?.objetivo ?? ((v.stock_objetivo as number | null) ?? 0);
    const sugerido = s?.sugerido ?? 0;

    // Agotado es cero de verdad. Bajo es por debajo del mínimo, que con días
    // fijos de recepción significa "no llega a la próxima" — ya no es el
    // disparador del pedido, es la alarma.
    const estado: RenglonReponer["estado"] =
      stock <= 0 ? "AGOTADO" : minimo > 0 && stock < minimo ? "BAJO" : "OK";

    if (estado === "AGOTADO") agotados++;
    if (estado === "BAJO") bajos++;
    unidades += sugerido;
    valorizado += sugerido * prod.precio;

    const fila: RenglonReponer = {
      idVariante,
      producto: prod.nombre,
      variante: (v.nombre as string) ?? "Único",
      stock,
      minimo,
      objetivo,
      enCamino: s?.pendiente ?? 0,
      porSemana: s?.porSemana ?? 0,
      sugerido,
      tope: topeDeVariante(objetivo),
      estado,
    };
    porGondola.set(prod.gondola, [...(porGondola.get(prod.gondola) ?? []), fila]);
  }

  // La góndola que tiene algo para mandar va primero: lo que hay que mirar
  // arriba, lo que está al día abajo.
  const gondolas = [...porGondola.entries()]
    .map(([nombre, renglones]) => ({
      nombre,
      renglones: renglones.sort((a, b) => {
        const peso = (r: RenglonReponer) => (r.estado === "AGOTADO" ? 0 : r.estado === "BAJO" ? 1 : 2);
        return peso(a) - peso(b) || a.producto.localeCompare(b.producto);
      }),
    }))
    .sort((a, b) => {
      const falta = (g: GondolaReponer) => g.renglones.filter((r) => r.sugerido > 0).length;
      return falta(b) - falta(a) || a.nombre.localeCompare(b.nombre);
    });

  const cfg = new Map((config ?? []).map((c) => [c.parametro as string, c.valor as string]));
  const dias = leerDias(cfg.get("RECEPCION_DIAS"));
  const hoy = fechaHoraArgentina();
  const faltanDias = diasHastaProxima(hoy.diaSemanaISO, dias);
  const diaProximo = ((hoy.diaSemanaISO + faltanDias - 1) % 7) + 1;

  // Lo ya mandado y sin recibir, para que no mande dos veces lo mismo.
  const { data: abiertas } = await supabase
    .from("ordenes_reposicion")
    .select("estado, total_unidades")
    .eq("id_marca", sesion.idMarca)
    .eq("id_local", idLocal)
    .in("estado", ESTADOS_ABIERTOS)
    .order("fecha_creacion", { ascending: false })
    .limit(1);
  const abierta = (abiertas ?? [])[0];

  return {
    gondolas,
    agotados,
    bajos,
    unidades,
    valorizado,
    proxima: {
      etiqueta:
        faltanDias === 0
          ? "Hoy"
          : faltanDias === 1
            ? "Mañana"
            : (DIAS_SEMANA.find((d) => d.iso === diaProximo)?.largo ?? nombrarDias(dias)),
      faltanDias,
      horario: `${cfg.get("RECEPCION_HORA_DESDE") ?? "09:00"} a ${cfg.get("RECEPCION_HORA_HASTA") ?? "12:00"}`,
    },
    yaMandado: abierta
      ? { unidades: (abierta.total_unidades as number) ?? 0, estado: (abierta.estado as string) ?? "" }
      : null,
  };
}

/**
 * Cuántos productos están agotados o por debajo del mínimo.
 *
 * Solo para el número del menú, así que no arma la orden entera: con el
 * cálculo completo, cada pantalla del portal pagaría media docena de
 * consultas de más solo para pintar un número.
 */
export async function cuantosFaltan(): Promise<number> {
  try {
    const sesion = await obtenerSesionMarca();
    if (!sesion) return 0;

    const supabase = getSupabaseServerClient();
    const { data: locales } = await supabase
      .from("locales")
      .select("id_local")
      .eq("estado", "ACTIVO")
      .limit(1);
    const idLocal = (locales ?? [])[0]?.id_local as string | undefined;
    if (!idLocal) return 0;

    const { data: productos } = await supabase
      .from("productos")
      .select("id_producto")
      .eq("id_marca", sesion.idMarca)
      .eq("estado", "ACTIVO");
    const idsProducto = (productos ?? []).map((p) => p.id_producto as string);
    if (idsProducto.length === 0) return 0;

    const { data: variantes } = await supabase
      .from("variantes_producto")
      .select("id_variante, stock_minimo, stock_objetivo")
      .in("id_producto", idsProducto)
      .eq("estado", "ACTIVO");
    const lista = (variantes ?? []).filter((v) => ((v.stock_objetivo as number) ?? 0) > 0);
    if (lista.length === 0) return 0;

    const { data: stock } = await supabase
      .from("stock")
      .select("id_variante, cantidad")
      .eq("id_local", idLocal)
      .in(
        "id_variante",
        lista.map((v) => v.id_variante as string)
      );
    const hay = new Map((stock ?? []).map((s) => [s.id_variante as string, (s.cantidad as number) ?? 0]));

    return lista.filter((v) => {
      const cantidad = hay.get(v.id_variante as string) ?? 0;
      const minimo = (v.stock_minimo as number) ?? 0;
      return cantidad <= 0 || (minimo > 0 && cantidad < minimo);
    }).length;
  } catch {
    // Un número del menú no puede voltear el portal entero.
    return 0;
  }
}

/**
 * La marca manda el envío.
 *
 * Va por variante y no por producto: el cálculo es por variante, y un producto
 * con tres sabores necesita decir cuántos de cada uno. Mandarlo por producto
 * obligaba a elegir un sabor por la marca y que WiiGo lo corrigiera después.
 *
 * Esto NO mueve stock. Crea la orden; la mercadería entra cuando la operativa
 * la recibe y cuenta lo que llegó de verdad. Es lo que evita el agujero
 * clásico de consignación: que el papel diga 8, hayan llegado 6, y nadie se
 * entere hasta el inventario.
 */
export async function mandarReposicion(
  items: { idVariante: string; cantidad: number }[]
): Promise<{ error: string | null; automatica?: boolean }> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return { error: "Sesión no válida" };

  const validos = items.filter((i) => Number.isInteger(i.cantidad) && i.cantidad > 0);
  if (validos.length === 0) return { error: "No hay nada para mandar." };

  const supabase = getSupabaseServerClient();

  // Que las variantes sean suyas se valida acá: mandar el id de una variante
  // ajena no tiene que poder abrir una orden de otra marca.
  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto")
    .eq("id_marca", sesion.idMarca);
  const idsProducto = (productos ?? []).map((p) => p.id_producto as string);
  if (idsProducto.length === 0) return { error: "No tenés productos cargados." };

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante")
    .in("id_producto", idsProducto)
    .eq("estado", "ACTIVO");
  const propias = new Set((variantes ?? []).map((v) => v.id_variante as string));
  if (validos.some((i) => !propias.has(i.idVariante))) {
    return { error: "Alguno de esos productos no es tuyo." };
  }

  const { data: locales } = await supabase
    .from("locales")
    .select("id_local")
    .eq("estado", "ACTIVO")
    .limit(1);
  const idLocal = (locales ?? [])[0]?.id_local as string | undefined;
  if (!idLocal) return { error: "No hay un local donde recibirlo. Escribinos." };

  const automatica = await entraSinAprobacion(supabase, sesion.idMarca, idLocal, validos);

  const total = validos.reduce((a, i) => a + i.cantidad, 0);
  const base = {
    id_marca: sesion.idMarca,
    id_local: idLocal,
    estado: automatica ? PENDIENTE : PROPUESTA,
    total_unidades: total,
    observaciones: null,
  };

  // Con `origen` si la columna existe; si no, sin ella (igual que
  // proponerEnvio: ver sql/reposicion-propuesta.sql).
  let orden = await supabase
    .from("ordenes_reposicion")
    .insert({ ...base, origen: "MARCA" })
    .select("id_orden")
    .single();
  if (orden.error && (orden.error.code === "42703" || orden.error.code === "PGRST204")) {
    orden = await supabase.from("ordenes_reposicion").insert(base).select("id_orden").single();
  }
  if (orden.error || !orden.data) return { error: "No se pudo mandar el envío." };

  const { error } = await supabase.from("detalle_reposicion").insert(
    validos.map((i) => ({
      id_orden: orden.data!.id_orden,
      id_variante: i.idVariante,
      cantidad_solicitada: i.cantidad,
      cantidad_recibida: 0,
    }))
  );
  if (error) return { error: "No se pudo mandar el envío." };

  revalidatePath("/portal/reponer");
  revalidatePath("/portal");
  revalidatePath("/compras/recepcion");
  return { error: null, automatica };
}

/**
 * ¿Entra sin que nadie la apruebe?
 *
 * Solo si NINGÚN renglón deja la góndola por encima del tope de ese producto.
 * Alcanza con que uno lo pase para que la orden entera espere: media orden
 * aprobada no existe.
 *
 * Ante cualquier falla, la respuesta es que no. El error se paga con una
 * aprobación de más, nunca con mercadería entrando sola.
 */
async function entraSinAprobacion(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  idMarca: string,
  idLocal: string,
  renglones: { idVariante: string; cantidad: number }[]
): Promise<boolean> {
  try {
    const { data: marca } = await supabase
      .from("marcas")
      .select("aprobacion_automatica")
      .eq("id_marca", idMarca)
      .maybeSingle();
    if (!marca || marca.aprobacion_automatica !== true) return false;

    const sugerencias = await sugerirReposicion(supabase, { idMarca, idLocal });
    if (sugerencias.size === 0) return false;

    return renglones.every((r) => {
      const s = sugerencias.get(r.idVariante);
      if (!s) return false;
      return s.stock + s.pendiente + r.cantidad <= topeDeVariante(s.objetivo);
    });
  } catch {
    return false;
  }
}
