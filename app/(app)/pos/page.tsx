import {
  getSupabaseServerClient,
  type Local,
  type Marca,
  type Producto,
  type VarianteProducto,
  type Stock,
} from "@/lib/supabase";
import PosApp from "@/components/PosApp";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  const supabase = getSupabaseServerClient();

  const [localesRes, productosRes, variantesRes, marcasRes, stockRes] = await Promise.all([
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase.from("productos").select("*").eq("estado", "ACTIVO"),
    supabase.from("variantes_producto").select("*").eq("estado", "ACTIVO"),
    supabase.from("marcas").select("*").eq("estado", "ACTIVA"),
    supabase.from("stock").select("*"),
  ]);

  const error = localesRes.error || productosRes.error || variantesRes.error || marcasRes.error || stockRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudo cargar el POS</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  if ((localesRes.data ?? []).length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">Todavía no hay locales cargados</p>
        <p className="text-sm text-neutral-500">Andá a la sección "Locales" y creá al menos uno.</p>
      </div>
    );
  }

  return (
    <PosApp
      locales={(localesRes.data ?? []) as Local[]}
      productos={(productosRes.data ?? []) as Producto[]}
      variantes={(variantesRes.data ?? []) as VarianteProducto[]}
      marcas={(marcasRes.data ?? []) as Marca[]}
      stock={(stockRes.data ?? []) as Stock[]}
    />
  );
}
