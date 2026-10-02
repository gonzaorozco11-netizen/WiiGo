"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Producto } from "@/lib/supabase";
import type { CostoDeMarca } from "@/lib/costosMarca";
import { costosDeMarcaAction, guardarCostoDeMarcaAction } from "@/app/(app)/marcas/actions";

// Lo que la marca dice que le cuesta su producto.
//
// Se muestra entrando a SU ficha y en ningún otro lado: es el dato más sensible
// que una marca te confía, y una lista con los costos de todas juntas es la
// forma más fácil de que se filtre sin que nadie lo decida.
//
// Se puede cargar desde acá además de desde el portal porque al principio una
// marca chica no entra al portal, y un costo que nadie carga deja el tablero de
// esa marca diciendo cuánto cobra pero no cuánto gana.

function monto(v: number) {
  return v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fechaCorta(iso: string | null) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export default function CostosDeMarca({ idMarca, productos }: { idMarca: string; productos: Producto[] }) {
  const [costos, setCostos] = useState<CostoDeMarca[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<Producto | null>(null);

  async function recargar() {
    setCargando(true);
    const r = await costosDeMarcaAction(idMarca);
    setCostos(r.costos);
    setCargando(false);
  }

  useEffect(() => {
    recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idMarca]);

  const porProducto = new Map(costos.map((c) => [c.idProducto, c]));
  const sinCargar = productos.filter((p) => !porProducto.has(p.id_producto)).length;

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-100 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-neutral-900">💵 Costos de la marca</p>
          <p className="text-xs text-neutral-400 mt-0.5">
            Lo que le cuesta a ella producir. Lo carga desde su portal; acá lo ves y lo podés corregir.
          </p>
        </div>
        {sinCargar > 0 && (
          <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
            {sinCargar} sin cargar
          </span>
        )}
      </div>

      {cargando ? (
        <p className="text-xs text-neutral-400 text-center py-6">Cargando…</p>
      ) : productos.length === 0 ? (
        <p className="text-xs text-neutral-400 text-center py-6">Esta marca todavía no tiene productos.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-400 border-b border-neutral-100">
                <th className="px-4 py-2 font-bold">Producto</th>
                <th className="px-4 py-2 font-bold text-right">Precio</th>
                <th className="px-4 py-2 font-bold text-right">Costo de la marca</th>
                <th className="px-4 py-2 font-bold">Rige desde</th>
                <th className="px-4 py-2 font-bold">Lo cargó</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => {
                const c = porProducto.get(p.id_producto);
                return (
                  <tr key={p.id_producto} className="border-b border-neutral-50 last:border-0">
                    <td className="px-4 py-2.5 text-neutral-900">{p.nombre}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">
                      ${monto(p.precio_venta ?? 0)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {c ? (
                        <b className="text-neutral-900">${monto(c.costo)}</b>
                      ) : (
                        <span className="text-amber-700 font-semibold">sin cargar</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-500 tabular-nums">{fechaCorta(c?.vigenteDesde ?? null)}</td>
                    <td className="px-4 py-2.5">
                      {c ? (
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                            c.cargadoPor === "MARCA"
                              ? "bg-accent-tint text-accent-dark"
                              : "bg-neutral-100 text-neutral-500"
                          }`}
                          title={c.nombreQuienCargo ?? ""}
                        >
                          {c.cargadoPor === "MARCA" ? "la marca" : c.nombreQuienCargo ?? "WiiGo"}
                        </span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => setEditando(p)} className="text-xs text-accent hover:underline">
                        {c ? "Editar" : "Cargar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <ModalCosto
          idMarca={idMarca}
          producto={editando}
          costoActual={porProducto.get(editando.id_producto) ?? null}
          onCerrar={(guardo) => {
            setEditando(null);
            if (guardo) recargar();
          }}
        />
      )}
    </div>
  );
}

function ModalCosto({
  idMarca,
  producto,
  costoActual,
  onCerrar,
}: {
  idMarca: string;
  producto: Producto;
  costoActual: CostoDeMarca | null;
  onCerrar: (guardo: boolean) => void;
}) {
  const router = useRouter();
  const [costo, setCosto] = useState(costoActual ? String(costoActual.costo) : "");
  const [desde, setDesde] = useState(hoyISO());
  const [error, setError] = useState<string | null>(null);
  const [guardando, empezar] = useTransition();

  function guardar() {
    setError(null);
    empezar(async () => {
      const r = await guardarCostoDeMarcaAction({
        idMarca,
        idProducto: producto.id_producto,
        costo: Number(costo) || 0,
        vigenteDesde: desde,
      });
      if (r.error) setError(r.error);
      else {
        router.refresh();
        onCerrar(true);
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6">
        <p className="text-xs font-semibold tracking-wide text-accent uppercase">WiiGo</p>
        <h2 className="text-lg font-semibold text-neutral-900">{producto.nombre}</h2>
        <p className="text-xs text-neutral-400 mt-0.5">Lo que le cuesta a la marca producir una unidad, sin IVA.</p>

        <div className="grid gap-3 sm:grid-cols-2 mt-4">
          <div>
            <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Costo por unidad</label>
            <input
              type="number"
              step="0.01"
              value={costo}
              onChange={(e) => setCosto(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Rige desde</label>
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        <p className="text-[11px] text-neutral-400 mt-2.5">
          El costo anterior no se borra: las ventas de antes se siguen calculando con el que regía ese
          día. Queda anotado que lo cargaste vos.
        </p>

        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{error}</p>
        )}

        <div className="flex justify-end gap-3 mt-5">
          <button onClick={() => onCerrar(false)} disabled={guardando} className="text-sm text-neutral-500">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !(Number(costo) > 0)}
            className="text-sm font-semibold bg-accent text-white rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
