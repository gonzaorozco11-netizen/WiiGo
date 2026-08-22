"use client";

import { useState, useTransition } from "react";
import { ajustarStock } from "@/app/(app)/stock/actions";

export default function AjusteStockModal({
  nombre,
  idVariante,
  idLocal,
  cantidadActual,
  onClose,
}: {
  nombre: string;
  idVariante: string;
  idLocal: string;
  cantidadActual: number;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    const nuevaCantidad = Number(formData.get("cantidad"));
    const motivo = String(formData.get("motivo") ?? "");

    startTransition(async () => {
      try {
        const res = await ajustarStock(idVariante, idLocal, nuevaCantidad, motivo);
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Ajustar stock</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <p className="text-sm text-neutral-600 mb-4">{nombre}</p>

        <form action={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="cantidad">
              Cantidad real (actual: {cantidadActual})
            </label>
            <input
              id="cantidad"
              name="cantidad"
              type="number"
              min={0}
              defaultValue={cantidadActual}
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="motivo">
              Motivo
            </label>
            <input
              id="motivo"
              name="motivo"
              placeholder="Ej: conteo físico, rotura, ajuste inicial..."
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
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
