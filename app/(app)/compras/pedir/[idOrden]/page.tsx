import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import PedidoCargarApp from "@/components/PedidoCargarApp";
import { pedidoParaCargar } from "@/lib/pedidoProveedor";

export const dynamic = "force-dynamic";

// Cargar en la web del proveedor el pedido que armó el equipo. Es de quien
// maneja Compras: ahí se decide qué se pide de verdad.
export default async function CargarPedidoPage({ params }: { params: Promise<{ idOrden: string }> }) {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "compras")) return <PantallaBloqueada />;
  const { idOrden } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(idOrden)) return <p className="max-w-md mx-auto text-center py-12 text-neutral-700">Ese pedido no existe.</p>;

  const datos = await pedidoParaCargar(getSupabaseServerClient(), idOrden);
  if (!datos) return <p className="max-w-md mx-auto text-center py-12 text-neutral-700">Ese pedido no existe.</p>;

  return <PedidoCargarApp {...datos} />;
}
