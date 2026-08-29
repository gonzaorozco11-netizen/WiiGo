import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import IvaAPagarApp from "@/components/IvaAPagarApp";

export const dynamic = "force-dynamic";

export default async function IvaAPagarPage() {
  const sesionPantallas = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesionPantallas, "iva-a-pagar")) return <PantallaBloqueada />;

  return <IvaAPagarApp />;
}
