import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import AprenderApp from "@/components/AprenderApp";
import { obtenerAprender } from "./actions";

export const dynamic = "force-dynamic";

// Aprender: el equipo estudia los productos que vende, por tema, con lo que
// administración aprobó (ver /aprender/revisar).
export default async function AprenderPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "aprender") && !puedeVerPantalla(sesion, "aprender-revisar")) return <PantallaBloqueada />;
  const datos = await obtenerAprender();
  return <AprenderApp datos={datos} />;
}
