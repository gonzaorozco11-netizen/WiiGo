import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ImportarFotosApp from "@/components/ImportarFotosApp";

// Se entra desde Productos, no desde el menú: es una tarea de carga inicial
// de catálogo, no algo del día a día.
export const dynamic = "force-dynamic";

export default async function ImportarFotosPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "productos")) return <PantallaBloqueada />;
  return <ImportarFotosApp />;
}
