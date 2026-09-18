import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { armarPanelProveedores } from "@/lib/panelProveedores";
import PanelProveedoresApp from "@/components/PanelProveedoresApp";

// La vista de arriba de Marcas y Proveedores: qué plata sale, qué entra, qué
// vence y qué está trabado. Junta lo que hoy vive repartido en cinco
// pantallas — y los vencimientos, que no se veían en ninguna.
export const dynamic = "force-dynamic";

function primerDiaDelMes() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`;
}

function hoyISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
}

export default async function PanelProveedoresPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "panel-proveedores")) return <PantallaBloqueada />;

  const panel = await armarPanelProveedores(primerDiaDelMes(), hoyISO());
  return <PanelProveedoresApp panel={panel} />;
}
