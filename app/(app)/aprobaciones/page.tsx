import { obtenerSesionConPermisos } from "@/lib/permisos";
import { esRolInterno } from "@/lib/rolesInternos";
import { listarPendientes, listarTareasEtiqueta } from "@/app/(app)/aprobaciones/actions";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import AprobacionesApp from "@/components/AprobacionesApp";
import AprobacionesProfesionales from "@/components/AprobacionesProfesionales";
import { listarCambiosProfesionales } from "@/app/(app)/profesionales/actions";
import "./aprobaciones.css";

export const dynamic = "force-dynamic";

export default async function AprobacionesPage() {
  const sesion = await obtenerSesionConPermisos();
  // Ni marcas ni profesionales entran acá: esta es la pantalla de WiiGo.
  if (!sesion || !esRolInterno(sesion.rol)) return <PantallaBloqueada />;

  const [solicitudes, etiquetas, cambiosProfesionales] = await Promise.all([
    listarPendientes(),
    listarTareasEtiqueta(),
    listarCambiosProfesionales().catch(() => []),
  ]);

  return (
    <>
      <AprobacionesProfesionales cambios={cambiosProfesionales} esAdmin={sesion.rol === "admin"} />
      <AprobacionesApp solicitudes={solicitudes} etiquetas={etiquetas} esAdmin={sesion.rol === "admin"} />
    </>
  );
}
