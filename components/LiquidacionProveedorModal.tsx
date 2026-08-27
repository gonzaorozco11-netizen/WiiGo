"use client";

import { useEffect, useState, useTransition } from "react";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import type { LineaLiquidacionProveedor } from "@/lib/liquidacionesProveedor";
import { calcularLiquidacionProveedorAction, generarLiquidacionProveedorAction } from "@/app/(app)/proveedores/actions";

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function primerDiaDelMes() {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function LiquidacionProveedorModal({
  proveedor,
  onClose,
}: {
  proveedor: ProveedorConSaldo;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [fechaDesde, setFechaDesde] = useState(primerDiaDelMes());
  const [fechaHasta, setFechaHasta] = useState(hoyISO());
  const [lineas, setLineas] = useState<LineaLiquidacionProveedor[]>([]);
  const [montoCalculado, setMontoCalculado] = useState(0);
  const [montoFinal, setMontoFinal] = useState("");
  const [observaciones, setObservaciones] = useState("");

  useEffect(() => {
    if (!fechaDesde || !fechaHasta) return;
    setBuscando(true);
    calcularLiquidacionProveedorAction(proveedor.id_proveedor, fechaDesde, fechaHasta)
      .then((r) => {
        setLineas(r.lineas);
        setMontoCalculado(r.total);
      })
      .finally(() => setBuscando(false));
  }, [proveedor.id_proveedor, fechaDesde, fechaHasta]);

  const montoNum = Number(montoFinal) || montoCalculado;
  const diferencia = montoFinal ? Number(montoFinal) - montoCalculado : 0;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await generarLiquidacionProveedorAction({
          idProveedor: proveedor.id_proveedor,
          fechaDesde,
          fechaHasta,
          montoFinal: montoNum,
          lineas,
          observaciones,
        });
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
            <h2 className="text-xl font-semibold text-neutral-900">Liquidación por venta</h2>
            <p className="text-xs text-neutral-400 mt-0.5">{proveedor.nombre} — se le paga el costo de lo vendido, no de lo entregado</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Desde</label>
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Hasta</label>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {buscando ? (
            <p className="text-sm text-neutral-400 text-center py-6">Calculando...</p>
          ) : lineas.length === 0 ? (
            <p className="text-sm text-neutral-500 text-center py-6 border border-dashed border-neutral-200 rounded-xl">
              No se vendió nada de sus productos en este período (o ya está todo liquidado).
            </p>
          ) : (
            <div className="border border-neutral-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="p-3">Producto</th>
                    <th className="p-3 text-right">Vendido</th>
                    <th className="p-3 text-right">Costo unit.</th>
                    <th className="p-3 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => (
                    <tr key={l.idVariante} className="border-b border-neutral-100 last:border-0">
                      <td className="p-3 text-neutral-900">{l.nombreProducto}</td>
                      <td className="p-3 text-right text-neutral-500">{l.cantidadVendida}</td>
                      <td className="p-3 text-right text-neutral-500">${formatearMonto(l.costoUnitario)}</td>
                      <td className="p-3 text-right font-medium text-neutral-900">${formatearMonto(l.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-neutral-500">
            Lo que no se vendió (quedó en stock o se devolvió) no aparece acá — no genera ninguna deuda.
          </p>

          <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-neutral-500">Total calculado por el sistema</span>
              <span className="font-semibold text-neutral-900">${formatearMonto(montoCalculado)}</span>
            </div>
            <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">
              Monto que dice la liquidación del proveedor (opcional, si no coincide)
            </label>
            <input
              type="number"
              min={0}
              value={montoFinal}
              onChange={(e) => setMontoFinal(e.target.value)}
              placeholder={String(montoCalculado)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {montoFinal && diferencia !== 0 && (
              <p className="text-xs text-amber-700 mt-2">
                Diferencia de ${formatearMonto(Math.abs(diferencia))} contra lo calculado — probablemente por el costo de
                referencia usado. Cotejá los pedidos del período si hace falta.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Observaciones</label>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
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
              disabled={isPending || lineas.length === 0}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Generando..." : `Generar liquidación por $${formatearMonto(montoNum)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
