import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ResultadoMesApp from "@/components/ResultadoMesApp";

export const dynamic = "force-dynamic";

export default async function ResultadoMesPage() {
  const sesionPantallas = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesionPantallas, "resultado-mes")) return <PantallaBloqueada />;

  return <ResultadoMesApp />;
}
