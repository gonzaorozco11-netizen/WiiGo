"use client";

import { useMemo, useState, useTransition } from "react";
import type { Marca, Local } from "@/lib/supabase";
import type { FilaVariante } from "@/components/ReposicionApp";
import { crearOrden } from "@/app/(app)/reposicion/actions";

type Linea = { idVariante: string; cantidad: number };

export default function NuevaOrdenModal({
  marcas,
  locales,
  filas,
  onClose,
}: {
  marcas: Marca[];
  locales: Local[];
  filas: FilaVariante[];
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [idMarca, setIdMarca] = useState(marcas[0]?.id_marca ?? "");
  const [idLocal, setIdLocal] = useState(locales[0]?.id_local ?? "");
  const [observaciones, setObservaciones] = useState("");

  const variantesDeMarca = useMemo(
    () => filas.filter((f) => f.marca?.id_marca === idMarca),
    [filas, idMarca]
  );

  const [lineas, setLineas] = useState<Linea[]>([]);

  function agregarLinea() {
    const primera = variantesDeMarca.find((f) => !lineas.some((l) => l.idVariante === f.variante.id_variante));
    if (!primera) return;
    setLineas((prev) => [...prev, { idVariante: primera.variante.id_variante, cantidad: 1 }]);
  }

  function actualizarLinea(i: number, campo: keyof Linea, valor: string | number) {
    setLineas((prev) => prev.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  }

  function quitarLinea(i: number) {
    setLineas((prev) => prev.filter((_, j) => j !== i));
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await crearOrden(
          idMarca,
          idLocal,
          lineas.map((l) => ({ idVariante: l.idVariante, cantidad: Number(l.cantidad) })),
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Nueva orden de reposición</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Marca</label>
              <select
                value={idMarca}
                onChange={(e) => {
                  setIdMarca(e.target.value);
                  setLineas([]);
                }}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {marcas.map((m) => (
                  <option key={m.id_marca} value={m.id_marca}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </div>
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
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-neutral-700">Productos a pedir</label>
              <button type="button" onClick={agregarLinea} className="text-xs text-accent">
                + Agregar producto
              </button>
            </div>

            {variantesDeMarca.length === 0 ? (
              <p className="text-xs text-neutral-500 border border-dashed border-neutral-300 rounded-lg p-3">
                Esta marca no tiene productos cargados.
              </p>
            ) : lineas.length === 0 ? (
              <p className="text-xs text-neutral-500 border border-dashed border-neutral-300 rounded-lg p-3">
                Todavía no agregaste ningún producto.
              </p>
            ) : (
              <div className="space-y-2">
                {lineas.map((linea, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={linea.idVariante}
                      onChange={(e) => actualizarLinea(i, "idVariante", e.target.value)}
                      className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    >
                      {variantesDeMarca.map((f) => (
                        <option key={f.variante.id_variante} value={f.variante.id_variante}>
                          {f.producto.nombre}
                          {f.variante.nombre !== "Único" ? ` — ${f.variante.nombre}` : ""}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={linea.cantidad}
                      onChange={(e) => actualizarLinea(i, "cantidad", Number(e.target.value))}
                      className="w-20 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                    <button
                      type="button"
                      onClick={() => quitarLinea(i)}
                      className="text-sm text-red-500 shrink-0"
                    >
                      Borrar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Observaciones</label>
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
              {isPending ? "Creando..." : "Crear orden"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
