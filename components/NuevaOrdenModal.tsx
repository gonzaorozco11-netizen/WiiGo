"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Marca, Local } from "@/lib/supabase";
import type { FilaVariante } from "@/components/ReposicionApp";
import { crearOrden } from "@/app/(app)/reposicion/actions";

type Linea = { idVariante: string; cantidad: number; sugerida: boolean };

export default function NuevaOrdenModal({
  marcas,
  locales,
  filas,
  cantidadPorClave,
  onClose,
}: {
  marcas: Marca[];
  locales: Local[];
  filas: FilaVariante[];
  cantidadPorClave: Map<string, number>;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [idMarca, setIdMarca] = useState(marcas[0]?.id_marca ?? "");
  const [idLocal, setIdLocal] = useState(locales[0]?.id_local ?? "");
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [agregarSeleccion, setAgregarSeleccion] = useState("");

  const variantesDeMarca = useMemo(
    () => filas.filter((f) => f.marca?.id_marca === idMarca),
    [filas, idMarca]
  );

  // Sugiere automáticamente lo que está por debajo del mínimo en el local
  // elegido, con la cantidad necesaria para llegar al objetivo.
  useEffect(() => {
    const sugeridos = variantesDeMarca
      .map((f) => {
        const cantidadActual = cantidadPorClave.get(`${f.variante.id_variante}_${idLocal}`) ?? 0;
        if (cantidadActual >= f.variante.stock_minimo) return null;
        const cantidad = Math.max(f.variante.stock_objetivo - cantidadActual, 1);
        return { idVariante: f.variante.id_variante, cantidad, sugerida: true };
      })
      .filter((l): l is Linea => l !== null);
    setLineas(sugeridos);
  }, [idMarca, idLocal, variantesDeMarca, cantidadPorClave]);

  const nombreVariante = (idVariante: string) => {
    const f = variantesDeMarca.find((x) => x.variante.id_variante === idVariante);
    if (!f) return "—";
    return `${f.producto.nombre}${f.variante.nombre !== "Único" ? ` — ${f.variante.nombre}` : ""}`;
  };

  const disponiblesParaAgregar = variantesDeMarca.filter(
    (f) => !lineas.some((l) => l.idVariante === f.variante.id_variante)
  );

  function agregarProducto() {
    const idVariante = agregarSeleccion || disponiblesParaAgregar[0]?.variante.id_variante;
    if (!idVariante) return;
    setLineas((prev) => [...prev, { idVariante, cantidad: 1, sugerida: false }]);
    setAgregarSeleccion("");
  }

  function actualizarCantidad(idVariante: string, cantidad: number) {
    setLineas((prev) => prev.map((l) => (l.idVariante === idVariante ? { ...l, cantidad } : l)));
  }

  function quitarLinea(idVariante: string) {
    setLineas((prev) => prev.filter((l) => l.idVariante !== idVariante));
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
                onChange={(e) => setIdMarca(e.target.value)}
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
            <label className="block text-sm font-medium text-neutral-700 mb-1">Productos a pedir</label>
            <p className="text-xs text-neutral-500 mb-2">
              Se sugieren solos los que están por debajo del mínimo en este local, con la cantidad
              necesaria para llegar al objetivo. Podés sacar alguno o agregar otro a mano.
            </p>

            {variantesDeMarca.length === 0 ? (
              <p className="text-xs text-neutral-500 border border-dashed border-neutral-300 rounded-lg p-3">
                Esta marca no tiene productos cargados.
              </p>
            ) : lineas.length === 0 ? (
              <p className="text-xs text-neutral-500 border border-dashed border-neutral-300 rounded-lg p-3">
                Nada está por debajo del mínimo en este local. Agregá algo a mano si igual querés pedir.
              </p>
            ) : (
              <div className="space-y-2">
                {lineas.map((linea) => (
                  <div key={linea.idVariante} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-neutral-900">{nombreVariante(linea.idVariante)}</span>
                      {linea.sugerida && (
                        <span className="ml-2 text-xs bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">
                          sugerido
                        </span>
                      )}
                    </div>
                    <input
                      type="number"
                      min={1}
                      value={linea.cantidad}
                      onChange={(e) => actualizarCantidad(linea.idVariante, Number(e.target.value))}
                      className="w-20 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                    <button
                      type="button"
                      onClick={() => quitarLinea(linea.idVariante)}
                      className="text-sm text-red-500 shrink-0"
                    >
                      Sacar
                    </button>
                  </div>
                ))}
              </div>
            )}

            {disponiblesParaAgregar.length > 0 && (
              <div className="flex items-center gap-2 mt-3">
                <select
                  value={agregarSeleccion}
                  onChange={(e) => setAgregarSeleccion(e.target.value)}
                  className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">Agregar otro producto...</option>
                  {disponiblesParaAgregar.map((f) => (
                    <option key={f.variante.id_variante} value={f.variante.id_variante}>
                      {f.producto.nombre}
                      {f.variante.nombre !== "Único" ? ` — ${f.variante.nombre}` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={agregarProducto}
                  disabled={!agregarSeleccion}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50"
                >
                  Agregar
                </button>
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
