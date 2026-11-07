import { obtenerSesionConPermisos } from "@/lib/permisos";
import { esRolInterno } from "@/lib/rolesInternos";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { listarPendientes, listarTareasEtiqueta } from "@/app/(app)/aprobaciones/actions";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import AprobacionesApp from "@/components/AprobacionesApp";
import AprobacionesProfesionales from "@/components/AprobacionesProfesionales";
import AprobacionesRedesProfesionales from "@/components/AprobacionesRedesProfesionales";
import AprobacionesOpinionesPacientes from "@/components/AprobacionesOpinionesPacientes";
import { listarCambiosProfesionales, listarOpinionesPacientes, listarPublicacionesParaVerificar } from "@/app/(app)/profesionales/actions";
import "./aprobaciones.css";

export const dynamic = "force-dynamic";

export default async function AprobacionesPage() {
  const [sesion, sesionPantallas] = await Promise.all([obtenerSesionConPermisos(), obtenerSesionConPantallas()]);
  // Ni marcas ni profesionales entran acá: esta es la pantalla de WiiGo. Y del
  // equipo, solo quien la tiene habilitada en su Área: el operativo del local
  // no aprueba fotos de profesionales ni precios de marcas (Gonzalo, 2026-11-07).
  if (!sesion || !esRolInterno(sesion.rol) || !puedeVerPantalla(sesionPantallas, "aprobaciones")) return <PantallaBloqueada />;

  const [solicitudes, etiquetas, cambiosProfesionales, publicaciones, opinionesPacientes] = await Promise.all([
    listarPendientes(),
    listarTareasEtiqueta(),
    listarCambiosProfesionales().catch(() => []),
    listarPublicacionesParaVerificar().catch(() => []),
    listarOpinionesPacientes().catch(() => []),
  ]);

  return (
    <>
      <AprobacionesProfesionales cambios={cambiosProfesionales} esAdmin={sesion.rol === "admin"} />
      <AprobacionesOpinionesPacientes opiniones={opinionesPacientes} esAdmin={sesion.rol === "admin"} />
      <AprobacionesRedesProfesionales publicaciones={publicaciones} esAdmin={sesion.rol === "admin"} />
      <AprobacionesApp solicitudes={solicitudes} etiquetas={etiquetas} esAdmin={sesion.rol === "admin"} />
    </>
  );
}
