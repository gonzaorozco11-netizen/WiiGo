import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import FichaAsistenciaApp from "@/components/FichaAsistenciaApp";

export const dynamic = "force-dynamic";

// ?antes-de-salir=1: llegó acá porque quiso cerrar su usuario con la caja
// abierta o sin fichar la salida (ver logout en app/login/actions.ts).
export default async function FichaAsistenciaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "ficha-asistencia")) return <PantallaBloqueada />;
  const params = await searchParams;

  return <FichaAsistenciaApp antesDeSalir={params["antes-de-salir"] === "1"} />;
}
