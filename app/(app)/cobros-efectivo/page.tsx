import {
  getSupabaseServerClient,
  type Local,
  type Venta,
  type DetalleVenta,
  type Producto,
  type VarianteProducto,
  type Cliente,
} from "@/lib/supabase";
import CobrosEfectivoApp from "@/components/CobrosEfectivoApp";

export const dynamic = "force-dynamic";

export default async function CobrosEfectivoPage() {
  const supabase = getSupabaseServerClient();

  const [localesRes, ventasRes, detalleRes, productosRes, variantesRes, clientesRes] = await Promise.all([
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase.from("ventas").select("*").eq("canal", "SELF_CHECKOUT").order("fecha", { ascending: false }),
    supabase.from("detalle_ventas").select("*"),
    supabase.from("productos").select("*"),
    supabase.from("variantes_producto").select("*"),
    supabase.from("clientes").select("*"),
  ]);

  const error =
    localesRes.error || ventasRes.error || detalleRes.error || productosRes.error || variantesRes.error || clientesRes.error;

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los cobros</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  if ((localesRes.data ?? []).length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">Falta cargar locales</p>
        <p className="text-sm text-neutral-500">Necesitás al menos un local activo para ver los cobros del Self Checkout.</p>
      </div>
    );
  }

  return (
    <CobrosEfectivoApp
      locales={(localesRes.data ?? []) as Local[]}
      ventas={(ventasRes.data ?? []) as Venta[]}
      detalle={(detalleRes.data ?? []) as DetalleVenta[]}
      productos={(productosRes.data ?? []) as Producto[]}
      variantes={(variantesRes.data ?? []) as VarianteProducto[]}
      clientes={(clientesRes.data ?? []) as Cliente[]}
    />
  );
}
