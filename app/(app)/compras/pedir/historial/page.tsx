import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import HistorialProveedorApp from "@/components/HistorialProveedorApp";
import { proveedorDelPedido } from "@/lib/pedidoProveedor";
import { historialProveedor } from "@/lib/historialProveedor";

export const dynamic = "force-dynamic";

// Historial de pedidos y cuenta corriente del proveedor que se paga por lo
// vendido (Alifrut). Gonzalo, 19/11. Ver lib/historialProveedor.ts.
export default async function HistorialPedidosPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "compras")) return <PantallaBloqueada />;
  const supabase = getSupabaseServerClient();
  const proveedor = await proveedorDelPedido(supabase);
  if (!proveedor) return <p className="max-w-md mx-auto text-center py-12 text-neutral-700">No hay ningún proveedor que se pague por lo vendido.</p>;
  const { ver } = await searchParams;
  try {
    const datos = await historialProveedor(supabase, proveedor.id);
    return <HistorialProveedorApp datos={datos} vista={ver === "cuenta" ? "cuenta" : "historial"} puedePagar={sesion.rol === "admin"} />;
  } catch (e) {
    return (
      <p className="max-w-md mx-auto text-center py-12 text-red-700">
        No se pudo armar el historial: {e instanceof Error ? e.message : "error"}
      </p>
    );
  }
}
