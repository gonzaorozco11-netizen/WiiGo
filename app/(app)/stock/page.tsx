import {
  getSupabaseServerClient,
  type Local,
  type Producto,
  type Marca,
  type VarianteProducto,
  type Stock,
} from "@/lib/supabase";
import StockApp from "@/components/StockApp";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  const supabase = getSupabaseServerClient();

  const [localesRes, variantesRes, productosRes, marcasRes, stockRes] = await Promise.all([
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase.from("variantes_producto").select("*").eq("estado", "ACTIVO"),
    supabase.from("productos").select("*").eq("estado", "ACTIVO"),
    supabase.from("marcas").select("*"),
    supabase.from("stock").select("*"),
  ]);

  const error = localesRes.error || variantesRes.error || productosRes.error || marcasRes.error || stockRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudo cargar el stock</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  if ((localesRes.data ?? []).length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">Todavía no hay locales cargados</p>
        <p className="text-sm text-neutral-500">
          Antes de manejar stock, andá a la sección "Locales" y creá al menos uno.
        </p>
      </div>
    );
  }

  return (
    <StockApp
      locales={(localesRes.data ?? []) as Local[]}
      variantes={(variantesRes.data ?? []) as VarianteProducto[]}
      productos={(productosRes.data ?? []) as Producto[]}
      marcas={(marcasRes.data ?? []) as Marca[]}
      stock={(stockRes.data ?? []) as Stock[]}
    />
  );
}
