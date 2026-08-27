"use client";

import { useState, useTransition } from "react";
import type { Local, OrdenCompraProveedor, DetalleOrdenCompra } from "@/lib/supabase";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import { recepcionarOrdenCompra } from "@/app/(app)/proveedores/actions";
import { ESTADO_ESTILO_COMPRA } from "@/components/ProveedoresApp";

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
  const [recibidos, setRecibidos] = useState<Record<string, number>>(
    Object.fromEntries(detalle.map((d) => [d.id_detalle, d.cantidad_solicitada]))
  );

  const esPendiente = orden.estado === "PENDIENTE";
  const totalSolicitado = detalle.reduce((acc, d) => acc + d.cantidad_solicitada, 0);
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
              {esPendiente ? "Recepcionar mercadería" : "Orden de Compra"}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              #{codigo} · {new Date(orden.fecha_alta).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-900">
                {proveedor?.nombre ?? "—"} <span className="text-neutral-400">→</span> {local?.nombre ?? "—"}
              </p>
              {proveedor?.contacto && <p className="text-xs text-neutral-500">Contacto: {proveedor.contacto}</p>}
            </div>
            <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${ESTADO_ESTILO_COMPRA[orden.estado] ?? "bg-neutral-100 text-neutral-600"}`}>
              {orden.estado.replaceAll("_", " ")}
            </span>
          </div>

          <div className="border border-neutral-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500 bg-neutral-50">
                  <th className="p-3">Producto</th>
                  <th className="p-3">Solicitado</th>
                  <th className="p-3">Recibido</th>
                  {!esPendiente && <th className="p-3">Diferencia</th>}
                </tr>
              </thead>
              <tbody>
                {detalle.map((d) => {
                  const recibido = esPendiente ? recibidos[d.id_detalle] ?? 0 : d.cantidad_recibida;
                  const diferencia = recibido - d.cantidad_solicitada;
                  return (
                    <tr key={d.id_detalle} className="border-b border-neutral-100 last:border-0">
                      <td className="p-3 text-neutral-900">{nombrePorVariante.get(d.id_variante) ?? "—"}</td>
                      <td className="p-3 text-neutral-500">{d.cantidad_solicitada}</td>
                      <td className="p-2">
                        {esPendiente ? (
                          <input
                            type="number"
                            min={0}
                            value={recibidos[d.id_detalle] ?? 0}
                            onChange={(e) => setRecibidos((prev) => ({ ...prev, [d.id_detalle]: Number(e.target.value) }))}
                            className="w-20 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                          />
                        ) : (
                          <span className="text-neutral-900 px-3">{d.cantidad_recibida}</span>
                        )}
                      </td>
                      {!esPendiente && (
                        <td className={`p-3 font-medium ${diferencia === 0 ? "text-neutral-500" : "text-red-600"}`}>
                          {diferencia > 0 ? `+${diferencia}` : diferencia}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-50 border-t border-neutral-200">
                  <td className="p-3 text-xs font-semibold text-neutral-500 uppercase">Total</td>
                  <td className="p-3 text-sm font-semibold text-neutral-900">{totalSolicitado}</td>
                  <td colSpan={esPendiente ? 1 : 2}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {esPendiente ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Observaciones</label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  rows={2}
                  placeholder="Ej: caja golpeada, faltante avisado al proveedor..."
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

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
                  disabled={isPending}
                  className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
                >
                  {isPending ? "Confirmando..." : "Confirmar recepción"}
                </button>
              </div>
            </>
          ) : (
            <button onClick={onClose} className="w-full rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700">
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
