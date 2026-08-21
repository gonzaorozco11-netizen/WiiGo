import {
  getSupabaseServerClient,
  type Local,
  type Venta,
  type DetalleVenta,
  type Producto,
  type VarianteProducto,
  type Marca,
  type Cliente,
} from "@/lib/supabase";
import VentasApp from "@/components/VentasApp";

export const dynamic = "force-dynamic";

export default async function VentasPage() {
  const supabase = getSupabaseServerClient();

  const [localesRes, ventasRes, detalleRes, productosRes, variantesRes, marcasRes, clientesRes] = await Promise.all([
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase.from("ventas").select("*").order("fecha", { ascending: false }),
    supabase.from("detalle_ventas").select("*"),
    supabase.from("productos").select("*"),
    supabase.from("variantes_producto").select("*"),
    supabase.from("marcas").select("*"),
    supabase.from("clientes").select("*"),
  ]);

  const error =
    localesRes.error ||
    ventasRes.error ||
    detalleRes.error ||
    productosRes.error ||
    variantesRes.error ||
    marcasRes.error ||
    clientesRes.error;

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar las ventas</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  return (
    <VentasApp
      locales={(localesRes.data ?? []) as Local[]}
      ventas={(ventasRes.data ?? []) as Venta[]}
      detalle={(detalleRes.data ?? []) as DetalleVenta[]}
      productos={(productosRes.data ?? []) as Producto[]}
      variantes={(variantesRes.data ?? []) as VarianteProducto[]}
      marcas={(marcasRes.data ?? []) as Marca[]}
      clientes={(clientesRes.data ?? []) as Cliente[]}
    />
  );
}
