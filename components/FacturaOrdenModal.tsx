"use client";

import { useState, useTransition } from "react";
import type { OrdenCompraProveedor, DetalleOrdenCompra } from "@/lib/supabase";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import { cargarFacturaCompra } from "@/app/(app)/proveedores/actions";

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

export default function FacturaOrdenModal({
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
  const [numeroFactura, setNumeroFactura] = useState("");
  const [tipoComprobante, setTipoComprobante] = useState("FACTURA_A");
  const [fechaEmision, setFechaEmision] = useState(new Date().toISOString().slice(0, 10));
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [precios, setPrecios] = useState<Record<string, string>>(
    Object.fromEntries(detalle.map((d) => [d.id_variante, String(costoActualPorVariante.get(d.id_variante) ?? "")]))
  );
  const [actualizarCosto, setActualizarCosto] = useState<Record<string, boolean>>({});
  const [monto, setMonto] = useState("");
  const [discriminaIva, setDiscriminaIva] = useState(false);
  const [ivaMonto, setIvaMonto] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [comprobante, setComprobante] = useState<File | null>(null);

  const totalCalculado = detalle.reduce((acc, d) => acc + d.cantidad_recibida * (Number(precios[d.id_variante]) || 0), 0);
  const montoNum = Number(monto) || 0;
  const diferencia = monto ? montoNum - totalCalculado : 0;
  const ivaNum = Number(ivaMonto) || 0;

  function handleToggleDiscriminaIva(checked: boolean) {
    setDiscriminaIva(checked);
    if (checked && !ivaMonto) {
      const base = montoNum || totalCalculado;
      setIvaMonto(base > 0 ? String(Math.round(base - base / 1.21)) : "");
    }
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await cargarFacturaCompra({
          idProveedor: orden.id_proveedor,
          idOrden: orden.id_orden,
          numeroFactura,
          tipoComprobante,
          fechaEmision,
          fechaVencimiento,
          monto: montoNum || totalCalculado,
          iva: discriminaIva ? ivaNum : null,
          observaciones,
          lineas: detalle.map((d) => ({
            idVariante: d.id_variante,
            cantidadFacturada: d.cantidad_recibida,
            precioUnitarioReal: Number(precios[d.id_variante]) || 0,
            actualizarCosto: !!actualizarCosto[d.id_variante],
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
            <h2 className="text-xl font-semibold text-neutral-900">Cargar factura</h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              {proveedor?.nombre ?? "—"} · Orden #{orden.id_orden.slice(0, 8).toUpperCase()}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">N° de factura</label>
              <input
                value={numeroFactura}
                onChange={(e) => setNumeroFactura(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Tipo</label>
              <select
                value={tipoComprobante}
                onChange={(e) => setTipoComprobante(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="FACTURA_A">Factura A</option>
                <option value="FACTURA_B">Factura B</option>
                <option value="FACTURA_C">Factura C</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Vencimiento</label>
              <input
                type="date"
                value={fechaVencimiento}
                onChange={(e) => setFechaVencimiento(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          <div className="border border-neutral-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Producto</th>
                  <th className="p-3">Recibido</th>
                  <th className="p-3">Costo actual</th>
                  <th className="p-3">Precio real</th>
                  <th className="p-3">Actualizar</th>
                </tr>
              </thead>
              <tbody>
                {detalle.map((d) => (
                  <tr key={d.id_detalle} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3 text-neutral-900">{nombrePorVariante.get(d.id_variante) ?? "—"}</td>
                    <td className="p-3 text-neutral-500">{d.cantidad_recibida}</td>
                    <td className="p-3 text-neutral-400">
                      {costoActualPorVariante.get(d.id_variante) != null ? `$${formatearMonto(costoActualPorVariante.get(d.id_variante)!)}` : "—"}
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min={0}
                        value={precios[d.id_variante] ?? ""}
                        onChange={(e) => setPrecios((prev) => ({ ...prev, [d.id_variante]: e.target.value }))}
                        className="w-24 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!actualizarCosto[d.id_variante]}
                        onChange={(e) => setActualizarCosto((prev) => ({ ...prev, [d.id_variante]: e.target.checked }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-neutral-500">Total calculado (cantidad × precio)</span>
              <span className="font-semibold text-neutral-900">${formatearMonto(totalCalculado)}</span>
            </div>
            <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Monto real de la factura</label>
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
                Diferencia de ${formatearMonto(Math.abs(diferencia))} contra lo calculado — puede ser flete u otro cargo legítimo.
              </p>
            )}

            <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer mt-3">
              <input type="checkbox" checked={discriminaIva} onChange={(e) => handleToggleDiscriminaIva(e.target.checked)} />
              Esta factura discrimina IVA
            </label>
            {discriminaIva && (
              <div className="mt-1.5">
                <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">IVA de la factura</label>
                <input
                  type="number"
                  min={0}
                  value={ivaMonto}
                  onChange={(e) => setIvaMonto(e.target.value)}
                  className="w-40 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <p className="text-[11px] text-neutral-400 mt-1">Sugerido con 21% — ajustalo si en la factura figura otro valor.</p>
              </div>
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
              disabled={isPending}
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
