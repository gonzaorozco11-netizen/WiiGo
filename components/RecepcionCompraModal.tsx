"use client";

import { useState, useTransition } from "react";
import type { Local, OrdenCompraProveedor, DetalleOrdenCompra } from "@/lib/supabase";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import { recepcionarOrdenCompra } from "@/app/(app)/proveedores/actions";
import { ESTADO_ESTILO_COMPRA } from "@/components/ProveedoresApp";
import { estaAbierta, etiquetaEstado, RECIBIDA_PARCIAL } from "@/lib/estadosOrden";

// Recibir mercadería, una entrega por vez.
//
// Un pedido puede llegar en varias veces: 8 el lunes y 4 el jueves. Por eso
// lo que se carga acá es SIEMPRE lo que llegó ahora, nunca el acumulado —
// la columna "ya recibido" está para mirar, no para tocar.
//
// La operativa no decide si el pedido se cierra: eso sale de los números.
// Si después de esta entrega falta algo, el pedido vuelve solo a Recepción.

export default function RecepcionCompraModal({
  orden,
  detalle,
  proveedor,
  local,
  nombrePorVariante,
  onClose,
}: {
  orden: OrdenCompraProveedor;
  detalle: DetalleOrdenCompra[];
  proveedor: ProveedorConSaldo | undefined;
  local: Local | undefined;
  nombrePorVariante: Map<string, string>;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [observaciones, setObservaciones] = useState("");

  const abierta = estaAbierta(orden.estado);
  const esSegundaVuelta = orden.estado === RECIBIDA_PARCIAL;

  /** Lo que falta de cada renglón. Es lo que se propone recibir. */
  const faltaDe = (d: DetalleOrdenCompra) =>
    Math.max(0, (d.cantidad_solicitada ?? 0) - (d.cantidad_recibida ?? 0));

  const [recibidos, setRecibidos] = useState<Record<string, number>>(
    Object.fromEntries(detalle.map((d) => [d.id_detalle, faltaDe(d)]))
  );

  const totalSolicitado = detalle.reduce((acc, d) => acc + (d.cantidad_solicitada ?? 0), 0);
  const totalYaRecibido = detalle.reduce((acc, d) => acc + (d.cantidad_recibida ?? 0), 0);
  const totalAhora = detalle.reduce((acc, d) => acc + (recibidos[d.id_detalle] ?? 0), 0);
  const totalPendiente = detalle.reduce(
    (acc, d) => acc + Math.max(0, (d.cantidad_solicitada ?? 0) - (d.cantidad_recibida ?? 0) - (recibidos[d.id_detalle] ?? 0)),
    0
  );
  const quedaAbierto = totalPendiente > 0;
  const codigo = orden.id_orden.slice(0, 8).toUpperCase();

  function handleConfirmar() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await recepcionarOrdenCompra(
          orden.id_orden,
          detalle.map((d) => ({
            idDetalle: d.id_detalle,
            idVariante: d.id_variante,
            cantidadSolicitada: d.cantidad_solicitada,
            // Lo que llegó AHORA. El servidor lo suma a lo que ya había.
            cantidadRecibida: recibidos[d.id_detalle] ?? 0,
          })),
          observaciones
        );
        if (res.error) setError(res.error);
        else onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-200 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-accent uppercase">WiiGo</p>
            <h2 className="text-xl font-semibold text-neutral-900">
              {!abierta ? "Orden de Compra" : esSegundaVuelta ? "Recibir el resto" : "Recibir mercadería"}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              #{codigo} · pedido el{" "}
              {new Date(orden.fecha_alta).toLocaleDateString("es-AR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
              {esSegundaVuelta && " · ya entró una parte"}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium text-neutral-900">
                {proveedor?.nombre ?? "—"} <span className="text-neutral-400">→</span> {local?.nombre ?? "—"}
              </p>
              {proveedor?.contacto && <p className="text-xs text-neutral-500">Contacto: {proveedor.contacto}</p>}
            </div>
            <span
              className={`text-xs font-semibold rounded-full px-2.5 py-1 ${
                ESTADO_ESTILO_COMPRA[orden.estado] ?? "bg-neutral-100 text-neutral-600"
              }`}
            >
              {etiquetaEstado(orden.estado, true)}
            </span>
          </div>

          <div className="border border-neutral-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500 bg-neutral-50">
                  <th className="p-3">Producto</th>
                  <th className="p-3 text-right">Pedido</th>
                  {esSegundaVuelta && <th className="p-3 text-right">Ya recibido</th>}
                  {abierta && <th className="p-3 text-right bg-accent-tint text-accent">Recibo ahora</th>}
                  <th className="p-3 text-right">{abierta ? "Queda pendiente" : "Recibido"}</th>
                </tr>
              </thead>
              <tbody>
                {detalle.map((d) => {
                  const pedido = d.cantidad_solicitada ?? 0;
                  const previo = d.cantidad_recibida ?? 0;
                  const ahora = recibidos[d.id_detalle] ?? 0;
                  const pendiente = Math.max(0, pedido - previo - ahora);
                  const yaCerrado = previo >= pedido;
                  return (
                    <tr
                      key={d.id_detalle}
                      className={`border-b border-neutral-100 last:border-0 ${yaCerrado && abierta ? "opacity-50" : ""}`}
                    >
                      <td className="p-3 text-neutral-900">{nombrePorVariante.get(d.id_variante) ?? "—"}</td>
                      <td className="p-3 text-right text-neutral-500 tabular-nums">{pedido}</td>
                      {esSegundaVuelta && (
                        <td className="p-3 text-right text-neutral-500 tabular-nums">{previo}</td>
                      )}
                      {abierta && (
                        <td className="p-2 text-right bg-accent-tint">
                          {yaCerrado ? (
                            <span className="text-neutral-400 px-3">—</span>
                          ) : (
                            <input
                              type="number"
                              min={0}
                              value={ahora}
                              onChange={(e) =>
                                setRecibidos((prev) => ({
                                  ...prev,
                                  [d.id_detalle]: Math.max(0, Number(e.target.value)),
                                }))
                              }
                              className="w-20 rounded-lg border border-accent px-2 py-1.5 text-sm text-right font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                          )}
                        </td>
                      )}
                      <td className="p-3 text-right tabular-nums">
                        {!abierta ? (
                          <span className="text-neutral-900">{previo}</span>
                        ) : yaCerrado ? (
                          <span className="text-neutral-400 text-xs">cerrado</span>
                        ) : pendiente === 0 ? (
                          <span className="text-emerald-600 font-semibold text-xs">✓ completo</span>
                        ) : (
                          <span className="text-amber-700 font-semibold">{pendiente}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-50 border-t border-neutral-200 font-semibold tabular-nums">
                  <td className="p-3 text-xs text-neutral-500 uppercase">Total</td>
                  <td className="p-3 text-right text-neutral-900">{totalSolicitado}</td>
                  {esSegundaVuelta && <td className="p-3 text-right text-neutral-900">{totalYaRecibido}</td>}
                  {abierta && <td className="p-3 text-right text-accent bg-accent-tint">{totalAhora}</td>}
                  <td className={`p-3 text-right ${totalPendiente > 0 ? "text-amber-700" : "text-neutral-900"}`}>
                    {abierta ? totalPendiente : totalYaRecibido}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {abierta ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Observaciones</label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  rows={2}
                  placeholder="Ej: el repartidor dijo que el resto llega el jueves..."
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              {quedaAbierto ? (
                <div className="flex gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-3">
                  <span aria-hidden="true">⏳</span>
                  <p className="text-sm text-amber-900">
                    <b>
                      Faltan {totalPendiente} {totalPendiente === 1 ? "unidad" : "unidades"}.
                    </b>{" "}
                    Las {totalAhora} que recibís entran al stock ahora y se pueden vender. El pedido queda abierto
                    esperando el resto.
                  </p>
                </div>
              ) : (
                <div className="flex gap-2.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-3">
                  <span aria-hidden="true">✓</span>
                  <p className="text-sm text-emerald-800">
                    Con esto llegó todo lo pedido. El pedido se cierra y pasa a Costeo.
                  </p>
                </div>
              )}

              {error && (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmar}
                  disabled={isPending || totalAhora === 0}
                  className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
                >
                  {isPending ? "Confirmando..." : quedaAbierto ? "Confirmar lo que llegó" : "Confirmar recepción"}
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={onClose}
              className="w-full rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
