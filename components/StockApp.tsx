"use client";

import { useMemo, useState } from "react";
import type { Local, Producto, Marca, VarianteProducto, Stock, MovimientoStock } from "@/lib/supabase";
import AjusteStockModal from "@/components/AjusteStockModal";
import TransferenciaStockModal from "@/components/TransferenciaStockModal";

type Fila = {
  variante: VarianteProducto;
  producto: Producto;
  marca: Marca | undefined;
};

const TIPO_LABEL: Record<string, string> = {
  AJUSTE: "Ajuste manual",
  TRANSFERENCIA_SALIDA: "Transferencia (salida)",
  TRANSFERENCIA_ENTRADA: "Transferencia (entrada)",
  RECEPCION: "Recepción de mercadería",
};

export default function StockApp({
  locales,
  variantes,
  productos,
  marcas,
  stock,
  movimientos,
}: {
  locales: Local[];
  variantes: VarianteProducto[];
  productos: Producto[];
  marcas: Marca[];
  stock: Stock[];
  movimientos: MovimientoStock[];
}) {
  const [idLocal, setIdLocal] = useState(locales[0]?.id_local ?? "");
  const [search, setSearch] = useState("");
  const [ajuste, setAjuste] = useState<Fila | null>(null);
  const [transferenciaOpen, setTransferenciaOpen] = useState(false);
  const [historialAbierto, setHistorialAbierto] = useState(false);

  const productoPorId = useMemo(() => new Map(productos.map((p) => [p.id_producto, p])), [productos]);
  const marcaPorId = useMemo(() => new Map(marcas.map((m) => [m.id_marca, m])), [marcas]);

  const cantidadPorClave = useMemo(() => {
    const map = new Map<string, number>();
    stock.forEach((s) => map.set(`${s.id_variante}_${s.id_local}`, s.cantidad));
    return map;
  }, [stock]);

  const filas = useMemo<Fila[]>(() => {
    return variantes
      .map((variante) => {
        const producto = productoPorId.get(variante.id_producto);
        if (!producto) return null;
        return { variante, producto, marca: marcaPorId.get(producto.id_marca) };
      })
      .filter((f): f is Fila => f !== null)
      .sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre));
  }, [variantes, productoPorId, marcaPorId]);

  const filtradas = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filas;
    return filas.filter((f) =>
      [f.producto.nombre, f.variante.nombre, f.marca?.nombre, f.variante.sku]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    );
  }, [filas, search]);

  const nombrePorVariante = useMemo(() => {
    const map = new Map<string, string>();
    filas.forEach((f) => {
      map.set(
        f.variante.id_variante,
        `${f.producto.nombre}${f.variante.nombre !== "Único" ? ` — ${f.variante.nombre}` : ""}`
      );
    });
    return map;
  }, [filas]);

  const movimientosDelLocal = useMemo(
    () => movimientos.filter((m) => m.id_local === idLocal),
    [movimientos, idLocal]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-neutral-900">Stock</h1>
        <button
          onClick={() => setTransferenciaOpen(true)}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700"
        >
          Transferir entre locales
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="search"
          placeholder="Buscar producto, variante, marca o SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <select
          value={idLocal}
          onChange={(e) => setIdLocal(e.target.value)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {locales.map((l) => (
            <option key={l.id_local} value={l.id_local}>
              {l.nombre}
            </option>
          ))}
        </select>
      </div>

      {filtradas.length === 0 ? (
        <p className="text-sm text-neutral-500 py-12 text-center">
          {variantes.length === 0
            ? "Todavía no hay productos cargados."
            : "No hay resultados para la búsqueda."}
        </p>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="p-3">Producto</th>
                <th className="p-3">Marca</th>
                <th className="p-3">SKU</th>
                <th className="p-3">Cantidad</th>
                <th className="p-3">Mínimo</th>
                <th className="p-3">Objetivo</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((f) => {
                const cantidad = cantidadPorClave.get(`${f.variante.id_variante}_${idLocal}`) ?? 0;
                const bajoMinimo = cantidad < f.variante.stock_minimo;
                return (
                  <tr key={f.variante.id_variante} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3">
                      <span className="font-medium text-neutral-900">{f.producto.nombre}</span>
                      {f.variante.nombre !== "Único" && (
                        <span className="ml-2 text-xs bg-neutral-100 text-neutral-600 rounded-full px-2 py-0.5">
                          {f.variante.nombre}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-neutral-500">{f.marca?.nombre ?? "—"}</td>
                    <td className="p-3 font-mono text-xs text-neutral-500">{f.variante.sku ?? "—"}</td>
                    <td className="p-3">
                      <span
                        className={`font-semibold ${bajoMinimo ? "text-red-600" : "text-neutral-900"}`}
                      >
                        {cantidad}
                      </span>
                      {bajoMinimo && (
                        <span className="ml-2 text-xs bg-red-50 text-red-700 rounded-full px-2 py-0.5">
                          bajo mínimo
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-neutral-500">{f.variante.stock_minimo}</td>
                    <td className="p-3 text-neutral-500">{f.variante.stock_objetivo}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => setAjuste(f)}
                        className="text-sm text-accent hover:underline"
                      >
                        Ajustar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6">
        <button
          onClick={() => setHistorialAbierto((v) => !v)}
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          {historialAbierto ? "Ocultar" : "Ver"} historial de movimientos de este local ▾
        </button>

        {historialAbierto && (
          <div className="bg-white border border-neutral-200 rounded-xl overflow-x-auto mt-3">
            {movimientosDelLocal.length === 0 ? (
              <p className="text-sm text-neutral-500 p-4 text-center">
                Todavía no hay movimientos registrados en este local.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="p-3">Fecha</th>
                    <th className="p-3">Producto</th>
                    <th className="p-3">Tipo</th>
                    <th className="p-3">Cantidad</th>
                    <th className="p-3">Motivo</th>
                    <th className="p-3">Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientosDelLocal.map((m) => (
                    <tr key={m.id_movimiento} className="border-b border-neutral-100 last:border-0">
                      <td className="p-3 text-neutral-500 whitespace-nowrap">
                        {new Date(m.fecha).toLocaleString("es-AR")}
                      </td>
                      <td className="p-3 text-neutral-900">
                        {nombrePorVariante.get(m.id_variante) ?? "—"}
                      </td>
                      <td className="p-3 text-neutral-500">{TIPO_LABEL[m.tipo] ?? m.tipo}</td>
                      <td className={`p-3 font-semibold ${m.cantidad < 0 ? "text-red-600" : "text-emerald-700"}`}>
                        {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                      </td>
                      <td className="p-3 text-neutral-500">{m.motivo ?? "—"}</td>
                      <td className="p-3 text-neutral-500">{m.usuario ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {ajuste && (
        <AjusteStockModal
          nombre={`${ajuste.producto.nombre}${ajuste.variante.nombre !== "Único" ? ` — ${ajuste.variante.nombre}` : ""}`}
          idVariante={ajuste.variante.id_variante}
          idLocal={idLocal}
          cantidadActual={cantidadPorClave.get(`${ajuste.variante.id_variante}_${idLocal}`) ?? 0}
          onClose={() => setAjuste(null)}
        />
      )}

      {transferenciaOpen && (
        <TransferenciaStockModal
          locales={locales}
          filas={filas}
          cantidadPorClave={cantidadPorClave}
          onClose={() => setTransferenciaOpen(false)}
        />
      )}
    </div>
  );
}
