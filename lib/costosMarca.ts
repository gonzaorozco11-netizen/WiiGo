// El costo que la marca dice que le cuesta su producto.
//
// Vive en `costos_marca` y NO en `productos.costo_informado`: ese es de WiiGo,
// para la marca propia. Son dos cosas distintas y mezclarlas expondría el costo
// de una marca en las pantallas internas de otra.
//
// Con vigencia porque una venta de marzo tiene que calcularse con el costo que
// regía en marzo, no con el de hoy. Por eso nunca se pisa una fila: se agrega
// otra con su fecha, y el historial queda.
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * El cajón donde caen los productos sin subcategoría al agruparlos.
 *
 * Acá y no en app/portal/actions.ts: ese archivo es "use server" y ahí solo
 * pueden exportarse funciones asíncronas.
 */
export const SIN_SUBCATEGORIA = "Sin subcategoría";

export type CostoDeMarca = {
  idCosto: string;
  idProducto: string;
  costo: number;
  vigenteDesde: string;
  /** Quién lo cargó: la propia marca desde su portal, o alguien de WiiGo. */
  cargadoPor: "MARCA" | "WIIGO" | null;
  nombreQuienCargo: string | null;
  creadoEl: string;
};

/**
 * El costo vigente de cada producto de una marca, a una fecha.
 *
 * Una sola consulta para todos los productos y el filtro en memoria: son pocas
 * filas por producto y así no se hace un viaje a la base por cada uno.
 */
export async function costosVigentes(
  supabase: SupabaseClient,
  idMarca: string,
  hastaISO?: string
): Promise<Map<string, CostoDeMarca>> {
  const { data, error } = await supabase
    .from("costos_marca")
    .select("id_costo, id_producto, costo, vigente_desde, cargado_por, creado_el")
    .eq("id_marca", idMarca)
    .order("vigente_desde", { ascending: false });
  // La tabla puede no existir todavía en un entorno viejo: antes de romper la
  // pantalla entera, se devuelve vacío y los productos quedan "sin costo".
  if (error) return new Map();

  const corte = hastaISO ?? new Date().toISOString().slice(0, 10);
  const quienes = await nombresDeUsuario(
    supabase,
    (data ?? []).map((c) => c.cargado_por as string | null)
  );

  const vigente = new Map<string, CostoDeMarca>();
  for (const c of data ?? []) {
    const desde = String(c.vigente_desde).slice(0, 10);
    if (desde > corte) continue; // todavía no rige
    const id = c.id_producto as string;
    // Vienen ordenados de más nuevo a más viejo: el primero que entra es el que rige.
    if (vigente.has(id)) continue;
    const quien = quienes.get((c.cargado_por as string | null) ?? "");
    vigente.set(id, {
      idCosto: c.id_costo as string,
      idProducto: id,
      costo: (c.costo as number) ?? 0,
      vigenteDesde: desde,
      cargadoPor: quien ? (quien.rol === "marca" ? "MARCA" : "WIIGO") : null,
      nombreQuienCargo: quien?.nombre ?? null,
      creadoEl: c.creado_el as string,
    });
  }
  return vigente;
}

/**
 * Lo mismo pero para todas las marcas de una vez.
 *
 * Lo usa la pantalla de Productos, que lista el catálogo entero: pedir los
 * costos marca por marca sería un viaje a la base por cada una.
 */
export async function costosVigentesPorProducto(
  supabase: SupabaseClient
): Promise<Map<string, CostoDeMarca>> {
  const { data, error } = await supabase
    .from("costos_marca")
    .select("id_costo, id_producto, costo, vigente_desde, cargado_por, creado_el")
    .order("vigente_desde", { ascending: false });
  if (error) return new Map();

  const hoy = new Date().toISOString().slice(0, 10);
  const quienes = await nombresDeUsuario(
    supabase,
    (data ?? []).map((c) => c.cargado_por as string | null)
  );

  const vigente = new Map<string, CostoDeMarca>();
  for (const c of data ?? []) {
    const desde = String(c.vigente_desde).slice(0, 10);
    if (desde > hoy) continue;
    const id = c.id_producto as string;
    if (vigente.has(id)) continue;
    const quien = quienes.get((c.cargado_por as string | null) ?? "");
    vigente.set(id, {
      idCosto: c.id_costo as string,
      idProducto: id,
      costo: (c.costo as number) ?? 0,
      vigenteDesde: desde,
      cargadoPor: quien ? (quien.rol === "marca" ? "MARCA" : "WIIGO") : null,
      nombreQuienCargo: quien?.nombre ?? null,
      creadoEl: c.creado_el as string,
    });
  }
  return vigente;
}

/** Todo el historial de un producto, del más nuevo al más viejo. */
export async function historialCosto(
  supabase: SupabaseClient,
  idProducto: string
): Promise<CostoDeMarca[]> {
  const { data, error } = await supabase
    .from("costos_marca")
    .select("id_costo, id_producto, costo, vigente_desde, cargado_por, creado_el")
    .eq("id_producto", idProducto)
    .order("vigente_desde", { ascending: false })
    .limit(50);
  if (error) return [];

  const quienes = await nombresDeUsuario(
    supabase,
    (data ?? []).map((c) => c.cargado_por as string | null)
  );
  return (data ?? []).map((c) => {
    const quien = quienes.get((c.cargado_por as string | null) ?? "");
    return {
      idCosto: c.id_costo as string,
      idProducto: c.id_producto as string,
      costo: (c.costo as number) ?? 0,
      vigenteDesde: String(c.vigente_desde).slice(0, 10),
      cargadoPor: quien ? (quien.rol === "marca" ? "MARCA" : "WIIGO") : null,
      nombreQuienCargo: quien?.nombre ?? null,
      creadoEl: c.creado_el as string,
    };
  });
}

/**
 * Guardar un costo nuevo.
 *
 * Si ya hay uno con esa misma fecha de vigencia lo reemplaza — es una
 * corrección del mismo día, no un cambio de precio. Con otra fecha, se agrega:
 * el anterior sigue valiendo para las ventas de antes.
 */
export async function guardarCosto(
  supabase: SupabaseClient,
  params: { idMarca: string; idProducto: string; costo: number; vigenteDesde: string; idUsuario: string | null }
): Promise<{ error: string | null }> {
  if (!Number.isFinite(params.costo) || params.costo <= 0) {
    return { error: "El costo tiene que ser mayor a cero." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.vigenteDesde)) {
    return { error: "Falta desde cuándo rige este costo." };
  }

  // El producto tiene que ser de esa marca. El control va acá y no en la
  // pantalla: estas funciones se llaman desde un endpoint, así que alcanza con
  // mandar otro id para escribirle el costo a un producto ajeno.
  const { data: producto } = await supabase
    .from("productos")
    .select("id_producto, id_marca")
    .eq("id_producto", params.idProducto)
    .maybeSingle();
  if (!producto) return { error: "No se encontró ese producto." };
  if (producto.id_marca !== params.idMarca) {
    return { error: "Ese producto no es de esta marca." };
  }

  const { data: mismoDia } = await supabase
    .from("costos_marca")
    .select("id_costo")
    .eq("id_producto", params.idProducto)
    .eq("vigente_desde", params.vigenteDesde)
    .maybeSingle();

  const fila = {
    id_producto: params.idProducto,
    id_marca: params.idMarca,
    costo: params.costo,
    vigente_desde: params.vigenteDesde,
    cargado_por: params.idUsuario,
  };

  const { error } = mismoDia
    ? await supabase.from("costos_marca").update(fila).eq("id_costo", mismoDia.id_costo as string)
    : await supabase.from("costos_marca").insert(fila);
  if (error) return { error: error.message };
  return { error: null };
}

async function nombresDeUsuario(supabase: SupabaseClient, ids: (string | null)[]) {
  const limpios = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (limpios.length === 0) return new Map<string, { nombre: string; rol: string }>();
  const { data } = await supabase
    .from("usuarios")
    .select("id_usuario, nombre, rol")
    .in("id_usuario", limpios);
  return new Map(
    (data ?? []).map((u) => [
      u.id_usuario as string,
      { nombre: (u.nombre as string) ?? "", rol: (u.rol as string) ?? "" },
    ])
  );
}
