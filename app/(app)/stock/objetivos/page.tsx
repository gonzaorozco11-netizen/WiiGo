import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { datosObjetivos } from "@/app/(app)/stock/objetivos/actions";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ObjetivosStockApp from "@/components/ObjetivosStockApp";

export const dynamic = "force-dynamic";

export default async function ObjetivosStockPage() {
  // Se corta acá y no solo en el menú: esconder un link no protege nada, la
  // URL se escribe a mano.
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "stock-objetivos")) return <PantallaBloqueada />;

  const datos = await datosObjetivos();
  if (!datos) return <PantallaBloqueada />;
  return <ObjetivosStockApp datos={datos} />;
}
