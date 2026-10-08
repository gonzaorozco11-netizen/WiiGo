"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Marca, Local, Producto, VarianteProducto } from "@/lib/supabase";
import { registrarLlegadaSinOrden } from "@/app/(app)/reposicion/actions";

// Llegó un bulto que nadie pidió.
//
// Decirle al operativo "no lo recibas" no sirve: lo tiene adelante y el flete
// ya se fue. Lo que hace falta es que lo cuente UNA vez, quede registrado con
// su remito, y que no entre a la góndola hasta que administración lo acepte.
//
// Por eso esto no toca el stock: abre una propuesta que aparece en Compras.

type Linea = { idVariante: string; cantidad: number };

export default function LlegoSinPedidoModal({
  marcas,
  locales,
  productos,
  variantes,
  onClose,
}: {
  marcas: Marca[];
  locales: Local[];
  productos: Producto[];
  variantes: VarianteProducto[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [idMarca, setIdMarca] = useState(marcas[0]?.id_marca ?? "");
  const [idLocal, setIdLocal] = useState(locales[0]?.id_local ?? "");
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, empezar] = useTransition();

  const productosDeMarca = useMemo(
    () => new Set(productos.filter((p) => p.id_marca === idMarca).map((p) => p.id_producto)),
    [productos, idMarca]
  );
  const variantesDeMarca = useMemo(
    () => variantes.filter((v) => productosDeMarca.has(v.id_producto)),
    [variantes, productosDeMarca]
  );
  const nombreDe = (idVariante: string) => {
    const v = variantes.find((x) => x.id_variante === idVariante);
    if (!v) return "—";
    const p = productos.find((x) => x.id_producto === v.id_producto);
    return `${p?.nombre ?? "Producto"}${v.nombre && v.nombre !== "Único" ? ` — ${v.nombre}` : ""}`;
  };

  const disponibles = variantesDeMarca.filter(
    (v) => !lineas.some((l) => l.idVariante === v.id_variante)
  );
  const total = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0), 0);

  function agregar() {
    const id = disponibles[0]?.id_variante;
    if (!id) return;
    setLineas((prev) => [...prev, { idVariante: id, cantidad: 1 }]);
  }

  function guardar() {
    setError(null);
    empezar(async () => {
      const r = await registrarLlegadaSinOrden(
        idMarca,
        idLocal,
        lineas.map((l) => ({ idVariante: l.idVariante, cantidad: Number(l.cantidad) || 0 })),
        observaciones
      );
      if (r.error) setError(r.error);
      else {
        router.refresh();
        onClose();
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-neutral-200 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Llegó algo que no pedimos</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Cargalo igual. Queda registrado y administración decide si se acepta.
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <b>No lo pongas en la góndola todavía.</b> Dejalo en depósito hasta que administración lo
            apruebe.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">
                ¿De qué marca es?
              </label>
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
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">
                ¿A qué local llegó?
              </label>
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
            <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1.5">
              ¿Qué llegó?
            </label>
            <div className="border border-neutral-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200 text-left text-[10px] uppercase tracking-wide text-neutral-400">
                    <th className="px-3 py-2 font-bold">Producto</th>
                    <th className="px-3 py-2 font-bold w-24 text-right">Cantidad</th>
                    <th className="px-2 py-2 w-14"></th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-xs text-neutral-500">
                        {variantesDeMarca.length === 0
                          ? "Esta marca no tiene productos cargados."
                          : "Agregá lo que haya en la caja."}
                      </td>
                    </tr>
                  ) : (
                    lineas.map((l, i) => (
                      <tr key={l.idVariante} className="border-b border-neutral-100 last:border-0">
                        <td className="px-3 py-2">
                          <select
                            value={l.idVariante}
                            onChange={(e) =>
                              setLineas((prev) =>
                                prev.map((x, j) => (j === i ? { ...x, idVariante: e.target.value } : x))
                              )
                            }
                            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                          >
                            <option value={l.idVariante}>{nombreDe(l.idVariante)}</option>
                            {disponibles.map((v) => (
                              <option key={v.id_variante} value={v.id_variante}>
                                {nombreDe(v.id_variante)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={1}
                            value={l.cantidad}
                            onChange={(e) =>
                              setLineas((prev) =>
                                prev.map((x, j) =>
                                  j === i ? { ...x, cantidad: Number(e.target.value) || 0 } : x
                                )
                              )
                            }
                            className="w-20 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setLineas((prev) => prev.filter((_, j) => j !== i))}
                            className="text-xs text-red-500"
                          >
                            Sacar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {disponibles.length > 0 && (
              <button
                type="button"
                onClick={agregar}
                className="text-xs font-semibold text-accent mt-2"
              >
                + Agregar producto
              </button>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">
              Observaciones
            </label>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
              placeholder="Quién lo trajo, en qué estado llegó, si vino con remito…"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {/* El remito se adjunta después, en la recepción que genera la
                aprobación: acá todavía no hay recepción donde colgarlo. */}
            <p className="text-[11px] text-neutral-400 mt-1">
              Si vino con remito, guardalo: se adjunta cuando administración lo acepte.
            </p>
          </div>

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-neutral-200 flex items-center justify-end gap-3">
          <span className="flex-1 text-xs text-neutral-500">
            {total > 0 ? `${total} unidades en total` : ""}
          </span>
          <button
            onClick={onClose}
            disabled={guardando}
            className="text-sm font-semibold text-neutral-600 border border-neutral-300 rounded-lg px-4 py-2"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || total <= 0}
            className="text-sm font-semibold bg-accent text-white rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Registrar la llegada"}
          </button>
        </div>
      </div>
    </div>
  );
}
