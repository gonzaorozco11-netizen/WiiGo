"use client";

import { useEffect, useState, useTransition } from "react";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import { calcularResumenPeriodoProveedor, cargarFacturaCompra } from "@/app/(app)/proveedores/actions";

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

export default function FacturaPeriodoModal({
  proveedor,
  nombrePorVariante,
  costoActualPorVariante,
  onClose,
}: {
  proveedor: ProveedorConSaldo;
  nombrePorVariante: Map<string, string>;
  costoActualPorVariante: Map<string, number | null>;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [fechaDesde, setFechaDesde] = useState(primerDiaDelMes());
  const [fechaHasta, setFechaHasta] = useState(hoyISO());
  const [resumen, setResumen] = useState<{ idVariante: string; cantidadNeta: number }[]>([]);
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [actualizarCosto, setActualizarCosto] = useState<Record<string, boolean>>({});
  const [numeroFactura, setNumeroFactura] = useState("");
  const [monto, setMonto] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [comprobante, setComprobante] = useState<File | null>(null);

  useEffect(() => {
    if (!fechaDesde || !fechaHasta) return;
    setBuscando(true);
    calcularResumenPeriodoProveedor(proveedor.id_proveedor, fechaDesde, fechaHasta)
      .then((r) => {
        setResumen(r);
        setPrecios((prev) => {
          const next = { ...prev };
          for (const linea of r) {
            if (!(linea.idVariante in next)) next[linea.idVariante] = String(costoActualPorVariante.get(linea.idVariante) ?? "");
          }
          return next;
        });
      })
      .finally(() => setBuscando(false));
  }, [proveedor.id_proveedor, fechaDesde, fechaHasta, costoActualPorVariante]);

  const totalCalculado = resumen.reduce((acc, l) => acc + l.cantidadNeta * (Number(precios[l.idVariante]) || 0), 0);
  const montoNum = Number(monto) || 0;
  const diferencia = monto ? montoNum - totalCalculado : 0;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await cargarFacturaCompra({
          idProveedor: proveedor.id_proveedor,
          fechaPeriodoDesde: fechaDesde,
          fechaPeriodoHasta: fechaHasta,
          numeroFactura,
          tipoComprobante: "FACTURA_A",
          fechaEmision: hoyISO(),
          fechaVencimiento: "",
          monto: montoNum || totalCalculado,
          observaciones,
          lineas: resumen
            .filter((l) => l.cantidadNeta > 0)
            .map((l) => ({
              idVariante: l.idVariante,
              cantidadFacturada: l.cantidadNeta,
              precioUnitarioReal: Number(precios[l.idVariante]) || 0,
              actualizarCosto: !!actualizarCosto[l.idVariante],
            })),
          comprobante,
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
            <h2 className="text-xl font-semibold text-neutral-900">Factura por período</h2>
            <p className="text-xs text-neutral-400 mt-0.5">{proveedor.nombre}</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
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
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">N° de factura</label>
              <input
                value={numeroFactura}
                onChange={(e) => setNumeroFactura(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          <p className="text-xs text-neutral-500">
            Junta automáticamente lo recibido menos lo devuelto de este proveedor en ese rango de fechas, sin contar lo que ya
            esté facturado antes.
          </p>

          {buscando ? (
            <p className="text-sm text-neutral-400 text-center py-6">Buscando...</p>
          ) : resumen.length === 0 ? (
            <p className="text-sm text-neutral-500 text-center py-6 border border-dashed border-neutral-200 rounded-xl">
              No hay nada para facturar en este período.
            </p>
          ) : (
            <div className="border border-neutral-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="p-3">Producto</th>
                    <th className="p-3">Neto (recibido − devuelto)</th>
                    <th className="p-3">Precio real</th>
                    <th className="p-3">Actualizar costo</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.map((l) => (
                    <tr key={l.idVariante} className="border-b border-neutral-100 last:border-0">
                      <td className="p-3 text-neutral-900">{nombrePorVariante.get(l.idVariante) ?? "—"}</td>
                      <td className="p-3 text-neutral-500">{l.cantidadNeta}</td>
                      <td className="p-2">
                        <input
                          type="number"
                          min={0}
                          value={precios[l.idVariante] ?? ""}
                          onChange={(e) => setPrecios((prev) => ({ ...prev, [l.idVariante]: e.target.value }))}
                          className="w-24 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={!!actualizarCosto[l.idVariante]}
                          onChange={(e) => setActualizarCosto((prev) => ({ ...prev, [l.idVariante]: e.target.checked }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-neutral-500">Total calculado por el sistema</span>
              <span className="font-semibold text-neutral-900">${formatearMonto(totalCalculado)}</span>
            </div>
            <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Monto real de la factura del proveedor</label>
            <input
              type="number"
              min={0}
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder={String(totalCalculado)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {monto && diferencia !== 0 && (
              <p className="text-xs text-amber-700 mt-2">
                No coincide con lo calculado por ${formatearMonto(Math.abs(diferencia))} — revisá antes de confirmar si hace
                falta.
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

          <div>
            <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Comprobante de la factura (opcional)</label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setComprobante(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
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
              disabled={isPending || resumen.length === 0}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Cargando..." : `Cargar factura por $${formatearMonto(montoNum || totalCalculado)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
