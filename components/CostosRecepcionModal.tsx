"use client";

import { useState, useTransition } from "react";
import type { OrdenCompraProveedor, DetalleOrdenCompra } from "@/lib/supabase";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import { actualizarCostosRecepcion } from "@/app/(app)/proveedores/actions";

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

export default function CostosRecepcionModal({
  orden,
  detalle,
  proveedor,
  nombrePorVariante,
  costoActualPorVariante,
  onClose,
}: {
  orden: OrdenCompraProveedor;
  detalle: DetalleOrdenCompra[];
  proveedor: ProveedorConSaldo | undefined;
  nombrePorVariante: Map<string, string>;
  costoActualPorVariante: Map<string, number | null>;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [costos, setCostos] = useState<Record<string, string>>(
    Object.fromEntries(detalle.map((d) => [d.id_variante, String(costoActualPorVariante.get(d.id_variante) ?? "")]))
  );

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await actualizarCostosRecepcion(
          orden.id_orden,
          detalle.map((d) => ({ idVariante: d.id_variante, costo: Number(costos[d.id_variante]) || 0 }))
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
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-200 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-accent uppercase">WiiGo</p>
            <h2 className="text-xl font-semibold text-neutral-900">Cargar factura de este pedido</h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              {proveedor?.nombre ?? "—"} · Pedido #{orden.id_orden.slice(0, 8).toUpperCase()}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-neutral-500">
            Cargá el precio que dice la factura/remito de {proveedor?.nombre ?? "este proveedor"} para esta entrega. Esto{" "}
            <b className="text-neutral-700">no genera deuda</b> — a él se le paga por lo que se venda, no por esta entrega —
            pero sirve para ver si el costo subió y dejarlo actualizado para calcular bien la próxima liquidación.
          </p>

          <div className="border border-neutral-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Producto</th>
                  <th className="p-3">Recibido</th>
                  <th className="p-3">Costo anterior</th>
                  <th className="p-3">Costo de esta factura</th>
                  <th className="p-3">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {detalle.map((d) => {
                  const costoAnterior = costoActualPorVariante.get(d.id_variante) ?? null;
                  const costoNuevo = Number(costos[d.id_variante]) || 0;
                  const diferencia = costoAnterior != null && costoNuevo > 0 ? costoNuevo - costoAnterior : null;
                  return (
                    <tr key={d.id_detalle} className="border-b border-neutral-100 last:border-0">
                      <td className="p-3 text-neutral-900">{nombrePorVariante.get(d.id_variante) ?? "—"}</td>
                      <td className="p-3 text-neutral-500">{d.cantidad_recibida}</td>
                      <td className="p-3 text-neutral-400">{costoAnterior != null ? `$${formatearMonto(costoAnterior)}` : "—"}</td>
                      <td className="p-2">
                        <input
                          type="number"
                          min={0}
                          value={costos[d.id_variante] ?? ""}
                          onChange={(e) => setCostos((prev) => ({ ...prev, [d.id_variante]: e.target.value }))}
                          className="w-24 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      </td>
                      <td className="p-3">
                        {diferencia == null || diferencia === 0 ? (
                          <span className="text-xs text-neutral-400">sin cambios</span>
                        ) : diferencia > 0 ? (
                          <span className="text-xs font-semibold text-red-600">▲ +${formatearMonto(diferencia)}</span>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-600">▼ -${formatearMonto(Math.abs(diferencia))}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Guardando..." : "Guardar factura"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
