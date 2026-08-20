import {
  getSupabaseServerClient,
  type Marca,
  type Local,
  type Producto,
  type VarianteProducto,
  type Stock,
  type OrdenReposicion,
  type DetalleReposicion,
  type DetalleRecepcion,
} from "@/lib/supabase";
import ReposicionApp from "@/components/ReposicionApp";

export const dynamic = "force-dynamic";

export default async function ReposicionPage() {
  const supabase = getSupabaseServerClient();

  const [marcasRes, localesRes, productosRes, variantesRes, stockRes, ordenesRes, detalleRes, detalleRecepcionRes] =
    await Promise.all([
      supabase.from("marcas").select("*").eq("estado", "ACTIVA").order("nombre", { ascending: true }),
      supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
      supabase.from("productos").select("*").eq("estado", "ACTIVO"),
      supabase.from("variantes_producto").select("*").eq("estado", "ACTIVO"),
      supabase.from("stock").select("*"),
      supabase.from("ordenes_reposicion").select("*").order("fecha", { ascending: false }),
      supabase.from("detalle_reposicion").select("*"),
      supabase.from("detalle_recepciones").select("*").neq("estado_control", "COMPLETA"),
    ]);

  const error =
    marcasRes.error ||
    localesRes.error ||
    productosRes.error ||
    variantesRes.error ||
    stockRes.error ||
    ordenesRes.error ||
    detalleRes.error ||
    detalleRecepcionRes.error;

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudo cargar la reposición</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  if ((marcasRes.data ?? []).length === 0 || (localesRes.data ?? []).length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">Falta cargar marcas o locales</p>
        <p className="text-sm text-neutral-500">
          Para generar una orden de reposición necesitás al menos una marca activa y un local.
        </p>
      </div>
    );
  }

  return (
    <ReposicionApp
      marcas={(marcasRes.data ?? []) as Marca[]}
      locales={(localesRes.data ?? []) as Local[]}
      productos={(productosRes.data ?? []) as Producto[]}
      variantes={(variantesRes.data ?? []) as VarianteProducto[]}
      stock={(stockRes.data ?? []) as Stock[]}
      ordenes={(ordenesRes.data ?? []) as OrdenReposicion[]}
      detalle={(detalleRes.data ?? []) as DetalleReposicion[]}
      reclamos={(detalleRecepcionRes.data ?? []) as DetalleRecepcion[]}
    />
  );
}
