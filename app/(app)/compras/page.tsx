import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { contadoresCompras } from "@/lib/compras";
import { datosCompras } from "@/lib/comprasDatos";
import ComprasEtapas from "@/components/ComprasEtapas";
import ComprasTrabajo from "@/components/ComprasTrabajo";
import PropuestasPendientes from "@/components/PropuestasPendientes";
import { propuestasPendientes } from "@/app/(app)/reposicion/actions";

export const dynamic = "force-dynamic";

// Etapa 1: pedir. La usa administración.
export default async function ComprasPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "compras")) return <PantallaBloqueada />;

  const [datos, contadores, propuestas] = await Promise.all([
    datosCompras(),
    contadoresCompras(),
    propuestasPendientes(),
  ]);

  return (
    <div className="max-w-4xl mx-auto">
      <ComprasEtapas
        actual="ORDENES"
        contadores={contadores}
        puedeVer={(c) =>
          puedeVerPantalla(
            sesion,
            c === "ORDENES" ? "compras" : c === "RECEPCION" ? "compras-recepcion" : "compras-costeo"
          )
        }
      />
      {/* Arriba de las órdenes porque lo que llegó sin pedido está frenado en
          el depósito: es lo único de esta pantalla que no puede esperar. Si no
          hay nada esperando, el bloque no se dibuja. */}
      <PropuestasPendientes propuestas={propuestas} />
      <ComprasTrabajo etapa="ORDENES" datos={datos} />
    </div>
  );
}
