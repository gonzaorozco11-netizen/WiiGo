import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { cargarGondola } from "@/lib/gondola";
import { cargarMarcasFabrica, conMarca } from "@/lib/marcaFabrica";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import GondolaEquipo, { type ProductoGondola } from "@/components/GondolaEquipo";
import "./gondola.css";

// Góndola para el equipo (Gonzalo, 2026-11-07): los muebles como los ve él en
// Precios → Góndola, pero SOLO PARA MIRAR, desde el celular. Cada lugar dice
// cuánto hay (verde / amarillo / rojo) y con la cámara se escanea un producto
// para saber cuánto hay y dónde va. Acomodar sigue siendo en Precios.
// Sin costos ni precios de compra.
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

export default async function GondolaPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "gondola")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  type Prod = { id_producto: string; nombre: string };
  type Var = { id_variante: string; id_producto: string; codigo_barras: string | null; sku: string | null; stock_minimo: number | null };
  type St = { id_variante: string; id_local: string; cantidad: number };
  const [productos, variantes, stock, { data: locales }, marcasFabrica] = await Promise.all([
    todas<Prod>((a, b) => supabase.from("productos").select("id_producto, nombre").eq("estado", "ACTIVO").order("id_producto").range(a, b)),
    todas<Var>((a, b) =>
      supabase.from("variantes_producto").select("id_variante, id_producto, codigo_barras, sku, stock_minimo").eq("estado", "ACTIVO").order("id_variante").range(a, b)
    ),
    todas<St>((a, b) => supabase.from("stock").select("id_variante, id_local, cantidad").order("id_stock").range(a, b)),
    supabase.from("locales").select("id_local, nombre").eq("estado", "ACTIVO").order("nombre"),
    cargarMarcasFabrica(supabase).catch(() => new Map<string, string>()),
  ]);

  const gondolas = await Promise.all(
    (locales ?? []).map(async (l) => ({ idLocal: l.id_local as string, nombre: l.nombre as string, modulos: (await cargarGondola(supabase, l.id_local as string)) ?? [] }))
  );

  // Por producto: cuánto hay en cada local (sumando sus variantes), el mínimo
  // y los códigos con los que se lo encuentra al escanear.
  const delProducto = new Map<string, ProductoGondola>(
    productos.map((p) => [p.id_producto, { id: p.id_producto, nombre: conMarca(p.nombre, marcasFabrica.get(p.id_producto)), stock: {}, minimo: 0, codigos: [] }])
  );
  const productoDeVariante = new Map<string, ProductoGondola>();
  for (const v of variantes) {
    const p = delProducto.get(v.id_producto);
    if (!p) continue;
    productoDeVariante.set(v.id_variante, p);
    p.minimo += Number(v.stock_minimo) || 0;
    for (const c of [v.codigo_barras, v.sku]) if (c?.trim()) p.codigos.push(c.trim());
  }
  for (const s of stock) {
    const p = productoDeVariante.get(s.id_variante);
    if (p) p.stock[s.id_local] = (p.stock[s.id_local] ?? 0) + Number(s.cantidad ?? 0);
  }

  return <GondolaEquipo locales={gondolas} productos={[...delProducto.values()]} />;
}
