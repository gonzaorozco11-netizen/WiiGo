"use client";

import { useMemo, useState } from "react";

// Precio y stock, solo consulta: buscar por nombre, marca o código (también
// escaneando con el lector, que escribe el código y un Enter) y ver cuánto
// sale y cuánto hay. Nada se puede modificar desde acá.

export type FilaConsulta = {
  idVariante: string;
  producto: string;
  variante: string | null;
  marca: string;
  codigo: string | null;
  lista: number;
  efectivo: number;
  oferta: number | null;
  /** Unidades por local (id_local → cantidad). */
  stock: Record<string, number>;
};

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const MAXIMO = 60;

export default function ConsultaPrecioStock({ filas, locales }: { filas: FilaConsulta[]; locales: { idLocal: string; nombre: string }[] }) {
  const [busqueda, setBusqueda] = useState("");

  const resultados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (!q) return [];
    // Un código exacto (lo que deja el lector) va primero y solo.
    const exacto = filas.filter((f) => f.codigo && f.codigo === busqueda.trim());
    if (exacto.length > 0) return exacto;
    const palabras = q.split(/\s+/);
    return filas.filter((f) => {
      const texto = normalizar(`${f.producto} ${f.variante ?? ""} ${f.marca} ${f.codigo ?? ""}`);
      return palabras.every((p) => texto.includes(p));
    });
  }, [busqueda, filas]);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Precio y stock</h1>
      <p className="text-sm text-neutral-500 mb-4">Buscá un producto por nombre, marca o código, o escanealo. Es solo para consultar: acá no se modifica nada.</p>

      <input
        autoFocus
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        onKeyDown={(e) => {
          // El lector escribe el código y un Enter: se deja el código para mostrarlo.
          if (e.key === "Enter") e.preventDefault();
        }}
        placeholder="Ej: whey chocolate, Animalfit o 779..."
        className="w-full border border-neutral-300 rounded-xl px-4 py-3 text-base bg-white mb-4"
        aria-label="Buscar producto"
      />

      {!busqueda.trim() ? (
        <p className="text-sm text-neutral-400 text-center py-10 bg-white border border-neutral-200 rounded-xl">
          Escribí algo o escaneá un producto para ver su precio y cuánto hay.
        </p>
      ) : resultados.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-10 bg-white border border-neutral-200 rounded-xl">No encontramos ningún producto con “{busqueda}”.</p>
      ) : (
        <div className="space-y-2">
          {resultados.slice(0, MAXIMO).map((f) => {
            const total = Object.values(f.stock).reduce((a, n) => a + n, 0);
            return (
              <div key={f.idVariante} className="bg-white border border-neutral-200 rounded-xl px-4 py-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-neutral-900">
                    {f.producto}
                    {f.variante && <span className="text-neutral-500 font-normal"> — {f.variante}</span>}
                  </p>
                  <p className="text-xs text-neutral-400">
                    {f.marca}
                    {f.codigo ? ` · ${f.codigo}` : ""}
                  </p>
                </div>
                <div className="sm:text-right tabular-nums">
                  <p className="text-lg font-bold text-neutral-900">
                    {pesos(f.lista)}
                    {f.oferta && <span className="ml-1.5 text-[11px] font-bold rounded-full px-1.5 py-0.5 bg-red-50 text-red-700 align-middle">-{f.oferta}%</span>}
                  </p>
                  {f.efectivo < f.lista && <p className="text-xs font-semibold text-emerald-700">{pesos(f.efectivo)} en efectivo</p>}
                </div>
                <div className="sm:text-right sm:min-w-[120px]">
                  {total <= 0 ? (
                    <span className="inline-block text-xs font-bold rounded-full px-2.5 py-1 bg-red-50 text-red-700">Sin stock</span>
                  ) : (
                    <span className={`inline-block text-xs font-bold rounded-full px-2.5 py-1 ${total <= 2 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                      Hay {total} {total === 1 ? "unidad" : "unidades"}
                    </span>
                  )}
                  {locales.length > 1 && total > 0 && (
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      {locales
                        .filter((l) => (f.stock[l.idLocal] ?? 0) !== 0)
                        .map((l) => `${l.nombre}: ${f.stock[l.idLocal]}`)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {resultados.length > MAXIMO && (
            <p className="text-xs text-neutral-400 text-center">Hay {resultados.length} resultados: escribí algo más para achicar la lista.</p>
          )}
        </div>
      )}
    </div>
  );
}
