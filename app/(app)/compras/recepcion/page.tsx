import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { contadoresCompras } from "@/lib/compras";
import { datosCompras } from "@/lib/comprasDatos";
import { mercaderiaParaDevolverAMarca } from "@/app/(app)/reposicion/actions";
import ComprasEtapas from "@/components/ComprasEtapas";
import ComprasTrabajo from "@/components/ComprasTrabajo";
import DevolverAMarca from "@/components/DevolverAMarca";
import AvisoCodigosPendientes from "@/components/AvisoCodigosPendientes";

export const dynamic = "force-dynamic";

// Etapa 2: recibir. La usa la operativa del local.
export default async function RecepcionPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "compras-recepcion")) return <PantallaBloqueada />;

  const [datos, contadores, aDevolver] = await Promise.all([
    datosCompras(),
    contadoresCompras(),
    mercaderiaParaDevolverAMarca(),
  ]);

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

      {/* Lo primero que se ve después de recepcionar: qué códigos hay que
          imprimir y pegar. Solo aparece si hay algo pendiente. */}
      {puedeVerPantalla(sesion, "codigos") && <AvisoCodigosPendientes />}

      {/* Lo que hay que devolverle a la marca, arriba de lo que está por
          llegar. Vivía en Abastecimiento, que era la misma pantalla de
          Compras por otra puerta. Va acá porque es el mismo momento y la
          misma persona: viene el repositor de Alta, recibís lo nuevo y le
          entregás lo fallado. Una visita, una pantalla. */}
      <DevolverAMarca items={aDevolver} />
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
