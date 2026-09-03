import { obtenerSesionMarca, sesionIncluye } from "@/lib/marcaSesion";
import {
  resumenPortal,
  ventasDeHoy,
  reposicionPortal,
  pagosPortal,
  liquidacionesPortal,
  analisisPortal,
  goldPortal,
  gananciaRealPortal,
} from "@/app/portal/actions";
import PortalTablero from "@/components/PortalTablero";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const sesion = await obtenerSesionMarca();
  // El análisis de productos es del plan Metal para arriba. No se calcula si
  // no corresponde: además de no mostrarlo, no se gasta la consulta.
  const conAnalisis = sesionIncluye(sesion, "METAL");
  const conGold = sesionIncluye(sesion, "GOLD");

  // Consultas independientes: van juntas para que la pantalla no se arme de
  // a una.
  const [resumen, ventasHoy, ordenes, pagos, liquidaciones, ganancia, analisis, gold] = await Promise.all([
    resumenPortal(),
    ventasDeHoy(),
    reposicionPortal(),
    pagosPortal(),
    liquidacionesPortal(),
    gananciaRealPortal(),
    conAnalisis ? analisisPortal() : Promise.resolve(null),
    conGold ? goldPortal() : Promise.resolve(null),
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
      ganancia={ganancia}
      analisis={analisis}
      gold={gold}
      puedeVerMas={conAnalisis}
    />
  );
}
