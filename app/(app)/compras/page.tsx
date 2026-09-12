import Link from "next/link";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import { ordenesDeCompra, contadoresCompras } from "@/lib/compras";
import ComprasEtapas from "@/components/ComprasEtapas";
import { FilaOrden, Vacio } from "@/components/ComprasLista";

export const dynamic = "force-dynamic";

// Etapa 1 de Compras: pedir.
//
// Muestra juntas las órdenes a marcas y a proveedores, que hasta ahora vivían
// en dos pantallas distintas y en dos grupos distintos del menú. Pedir es
// pedir: a quién se le pide es una columna, no otro circuito.
export default async function ComprasPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "compras")) return <PantallaBloqueada />;

  const [ordenes, contadores] = await Promise.all([ordenesDeCompra(false), contadoresCompras()]);
  const abiertas = ordenes.filter((o) => o.estado === "PENDIENTE");
  const cerradas = ordenes.filter((o) => o.estado !== "PENDIENTE");

  return (
    <div className="max-w-4xl mx-auto">
      <ComprasEtapas
        actual="ORDENES"
        contadores={contadores}
        puedeVer={(c) =>
          puedeVerPantalla(sesion, c === "ORDENES" ? "compras" : c === "RECEPCION" ? "compras-recepcion" : "compras-costeo")
        }
      />

      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h1 className="text-xl font-semibold text-neutral-900">Órdenes de compra</h1>
        <div className="flex gap-2">
          <Link
            href="/reposicion"
            className="text-sm font-semibold bg-accent hover:bg-accent-dark text-white rounded-lg px-3.5 py-2"
          >
            + Pedir a una marca
          </Link>
          <Link
            href="/proveedores"
            className="text-sm font-semibold text-neutral-700 border border-neutral-300 rounded-lg px-3.5 py-2"
          >
            + Pedir a un proveedor
          </Link>
        </div>
      </div>
      <p className="text-sm text-neutral-500 mb-5">
        Lo que pediste y todavía no llegó. Se pide igual a una marca que a un proveedor.
      </p>

      {abiertas.length === 0 ? (
        <Vacio texto="No hay pedidos esperando." />
      ) : (
        <div className="flex flex-col gap-2">
          {abiertas.map((o) => (
            <FilaOrden
              key={`${o.origen}-${o.idOrden}`}
              o={o}
              href={o.origen === "MARCA" ? "/reposicion" : "/proveedores"}
              accion="Ver"
            />
          ))}
        </div>
      )}

      {cerradas.length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-wider text-neutral-400 mt-7 mb-2">Ya recibidas</p>
          <div className="flex flex-col gap-2 opacity-75">
            {cerradas.slice(0, 15).map((o) => (
              <FilaOrden
                key={`${o.origen}-${o.idOrden}`}
                o={o}
                href={o.origen === "MARCA" ? "/reposicion" : "/proveedores"}
                accion="Ver"
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
