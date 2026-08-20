import { getSupabaseServerClient, type Producto, type Marca, type Subcategoria } from "@/lib/supabase";
import ProductosApp from "@/components/ProductosApp";

export const dynamic = "force-dynamic";

export default async function ProductosPage() {
  const supabase = getSupabaseServerClient();

  const [productosRes, marcasRes, subcategoriasRes] = await Promise.all([
    supabase.from("productos").select("*").order("nombre", { ascending: true }),
    supabase.from("marcas").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase.from("subcategorias").select("*").order("nombre", { ascending: true }),
  ]);

  const error = productosRes.error || marcasRes.error || subcategoriasRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los productos</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  if ((marcasRes.data ?? []).length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">Todavía no hay marcas cargadas</p>
        <p className="text-sm text-neutral-500">
          Antes de cargar productos, andá a la sección "Marcas" y creá al menos una.
        </p>
      </div>
    );
  }

  return (
    <ProductosApp
      initialProductos={(productosRes.data ?? []) as Producto[]}
      marcas={(marcasRes.data ?? []) as Marca[]}
      subcategorias={(subcategoriasRes.data ?? []) as Subcategoria[]}
    />
  );
}
