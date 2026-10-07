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
  const [resumen, ventasHoy, ordenes, pagos, liquidaciones, ganancia, detalle, analisis, gold] = await Promise.all([
    resumenPortal(),
    ventasDeHoy(),
    reposicionPortal(),
    pagosPortal(),
    liquidacionesPortal(),
    gananciaRealPortal(),
    conAnalisis ? detalleMesPortal() : Promise.resolve({ porProducto: [], porVenta: [], totalLineas: 0 }),
    conAnalisis ? analisisPortal() : Promise.resolve(null),
    conGold ? goldPortal() : Promise.resolve(null),
  ]);

  if (!sesion || !resumen) {
    return <p className="vacio">No se pudo cargar tu tablero. Probá recargar la página.</p>;
  }

  // Los costos y los productos viven en /portal/productos, no acá.
  //
  // Estuvieron arriba del tablero un tiempo, con la idea de que el muro de
  // "falta" empujara a cargarlos. Con una marca de 72 productos el efecto es
  // el contrario: entra a ver cómo vendió y lo primero que encuentra son 72
  // renglones vacíos. El tablero cuenta lo que pasó; la lista de productos es
  // otra tarea y ahora tiene su propia pantalla.
  return (
    <>
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
