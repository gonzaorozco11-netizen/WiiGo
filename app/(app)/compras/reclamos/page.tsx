import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ReclamosApp from "@/components/ReclamosApp";
import { listarReclamos } from "@/lib/reclamos";

export const dynamic = "force-dynamic";

// La cuarta etapa de Compras: lo que el proveedor te debe.
//
// Permiso propio ("compras-reclamos") porque acá se mueve plata: cargar una
// nota de crédito baja la cuenta corriente y el crédito fiscal. No es lo
// mismo que ver qué llegó. Quien tenga Proveedores también entra — es la
// misma persona que registra los pagos.

export default async function ReclamosPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "compras-reclamos") && !puedeVerPantalla(sesion, "proveedores")) {
    return <PantallaBloqueada />;
  }

  const reclamos = await listarReclamos();
  return <ReclamosApp reclamos={reclamos} />;
}
