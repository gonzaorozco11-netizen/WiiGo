"use client";

import { useState, useTransition } from "react";
import type { Local, Producto, VarianteProducto } from "@/lib/supabase";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import { registrarDevolucionProveedor } from "@/app/(app)/proveedores/actions";

type FilaVariante = { variante: VarianteProducto; producto: Producto };

export default function DevolucionProveedorModal({
  proveedor,
  locales,
  filas,
  onClose,
}: {
  proveedor: ProveedorConSaldo;
  locales: Local[];
  filas: FilaVariante[];
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [idLocal, setIdLocal] = useState(locales[0]?.id_local ?? "");
  const [idVariante, setIdVariante] = useState(filas[0]?.variante.id_variante ?? "");
  const [cantidad, setCantidad] = useState("1");
  const [motivo, setMotivo] = useState("");

  function nombreVariante(f: FilaVariante) {
    return `${f.producto.nombre}${f.variante.nombre !== "Único" ? ` — ${f.variante.nombre}` : ""}`;
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await registrarDevolucionProveedor(proveedor.id_proveedor, idLocal, idVariante, Number(cantidad) || 0, motivo);
        if (res.error) setError(res.error);
        else onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-neutral-900">Devolución a proveedor</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <p className="text-sm text-neutral-500 mb-4">{proveedor.nombre}</p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Local</label>
            <select
              value={idLocal}
              onChange={(e) => setIdLocal(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {locales.map((l) => (
                <option key={l.id_local} value={l.id_local}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Producto</label>
            <select
              value={idVariante}
              onChange={(e) => setIdVariante(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {filas.map((f) => (
                <option key={f.variante.id_variante} value={f.variante.id_variante}>
                  {nombreVariante(f)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Cantidad a devolver</label>
            <input
              type="number"
              min={1}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Motivo (opcional)</label>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: llegó golpeado, vencido, etc."
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
              disabled={isPending || !idVariante || !idLocal}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Registrando..." : "Registrar devolución"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
