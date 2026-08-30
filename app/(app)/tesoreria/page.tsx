import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import TesoreriaApp from "@/components/TesoreriaApp";

export const dynamic = "force-dynamic";

export default async function TesoreriaPage() {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.VER_CAJA_ADMIN)) return <PantallaBloqueada />;

  return <TesoreriaApp />;
}
