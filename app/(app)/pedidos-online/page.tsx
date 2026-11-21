import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import PedidosOnlineApp from "@/components/PedidosOnlineApp";
import { listarPedidosOnline } from "./actions";

export const dynamic = "force-dynamic";

// Los pedidos de la tienda online (app/(app)/pedidos-online/actions.ts).
export default async function PedidosOnlinePage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "pedidos-online") && !puedeVerPantalla(sesion, "pedidos")) return <PantallaBloqueada />;
  const datos = await listarPedidosOnline();
  return <PedidosOnlineApp {...datos} puedeCobrar={puedeVerPantalla(sesion, "pos")} esDueno={sesion?.rol === "admin"} />;
}
