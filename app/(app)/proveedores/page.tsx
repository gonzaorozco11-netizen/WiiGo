import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ProveedoresApp from "@/components/ProveedoresApp";
import { listarProveedores } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProveedoresPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "proveedores")) return <PantallaBloqueada />;

  const proveedores = await listarProveedores();

  return <ProveedoresApp proveedores={proveedores} esAdmin={sesion?.rol === "admin"} />;
}
