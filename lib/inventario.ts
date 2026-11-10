import type { SupabaseClient } from "@supabase/supabase-js";
import { cargarMarcasFabrica, conMarca } from "@/lib/marcaFabrica";
import { NOMBRE_ALTURA, nombreCortoZona, soloModulos, type ModuloGondola } from "@/lib/gondola";

// Inventario general del local (sql/inventario.sql): una tanda para cargar el
// stock de todo el local, contando por módulo (Gonzalo, 2026-11-10).

export const ZONAS_INVENTARIO = ["Módulo 1", "Módulo 2", "Módulo 3", "Módulo 4", "Módulo 5", "Freezer", "Animalfit", "Isla 1", "Isla 2", "Depósito"] as const;

/**
 * Los muebles de la Góndola de cada lugar del inventario: uno por módulo, los
 * dos lados de cada isla, adelante y fondo de Animalfit. El Depósito no tiene.
 */
export function modulosDeZona(gondola: ModuloGondola[], zona: string): ModuloGondola[] {
  const n = Number(zona.match(/\d+$/)?.[0]);
  if (zona.startsWith("Módulo")) return soloModulos(gondola)[n - 1] ? [soloModulos(gondola)[n - 1]] : [];
  if (zona.startsWith("Isla")) return gondola.filter((m) => m.tipo === "ISLA" && m.numero === n);
  if (zona === "Freezer") return gondola.filter((m) => m.tipo === "FREEZER");
  if (zona === "Animalfit") return gondola.filter((m) => /animal\s*fit/i.test(`${m.titulo} ${m.subtitulo ?? ""}`));
  return [];
}

/** «Módulo 1 · Ojos · lugar 3», para mostrar y para el registro. */
export function textoLugar(gondola: ModuloGondola[], m: ModuloGondola, fila: number, columna: number) {
  const altura = m.filas[fila]?.altura;
  // Las islas y Animalfit tienen dos lados con el mismo nombre: se aclara cuál.
  const dosLados = m.tipo !== "MODULO" && gondola.some((o) => o.id !== m.id && o.tipo === m.tipo && o.numero === m.numero && nombreCortoZona(gondola, o) === nombreCortoZona(gondola, m));
  const nombre = nombreCortoZona(gondola, m).replace(/^Mueble/, "Módulo") + (dosLados && m.subtitulo ? ` (${m.subtitulo})` : "");
  return `${nombre}${altura ? ` · ${NOMBRE_ALTURA[altura]}` : ""} · lugar ${columna + 1}`;
}

export type UbicacionPendiente = { id: string; producto: string; desde: string; hacia: string; quien: string | null };

export type ProductoInventario = {
  idVariante: string;
  idProducto: string;
  nombre: string;
  marca: string;
  codigo: string | null;
  /** Granel: se cuenta en kilos y se guarda en gramos. */
  enGramos: boolean;
};
export type ConteoInventario = { idVariante: string; zona: string; cantidad: number; quien: string | null; cuando: string };
export type FirmaInventario = { nombre: string; zonas: string; productos: number; firma: string; cuando: string };

export async function inventarioAbierto(supabase: SupabaseClient, idLocal: string): Promise<{ id: string; desde: string } | null | "SIN_SQL"> {
  const { data, error } = await supabase
    .from("inventarios")
    .select("id_inventario, creado_en")
    .eq("id_local", idLocal)
    .eq("estado", "ABIERTO")
    .order("creado_en", { ascending: false })
    .limit(1);
  if (error) return "SIN_SQL";
  return data?.[0] ? { id: data[0].id_inventario as string, desde: data[0].creado_en as string } : null;
}

/** Todo lo que se puede contar: lo que se vende y el granel (en gramos). */
export async function catalogoInventario(supabase: SupabaseClient): Promise<ProductoInventario[]> {
  const [{ data: prods }, { data: marcas }, marcasFabrica] = await Promise.all([
    supabase.from("productos").select("id_producto, nombre, id_marca, estado").in("estado", ["ACTIVO", "GRANEL"]).range(0, 4999),
    supabase.from("marcas").select("id_marca, nombre"),
    cargarMarcasFabrica(supabase).catch(() => new Map<string, string>()),
  ]);
  const prodPor = new Map((prods ?? []).map((p) => [p.id_producto as string, p]));
  const marcaPor = new Map((marcas ?? []).map((m) => [m.id_marca as string, m.nombre as string]));
  const { data: vars } = await supabase.from("variantes_producto").select("id_variante, id_producto, nombre, codigo_barras").eq("estado", "ACTIVO").range(0, 9999);
  const salida: ProductoInventario[] = [];
  for (const v of vars ?? []) {
    const p = prodPor.get(v.id_producto as string);
    if (!p) continue;
    const base = conMarca(p.nombre as string, marcasFabrica.get(p.id_producto as string));
    salida.push({
      idVariante: v.id_variante as string,
      idProducto: p.id_producto as string,
      nombre: v.nombre && v.nombre !== "Único" ? `${base} — ${v.nombre}` : base,
      marca: marcaPor.get(p.id_marca as string) ?? "",
      codigo: (v.codigo_barras as string | null) ?? null,
      enGramos: p.estado === "GRANEL",
    });
  }
  return salida.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Lo que dijeron los chicos sobre dónde está cada cosa: los números y lo que espera a Gonzalo. */
export async function ubicacionesDe(supabase: SupabaseClient, idLocal: string, idInventario: string) {
  const { data, error } = await supabase
    .from("inventario_ubicaciones")
    .select("id_ubicacion, accion, estado, desde, hacia, quien, productos(nombre)")
    .eq("id_local", idLocal)
    .or(`id_inventario.eq.${idInventario},estado.eq.PENDIENTE`);
  if (error) return { confirmados: 0, nuevos: 0, movidos: 0, pendientes: [] as UbicacionPendiente[] };
  const filas = data ?? [];
  return {
    confirmados: filas.filter((f) => f.accion === "CONFIRMADO").length,
    nuevos: filas.filter((f) => f.accion === "NUEVO").length,
    movidos: filas.filter((f) => f.accion === "MOVIDO").length,
    pendientes: filas
      .filter((f) => f.estado === "PENDIENTE")
      .map((f) => ({
        id: f.id_ubicacion as string,
        producto: (f.productos as unknown as { nombre: string } | null)?.nombre ?? "Producto",
        desde: (f.desde as string | null) ?? "—",
        hacia: (f.hacia as string | null) ?? "—",
        quien: (f.quien as string | null) ?? null,
      })),
  };
}

export async function conteosDe(supabase: SupabaseClient, idInventario: string): Promise<{ conteos: ConteoInventario[]; firmas: FirmaInventario[] }> {
  const [{ data: c }, { data: f }] = await Promise.all([
    supabase.from("inventario_conteos").select("id_variante, zona, cantidad, contado_por, contado_en").eq("id_inventario", idInventario).range(0, 9999),
    supabase.from("inventario_firmas").select("nombre, zonas, productos, firma, firmado_en").eq("id_inventario", idInventario).order("firmado_en"),
  ]);
  return {
    conteos: (c ?? []).map((x) => ({
      idVariante: x.id_variante as string,
      zona: x.zona as string,
      cantidad: Number(x.cantidad),
      quien: (x.contado_por as string | null) ?? null,
      cuando: x.contado_en as string,
    })),
    firmas: (f ?? []).map((x) => ({
      nombre: (x.nombre as string | null) ?? "—",
      zonas: (x.zonas as string | null) ?? "",
      productos: Number(x.productos ?? 0),
      firma: x.firma as string,
      cuando: x.firmado_en as string,
    })),
  };
}
