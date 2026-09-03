import { obtenerSesionMarca, sesionIncluye } from "@/lib/marcaSesion";
import { resumenPortal, ventasDeHoy, reposicionPortal, pagosPortal, liquidacionesPortal } from "@/app/portal/actions";
import PortalTablero from "@/components/PortalTablero";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const sesion = await obtenerSesionMarca();

  // Las cinco consultas son independientes: van juntas para que la pantalla
  // no se arme de a una.
  const [resumen, ventasHoy, ordenes, pagos, liquidaciones] = await Promise.all([
    resumenPortal(),
    ventasDeHoy(),
    reposicionPortal(),
    pagosPortal(),
    liquidacionesPortal(),
  ]);

  if (!sesion || !resumen) {
    return <p className="vacio">No se pudo cargar tu tablero. Probá recargar la página.</p>;
  }

  return (
    <PortalTablero
      resumen={resumen}
      ventasHoy={ventasHoy}
      ordenes={ordenes}
      pagos={pagos}
      liquidaciones={liquidaciones}
      puedeVerMas={sesionIncluye(sesion, "METAL")}
    />
  );
}
