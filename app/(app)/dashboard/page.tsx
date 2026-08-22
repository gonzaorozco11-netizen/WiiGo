import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import DashboardFinancieroApp from "@/components/DashboardFinancieroApp";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "dashboard")) return <PantallaBloqueada />;

  return <DashboardFinancieroApp />;
}
