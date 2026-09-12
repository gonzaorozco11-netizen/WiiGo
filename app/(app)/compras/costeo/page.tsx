import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { recibidosSinCostear, contadoresCompras } from "@/lib/compras";
import ComprasEtapas from "@/components/ComprasEtapas";
import { FilaCosteo, Vacio } from "@/components/ComprasLista";

export const dynamic = "force-dynamic";

// Etapa 3 de Compras: ponerle precio a lo que llegó.
//
// Es de administración, y es la etapa que más se olvida — porque nada se
// rompe en el momento. Lo que se rompe es después: la liquidación del mes
// sale mal y el margen que muestran las pantallas es mentira.
//
// Solo aparecen proveedores. A las marcas no se les costea nada: se les cobra
// un royalty sobre el precio de venta, así que su mercadería no tiene costo
// para WiiGo. No es un olvido, es que no corresponde.
export default async function CosteoPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "compras-costeo")) return <PantallaBloqueada />;

  const [pendientes, contadores] = await Promise.all([recibidosSinCostear(), contadoresCompras()]);
  const vencidos = pendientes.filter((r) => r.diasSinCostear > 3).length;

  return (
    <div className="max-w-4xl mx-auto">
      <ComprasEtapas
        actual="COSTEO"
        contadores={contadores}
        puedeVer={(c) =>
          puedeVerPantalla(sesion, c === "ORDENES" ? "compras" : c === "RECEPCION" ? "compras-recepcion" : "compras-costeo")
        }
      />

      <h1 className="text-xl font-semibold text-neutral-900 mb-1">Costeo de recibidos</h1>
      <p className="text-sm text-neutral-500 mb-5">
        Ponerle el precio a lo que llegó. Hasta que no se hace, la liquidación de ese proveedor se calcula mal y el
        margen que ves en las pantallas no es real.
      </p>

      {vencidos > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
          <p className="text-sm text-red-800">
            <b>
              {vencidos} {vencidos === 1 ? "recepción lleva" : "recepciones llevan"} más de 3 días sin costear.
            </b>{" "}
            Todo lo que se vendió de esa mercadería en el medio está usando un costo viejo o estimado.
          </p>
        </div>
      )}

      {pendientes.length === 0 ? (
        <Vacio texto="Todo lo recibido tiene su costo cargado." />
      ) : (
        <div className="flex flex-col gap-2">
          {pendientes.map((r) => (
            <FilaCosteo key={r.idRecepcion} r={r} href="/proveedores" />
          ))}
        </div>
      )}

      <div className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 mt-5">
        <p className="text-xs text-neutral-500">
          <b className="text-neutral-700">La pantalla pide cosas distintas según el proveedor.</b> Con los de
          liquidación mensual alcanza con el costo — su factura llega a fin de mes y se carga contra la
          liquidación. Con los que facturan por entrega, además hay que cargar el número de factura y el
          vencimiento, y ahí sí nace la deuda.
        </p>
      </div>
    </div>
  );
}
