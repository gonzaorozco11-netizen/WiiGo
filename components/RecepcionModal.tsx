"use client";

import { useState, useTransition } from "react";
import type { Marca, Local, OrdenReposicion, DetalleReposicion } from "@/lib/supabase";
import { recepcionarOrden } from "@/app/(app)/reposicion/actions";

export default function RecepcionModal({
  orden,
  detalle,
  marca,
  local,
  nombrePorVariante,
  onClose,
}: {
  orden: OrdenReposicion;
  detalle: DetalleReposicion[];
  marca: Marca | undefined;
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

  function handleConfirmar() {
    setError(null);
    startTransition(async () => {
      try {
        await recepcionarOrden(
          orden.id_orden,
          detalle.map((d) => ({
            idDetalle: d.id_detalle,
            idVariante: d.id_variante,
            cantidadSolicitada: d.cantidad_solicitada,
            cantidadRecibida: recibidos[d.id_detalle] ?? 0,
          })),
          observaciones
        );
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-neutral-900">
            {esPendiente ? "Recepcionar orden" : "Orden de reposición"}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <p className="text-sm text-neutral-500 mb-4">
          {marca?.nombre ?? "—"} · {local?.nombre ?? "—"} · {new Date(orden.fecha).toLocaleDateString("es-AR")}
        </p>

        <div className="border border-neutral-200 rounded-xl overflow-hidden mb-4">
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
                    <td className="p-3 text-neutral-900">
                      {nombrePorVariante.get(d.id_variante) ?? "—"}
                    </td>
                    <td className="p-3 text-neutral-500">{d.cantidad_solicitada}</td>
                    <td className="p-3">
                      {esPendiente ? (
                        <input
                          type="number"
                          min={0}
                          value={recibidos[d.id_detalle] ?? 0}
                          onChange={(e) =>
                            setRecibidos((prev) => ({ ...prev, [d.id_detalle]: Number(e.target.value) }))
                          }
                          className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      ) : (
                        <span className="text-neutral-900">{d.cantidad_recibida}</span>
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
          </table>
        </div>

        {esPendiente ? (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium text-neutral-700 mb-1">Observaciones</label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={2}
                placeholder="Ej: caja golpeada, faltante avisado al proveedor..."
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 mb-4" role="alert">
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
          <button
            onClick={onClose}
            className="w-full rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
          >
            Cerrar
          </button>
        )}
      </div>
    </div>
  );
}
