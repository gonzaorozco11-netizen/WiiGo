import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import RevisarAprenderApp from "@/components/RevisarAprenderApp";
import { estadoRevision } from "../actions";

export const dynamic = "force-dynamic";

// Aprender → Revisar: aprobar lo que escribe la IA antes de que lo vea el equipo.
export default async function RevisarAprenderPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || (sesion.rol !== "admin" && !puedeVerPantalla(sesion, "aprender-revisar"))) return <PantallaBloqueada />;
  const estado = await estadoRevision();
  return <RevisarAprenderApp estado={estado} />;
}
