import { obtenerSesionConPermisos } from "@/lib/permisos";
import { esRolInterno } from "@/lib/rolesInternos";
import { listarPendientes, listarTareasEtiqueta } from "@/app/(app)/aprobaciones/actions";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import AprobacionesApp from "@/components/AprobacionesApp";
import "./aprobaciones.css";

export const dynamic = "force-dynamic";

export default async function AprobacionesPage() {
  const sesion = await obtenerSesionConPermisos();
  // Ni marcas ni profesionales entran acá: esta es la pantalla de WiiGo.
  if (!sesion || !esRolInterno(sesion.rol)) return <PantallaBloqueada />;

  const [solicitudes, etiquetas] = await Promise.all([listarPendientes(), listarTareasEtiqueta()]);

  return (
    <AprobacionesApp solicitudes={solicitudes} etiquetas={etiquetas} esAdmin={sesion.rol === "admin"} />
  );
}
