import type { SupabaseClient } from "@supabase/supabase-js";
import { cargarMarcasFabrica, conMarca } from "@/lib/marcaFabrica";

// Inventario general del local (sql/inventario.sql): una tanda para cargar el
// stock de todo el local, contando por módulo (Gonzalo, 2026-11-10).

export const ZONAS_INVENTARIO = ["Módulo 1", "Módulo 2", "Módulo 3", "Módulo 4", "Módulo 5", "Freezer", "Animalfit", "Isla 1", "Isla 2", "Depósito"] as const;

export type ProductoInventario = {
  idVariante: string;
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
      nombre: v.nombre && v.nombre !== "Único" ? `${base} — ${v.nombre}` : base,
      marca: marcaPor.get(p.id_marca as string) ?? "",
      codigo: (v.codigo_barras as string | null) ?? null,
      enGramos: p.estado === "GRANEL",
    });
  }
  return salida.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
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
