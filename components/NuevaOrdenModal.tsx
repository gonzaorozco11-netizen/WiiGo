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

  const marca = marcas.find((m) => m.id_marca === idMarca);
  const local = locales.find((l) => l.id_local === idLocal);

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

  const totalUnidades = lineas.reduce((acc, l) => acc + (Number(l.cantidad) || 0), 0);

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
        const res = await crearOrden(
          idMarca,
          idLocal,
          lineas.map((l) => ({ idVariante: l.idVariante, cantidad: Number(l.cantidad) })),
          observaciones
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
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        {/* Encabezado tipo documento */}
        <div className="px-6 pt-6 pb-4 border-b border-neutral-200 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-accent uppercase">WiiGo</p>
            <h2 className="text-xl font-semibold text-neutral-900">Orden de Pedido</h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              {new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Para (marca)</label>
              <select
                value={idMarca}
                onChange={(e) => setIdMarca(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {marcas.map((m) => (
                  <option key={m.id_marca} value={m.id_marca}>
                    {m.nombre}
                  </option>
                ))}
              </select>
              {marca?.contacto && <p className="text-xs text-neutral-500 mt-1">Contacto: {marca.contacto}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Destino (local)</label>
              <select
                value={idLocal}
                onChange={(e) => setIdLocal(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {locales.map((l) => (
                  <option key={l.id_local} value={l.id_local}>
                    {l.nombre}
                  </option>
                ))}
              </select>
              {local?.direccion && <p className="text-xs text-neutral-500 mt-1">{local.direccion}</p>}
            </div>
          </div>

          <div>
            <p className="text-xs text-neutral-500 mb-2">
              Se sugieren solos los productos por debajo del mínimo en este local, con la cantidad
              necesaria para llegar al objetivo. Podés sacar alguno o agregar otro a mano.
            </p>

            <div className="border border-neutral-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="p-3">Producto</th>
                    <th className="p-3 w-28">Cantidad</th>
                    <th className="p-3 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {variantesDeMarca.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-xs text-neutral-500">
                        Esta marca no tiene productos cargados.
                      </td>
                    </tr>
                  ) : lineas.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-xs text-neutral-500">
                        Nada está por debajo del mínimo en este local. Agregá algo abajo si igual querés pedir.
                      </td>
                    </tr>
                  ) : (
                    lineas.map((linea) => (
                      <tr key={linea.idVariante} className="border-b border-neutral-100 last:border-0">
                        <td className="p-3">
                          <span className="text-neutral-900">{nombreVariante(linea.idVariante)}</span>
                          {linea.sugerida && (
                            <span className="ml-2 text-xs bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">
                              sugerido
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={1}
                            value={linea.cantidad}
                            onChange={(e) => actualizarCantidad(linea.idVariante, Number(e.target.value))}
                            className="w-20 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                          />
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            onClick={() => quitarLinea(linea.idVariante)}
                            className="text-xs text-red-500"
                          >
                            Sacar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {lineas.length > 0 && (
                  <tfoot>
                    <tr className="bg-neutral-50 border-t border-neutral-200">
                      <td className="p-3 text-xs font-semibold text-neutral-500 uppercase">Total</td>
                      <td colSpan={2} className="p-3 text-sm font-semibold text-neutral-900">
                        {totalUnidades} unidades
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

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
            <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Observaciones</label>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
              placeholder="Notas para la marca, forma de entrega, etc."
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
