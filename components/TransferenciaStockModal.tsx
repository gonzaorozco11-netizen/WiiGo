"use client";

import { useMemo, useState, useTransition } from "react";
import type { Local, Producto, Marca, VarianteProducto } from "@/lib/supabase";
import { transferirStock } from "@/app/(app)/stock/actions";

type Fila = { variante: VarianteProducto; producto: Producto; marca: Marca | undefined };

export default function TransferenciaStockModal({
  locales,
  filas,
  cantidadPorClave,
  onClose,
}: {
  locales: Local[];
  filas: Fila[];
  cantidadPorClave: Map<string, number>;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [idVariante, setIdVariante] = useState(filas[0]?.variante.id_variante ?? "");
  const [idLocalOrigen, setIdLocalOrigen] = useState(locales[0]?.id_local ?? "");
  const [idLocalDestino, setIdLocalDestino] = useState(locales[1]?.id_local ?? locales[0]?.id_local ?? "");

  const cantidadEnOrigen = useMemo(
    () => cantidadPorClave.get(`${idVariante}_${idLocalOrigen}`) ?? 0,
    [cantidadPorClave, idVariante, idLocalOrigen]
  );

  function handleSubmit(formData: FormData) {
    setError(null);
    const cantidad = Number(formData.get("cantidad"));
    const motivo = String(formData.get("motivo") ?? "");

    startTransition(async () => {
      try {
        const res = await transferirStock(idVariante, idLocalOrigen, idLocalDestino, cantidad, motivo);
        if (res.error) setError(res.error);
        else onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Transferir stock entre locales</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <form action={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="variante">
              Producto
            </label>
            <select
              id="variante"
              value={idVariante}
              onChange={(e) => setIdVariante(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {filas.map((f) => (
                <option key={f.variante.id_variante} value={f.variante.id_variante}>
                  {f.producto.nombre}
                  {f.variante.nombre !== "Único" ? ` — ${f.variante.nombre}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="origen">
                Desde
              </label>
              <select
                id="origen"
                value={idLocalOrigen}
                onChange={(e) => setIdLocalOrigen(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {locales.map((l) => (
                  <option key={l.id_local} value={l.id_local}>
                    {l.nombre}
                  </option>
                ))}
              </select>
              <p className="text-xs text-neutral-500 mt-1">Stock disponible: {cantidadEnOrigen}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="destino">
                Hacia
              </label>
              <select
                id="destino"
                value={idLocalDestino}
                onChange={(e) => setIdLocalDestino(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {locales.map((l) => (
                  <option key={l.id_local} value={l.id_local}>
                    {l.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="cantidad">
              Cantidad a transferir
            </label>
            <input
              id="cantidad"
              name="cantidad"
              type="number"
              min={1}
              max={cantidadEnOrigen}
              defaultValue={1}
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
              placeholder="Opcional"
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
              disabled={isPending || idLocalOrigen === idLocalDestino}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Transfiriendo..." : "Transferir"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
