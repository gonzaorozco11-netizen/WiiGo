import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import FichaAsistenciaApp from "@/components/FichaAsistenciaApp";

export const dynamic = "force-dynamic";

export default async function FichaAsistenciaPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "ficha-asistencia")) return <PantallaBloqueada />;

  return <FichaAsistenciaApp />;
}
