import { obtenerSesionMarca, sesionIncluye } from "@/lib/marcaSesion";
import { resumenPortal } from "@/app/portal/actions";

export const dynamic = "force-dynamic";

function pesos(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearFecha(iso: string) {
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

function Tarjeta({
  etiqueta,
  valor,
  detalle,
  destacada,
}: {
  etiqueta: string;
  valor: string;
  detalle?: React.ReactNode;
  destacada?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        destacada ? "border-accent bg-accent-tint" : "border-neutral-200 bg-white"
      }`}
    >
      <p className="text-xs font-medium text-neutral-500">{etiqueta}</p>
      <p className="text-2xl font-bold text-neutral-900 tabular-nums mt-1">{valor}</p>
      {detalle && <div className="text-xs text-neutral-500 mt-1">{detalle}</div>}
    </div>
  );
}

export default async function PortalPage() {
  const sesion = await obtenerSesionMarca();
  const datos = await resumenPortal();

  if (!sesion || !datos) {
    return <p className="text-sm text-neutral-500 py-12 text-center">No se pudo cargar tu resumen.</p>;
  }

  const variacion =
    datos.mesAnteriorBruto > 0
      ? ((datos.mes.bruto - datos.mesAnteriorBruto) / datos.mesAnteriorBruto) * 100
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Cómo viene el mes</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Del {formatearFecha(datos.desdeISO)} al {formatearFecha(datos.hastaISO)}. Se actualiza solo con cada venta.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tarjeta
          etiqueta="Vendido este mes"
          valor={`$${pesos(datos.mes.bruto)}`}
          detalle={
            variacion === null ? (
              `${datos.mes.unidades} unidades`
            ) : (
              <span className={variacion >= 0 ? "text-emerald-600" : "text-red-600"}>
                {variacion >= 0 ? "▲" : "▼"} {Math.abs(variacion).toFixed(0)}% vs. mes anterior
              </span>
            )
          }
        />
        <Tarjeta
          etiqueta="Te queda a cobrar"
          valor={`$${pesos(datos.mes.neto)}`}
          detalle={`Después de $${pesos(datos.mes.royalty)} de comisión`}
          destacada
        />
        <Tarjeta
          etiqueta="Vendido hoy"
          valor={`$${pesos(datos.hoy.bruto)}`}
          detalle={`${datos.hoy.operaciones} pedido${datos.hoy.operaciones === 1 ? "" : "s"} · ${datos.hoy.unidades} unidades`}
        />
        <Tarjeta
          etiqueta="Ticket promedio"
          valor={`$${pesos(datos.ticketPromedio)}`}
          detalle={`${datos.mes.operaciones} pedidos en el mes`}
        />
      </div>

      {/* Nota deliberada: es la primera pregunta de toda marca, y si no está
          escrita al lado del número, la respuesta se discute por WhatsApp. */}
      <p className="text-xs text-neutral-400 -mt-2">
        “Vendido” es el precio final que pagó el cliente, con IVA incluido — que es la base sobre la que se calcula la
        comisión de WiiGo.
      </p>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-sm font-semibold text-neutral-800 mb-3">Tu cuenta con WiiGo</p>
          <dl className="text-sm">
            <div className="flex justify-between py-1.5 border-b border-neutral-100">
              <dt className="text-neutral-500">Liquidaciones cerradas sin cobrar</dt>
              <dd className="font-semibold tabular-nums text-emerald-700">
                ${pesos(datos.liquidacionesPendientes)}
              </dd>
            </div>
            <div className="flex justify-between py-1.5 border-b border-neutral-100">
              <dt className="text-neutral-500">Lo que le debés a WiiGo</dt>
              <dd className="font-semibold tabular-nums">
                {datos.saldoComercial > 0 ? `$${pesos(datos.saldoComercial)}` : "—"}
              </dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-neutral-500">Del mes en curso (todavía sin liquidar)</dt>
              <dd className="font-semibold tabular-nums">${pesos(datos.mes.neto)}</dd>
            </div>
          </dl>
          <p className="text-xs text-neutral-400 mt-3">
            El mes en curso es provisorio: cambia con cada venta hasta que se cierre la liquidación.
          </p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-sm font-semibold text-neutral-800 mb-3">Cómo te pagan</p>
          {datos.porMedioPago.length === 0 ? (
            <p className="text-sm text-neutral-400 py-6 text-center">Todavía no hay ventas este mes.</p>
          ) : (
            <ul className="space-y-2.5">
              {datos.porMedioPago.map((m) => (
                <li key={m.medio}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-neutral-600">{m.medio}</span>
                    <span className="tabular-nums text-neutral-900 font-medium">
                      ${pesos(m.monto)} · {m.porcentaje.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                    <div className="h-full bg-accent rounded-full" style={{ width: `${m.porcentaje}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {!sesionIncluye(sesion, "METAL") && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-sm font-semibold text-neutral-800">Hay más para ver</p>
          <p className="text-sm text-neutral-500 mt-1">
            Con el plan Metal sumás el ranking de tus productos, los que dejaron de rotar y el aviso cuando algo está
            por agotarse. Con Gold, además, cómo rinden tus productos comparados con el promedio de tu categoría.
          </p>
          <p className="text-xs text-neutral-400 mt-2">Consultanos para cambiar de plan.</p>
        </div>
      )}
    </div>
  );
}
