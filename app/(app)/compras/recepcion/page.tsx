import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { ordenesDeCompra, contadoresCompras } from "@/lib/compras";
import ComprasEtapas from "@/components/ComprasEtapas";
import { FilaOrden, Vacio } from "@/components/ComprasLista";

export const dynamic = "force-dynamic";

// Etapa 2 de Compras: recibir.
//
// La usa la operativa del local, y por eso muestra SOLO lo que está esperando
// llegar — nada de historial ni de pedidos ya cerrados. Y ni un número de
// plata: contar unidades no necesita saber cuánto costó cada cosa, y con las
// marcas el costo es información sensible.
//
// Lo más viejo va primero: es lo que lleva más tiempo esperando.
export default async function RecepcionPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "compras-recepcion")) return <PantallaBloqueada />;

  const [pendientes, contadores] = await Promise.all([ordenesDeCompra(true), contadoresCompras()]);

  return (
    <div className="max-w-4xl mx-auto">
      <ComprasEtapas
        actual="RECEPCION"
        contadores={contadores}
        puedeVer={(c) =>
          puedeVerPantalla(sesion, c === "ORDENES" ? "compras" : c === "RECEPCION" ? "compras-recepcion" : "compras-costeo")
        }
      />

      <h1 className="text-xl font-semibold text-neutral-900 mb-1">Recepción de mercadería</h1>
      <p className="text-sm text-neutral-500 mb-5">
        Contá lo que hay en la caja y cargá <b className="text-neutral-700">eso</b>, no lo que dice el remito. Si falta
        algo, queda el reclamo hecho solo.
      </p>

      {pendientes.length === 0 ? (
        <Vacio texto="No hay nada esperando. Todo lo que se pidió ya llegó." />
      ) : (
        <div className="flex flex-col gap-2">
          {pendientes.map((o) => (
            <FilaOrden
              key={`${o.origen}-${o.idOrden}`}
              o={o}
              href={o.origen === "MARCA" ? "/reposicion" : "/proveedores"}
              accion="Recepcionar"
            />
          ))}
        </div>
      )}

      <p className="text-xs text-neutral-400 mt-5">
        Los pedidos a marcas se recepcionan en Abastecimiento y los de proveedores en Proveedores. Esta pantalla
        junta los dos para que veas todo lo que está por llegar en un solo lugar.
      </p>
    </div>
  );
}
