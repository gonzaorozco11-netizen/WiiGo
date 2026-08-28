import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ResumenVentasApp from "@/components/ResumenVentasApp";

export const dynamic = "force-dynamic";

export default async function ResumenVentasPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "resumen-ventas")) return <PantallaBloqueada />;

  return <ResumenVentasApp />;
}
