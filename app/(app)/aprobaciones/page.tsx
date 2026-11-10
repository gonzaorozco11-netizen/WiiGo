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
import Link from "next/link";

export const dynamic = "force-dynamic";

// ?ver= viene de Mis Tareas: muestra solo lo de esa tarea, no la bandeja entera
// (Gonzalo, 2026-11-10: «te lleva pero no te muestra lo puntual»).
//   marcas → las solicitudes de las marcas · etiquetas → las etiquetas por
//   cambiar · profesionales → lo que mandaron las profesionales.
export default async function AprobacionesPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams;
  const soloMarcas = ver === "marcas" || ver === "etiquetas";
  const soloProfesionales = ver === "profesionales";
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
      {ver && (
        <Link href="/aprobaciones" className="inline-block mb-3 text-sm text-accent font-semibold hover:underline">
          Ver todas las aprobaciones →
        </Link>
      )}
      {!soloMarcas && (
        <>
          <AprobacionesProfesionales cambios={cambiosProfesionales} esAdmin={sesion.rol === "admin"} />
          <AprobacionesOpinionesPacientes opiniones={opinionesPacientes} esAdmin={sesion.rol === "admin"} />
          <AprobacionesRedesProfesionales publicaciones={publicaciones} esAdmin={sesion.rol === "admin"} />
        </>
      )}
      {!soloProfesionales && (
        <AprobacionesApp
          key={ver ?? "todo"}
          solicitudes={solicitudes}
          etiquetas={etiquetas}
          esAdmin={sesion.rol === "admin"}
          inicio={ver === "marcas" ? "SOLICITUDES" : ver === "etiquetas" ? "ETIQUETAS" : undefined}
        />
      )}
    </>
  );
}
