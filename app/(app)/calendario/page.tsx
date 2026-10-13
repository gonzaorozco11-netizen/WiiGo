import { obtenerSesionConPermisos } from "@/lib/permisos";
import { calendarioAdmin } from "@/app/(app)/calendario/actions";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import CalendarioApp from "@/components/CalendarioApp";
import "./calendario.css";

export const dynamic = "force-dynamic";

export default async function CalendarioPage() {
  const sesion = await obtenerSesionConPermisos();
  // Los usuarios de marca no entran acá: esta es la pantalla de WiiGo.
  if (!sesion || sesion.rol === "marca") return <PantallaBloqueada />;

  const datos = await calendarioAdmin();
  if (!datos) return <PantallaBloqueada />;

  return <CalendarioApp datos={datos} />;
}
