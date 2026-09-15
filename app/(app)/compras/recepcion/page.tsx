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
      {/* Dar por cerrado un pedido incompleto es decisión de administración,
          no del local: la operativa cuenta lo que hay en la caja, no negocia
          con el proveedor. Por eso el botón aparece solo si además tiene
          Costeo u Órdenes. */}
      <ComprasTrabajo
        etapa="RECEPCION"
        datos={datos}
        puedeCerrarPedidos={puedeVerPantalla(sesion, "compras-costeo") || puedeVerPantalla(sesion, "compras")}
      />
    </div>
  );
}
