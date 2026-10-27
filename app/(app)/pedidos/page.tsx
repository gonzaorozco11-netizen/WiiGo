import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import PedidosApp from "@/components/PedidosApp";
import { listarPedidos } from "./actions";

export const dynamic = "force-dynamic";

export default async function PedidosPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "pedidos")) return <PantallaBloqueada />;
  const datos = await listarPedidos();
  return <PedidosApp {...datos} puedeCobrar={puedeVerPantalla(sesion, "pos")} />;
}
