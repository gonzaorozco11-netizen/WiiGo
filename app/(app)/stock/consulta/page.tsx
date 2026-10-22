import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { ambosPrecios } from "@/lib/precios";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ConsultaPrecioStock, { type FilaConsulta } from "@/components/ConsultaPrecioStock";

// Precio y stock, SOLO CONSULTA: para el equipo del local (pedido de
// Gonzalo, 2026-10-22). Buscar un producto y ver cuánto sale (lista y
// efectivo) y cuánto hay en cada local. No hay ningún botón para modificar
// nada: los ajustes de stock siguen en Stock, que es otra pantalla.
// Sin costos: solo precios de venta.
export const dynamic = "force-dynamic";

const PAGINA = 1000;

async function todas<T>(armar: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await armar(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) return filas;
  }
}

export default async function ConsultaStockPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "stock-consulta")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  type Prod = { id_producto: string; id_marca: string; nombre: string; precio_venta: number | null; precio_efectivo: number | null; descuento_porcentaje: number | null };
  type Var = { id_variante: string; id_producto: string; nombre: string; codigo_barras: string | null; sku: string | null; precio_venta: number | null; precio_efectivo: number | null };
  type St = { id_variante: string; id_local: string; cantidad: number };
  const [productos, variantes, stock, { data: marcas }, { data: locales }] = await Promise.all([
    todas<Prod>((a, b) =>
      supabase.from("productos").select("id_producto, id_marca, nombre, precio_venta, precio_efectivo, descuento_porcentaje").eq("estado", "ACTIVO").order("id_producto").range(a, b)
    ),
    todas<Var>((a, b) =>
      supabase.from("variantes_producto").select("id_variante, id_producto, nombre, codigo_barras, sku, precio_venta, precio_efectivo").eq("estado", "ACTIVO").order("id_variante").range(a, b)
    ),
    todas<St>((a, b) => supabase.from("stock").select("id_variante, id_local, cantidad").order("id_stock").range(a, b)),
    supabase.from("marcas").select("id_marca, nombre"),
    supabase.from("locales").select("id_local, nombre").eq("estado", "ACTIVO").order("nombre"),
  ]);

  const productoPor = new Map(productos.map((p) => [p.id_producto, p]));
  const marcaPor = new Map((marcas ?? []).map((m) => [m.id_marca as string, m.nombre as string]));
  const stockPor = new Map<string, Record<string, number>>();
  for (const s of stock) {
    const porLocal = stockPor.get(s.id_variante) ?? {};
    porLocal[s.id_local] = (porLocal[s.id_local] ?? 0) + Number(s.cantidad ?? 0);
    stockPor.set(s.id_variante, porLocal);
  }

  const filas: FilaConsulta[] = [];
  for (const v of variantes) {
    const p = productoPor.get(v.id_producto);
    if (!p) continue;
    const precios = ambosPrecios(p, v);
    filas.push({
      idVariante: v.id_variante,
      producto: p.nombre,
      variante: v.nombre && v.nombre !== "Único" ? v.nombre : null,
      marca: marcaPor.get(p.id_marca) ?? "",
      codigo: v.codigo_barras ?? v.sku ?? null,
      lista: precios.lista,
      efectivo: precios.efectivo,
      oferta: p.descuento_porcentaje && p.descuento_porcentaje > 0 ? p.descuento_porcentaje : null,
      stock: stockPor.get(v.id_variante) ?? {},
    });
  }
  filas.sort((a, b) => a.producto.localeCompare(b.producto, "es") || (a.variante ?? "").localeCompare(b.variante ?? "", "es"));

  return <ConsultaPrecioStock filas={filas} locales={(locales ?? []).map((l) => ({ idLocal: l.id_local as string, nombre: l.nombre as string }))} />;
}
