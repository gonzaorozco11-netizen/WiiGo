import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { contadoresCompras } from "@/lib/compras";
import { datosCompras } from "@/lib/comprasDatos";
import ComprasEtapas from "@/components/ComprasEtapas";
import ComprasTrabajo from "@/components/ComprasTrabajo";

export const dynamic = "force-dynamic";

// Etapa 2: recibir. La usa la operativa del local.
export default async function RecepcionPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "compras-recepcion")) return <PantallaBloqueada />;

  const [datos, contadores] = await Promise.all([datosCompras(), contadoresCompras()]);

  return (
    <div className="max-w-4xl mx-auto">
      <ComprasEtapas
        actual="RECEPCION"
        contadores={contadores}
        puedeVer={(c) =>
          puedeVerPantalla(
            sesion,
            c === "ORDENES" ? "compras" : c === "RECEPCION" ? "compras-recepcion" : "compras-costeo"
          )
        }
      />
      <ComprasTrabajo etapa="RECEPCION" datos={datos} />
    </div>
  );
}
