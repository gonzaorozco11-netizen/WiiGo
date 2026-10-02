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
  detalleMesPortal,
  misCostosPortal,
} from "@/app/portal/actions";
import PortalTablero from "@/components/PortalTablero";
import PortalMisCostos from "@/components/PortalMisCostos";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const sesion = await obtenerSesionMarca();
  // El análisis de productos es del plan Metal para arriba. No se calcula si
  // no corresponde: además de no mostrarlo, no se gasta la consulta.
  const conAnalisis = sesionIncluye(sesion, "METAL");
  const conGold = sesionIncluye(sesion, "GOLD");

  // Consultas independientes: van juntas para que la pantalla no se arme de
  // a una.
  const [resumen, ventasHoy, ordenes, pagos, liquidaciones, ganancia, detalle, analisis, gold, costos] = await Promise.all([
    resumenPortal(),
    ventasDeHoy(),
    reposicionPortal(),
    pagosPortal(),
    liquidacionesPortal(),
    gananciaRealPortal(),
    conAnalisis ? detalleMesPortal() : Promise.resolve({ porProducto: [], porVenta: [], totalLineas: 0 }),
    conAnalisis ? analisisPortal() : Promise.resolve(null),
    conGold ? goldPortal() : Promise.resolve(null),
    misCostosPortal(),
  ]);

  if (!sesion || !resumen) {
    return <p className="vacio">No se pudo cargar tu tablero. Probá recargar la página.</p>;
  }

  return (
    <>
      {/* Antes del tablero: hasta que la marca cargue sus costos, el tablero le
          dice cuánto cobra pero no cuánto gana. Esto es lo que lo completa. */}
      {costos && <PortalMisCostos datos={costos} />}
      <PortalTablero
        resumen={resumen}
        ventasHoy={ventasHoy}
        ordenes={ordenes}
        pagos={pagos}
        liquidaciones={liquidaciones}
        ganancia={ganancia}
        detalle={detalle}
        analisis={analisis}
        gold={gold}
        puedeVerMas={conAnalisis}
      />
    </>
  );
}
