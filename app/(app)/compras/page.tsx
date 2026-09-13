import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { contadoresCompras } from "@/lib/compras";
import { datosCompras } from "@/lib/comprasDatos";
import ComprasEtapas from "@/components/ComprasEtapas";
import ComprasTrabajo from "@/components/ComprasTrabajo";

export const dynamic = "force-dynamic";

// Etapa 1: pedir. La usa administración.
export default async function ComprasPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "compras")) return <PantallaBloqueada />;

  const [datos, contadores] = await Promise.all([datosCompras(), contadoresCompras()]);

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
      <ComprasTrabajo etapa="ORDENES" datos={datos} />
    </div>
  );
}
