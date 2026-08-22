"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  Producto,
  Marca,
  Subcategoria,
  FichaProducto,
  Objetivo,
  FiltroProducto,
  VarianteProducto,
  Local,
} from "@/lib/supabase";
import { deleteProducto } from "@/app/(app)/productos/actions";
import ProductoFormModal from "@/components/ProductoFormModal";

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

export default function ProductosApp({
  initialProductos,
  marcas,
  subcategorias,
  locales,
  margenMinimo,
  stockPorVariante,
  stockOptimoPorVariante,
  diasCobertura,
  objetivosGlobales,
  filtrosGlobales,
  fichaPorProducto,
  objetivosPorProducto,
  filtrosPorProducto,
  variantesPorProducto,
}: {
  initialProductos: Producto[];
  marcas: Marca[];
  subcategorias: Subcategoria[];
  locales: Local[];
  margenMinimo: number;
  stockPorVariante: Record<string, number>;
  stockOptimoPorVariante: Record<string, number>;
  diasCobertura: number;
  objetivosGlobales: Objetivo[];
  filtrosGlobales: FiltroProducto[];
  fichaPorProducto: Record<string, FichaProducto>;
  objetivosPorProducto: Record<string, string[]>;
  filtrosPorProducto: Record<string, string[]>;
  variantesPorProducto: Record<string, VarianteProducto[]>;
}) {
  const [search, setSearch] = useState("");
  const [idMarcaFiltro, setIdMarcaFiltro] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Producto | null>(null);
  const [isPending, startTransition] = useTransition();

  const marcaPorId = useMemo(() => new Map(marcas.map((m) => [m.id_marca, m])), [marcas]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialProductos.filter((p) => {
      if (idMarcaFiltro && p.id_marca !== idMarcaFiltro) return false;
      if (!q) return true;
      const variantes = variantesPorProducto[p.id_producto] ?? [];
      return [p.nombre, ...variantes.map((v) => v.sku), ...variantes.map((v) => v.codigo_barras)]
        .filter(Boolean)
        .some((f) => f!.toLowerCase().includes(q));
    });
  }, [initialProductos, search, idMarcaFiltro, variantesPorProducto]);

  // Un producto puede tener varias variantes (sabores, tamaños) y cada una
  // vive en varios locales — acá se suma todo para dar un vistazo rápido
  // por producto. El detalle por variante/local sigue estando en /stock.
  const resumenPorProducto = useMemo(() => {
    const mapa: Record<string, { stock: number; minimo: number; objetivo: number; optimo: number }> = {};
    for (const p of initialProductos) {
      const variantes = variantesPorProducto[p.id_producto] ?? [];
      mapa[p.id_producto] = variantes.reduce(
        (acc, v) => ({
          stock: acc.stock + (stockPorVariante[v.id_variante] ?? 0),
          minimo: acc.minimo + (v.stock_minimo ?? 0),
          objetivo: acc.objetivo + (v.stock_objetivo ?? 0),
          optimo: acc.optimo + (stockOptimoPorVariante[v.id_variante] ?? 0),
        }),
        { stock: 0, minimo: 0, objetivo: 0, optimo: 0 }
      );
    }
    return mapa;
  }, [initialProductos, variantesPorProducto, stockPorVariante, stockOptimoPorVariante]);

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(producto: Producto) {
    setEditing(producto);
    setModalOpen(true);
  }

  function handleDelete(producto: Producto) {
    if (!confirm(`¿Borrar "${producto.nombre}"?`)) return;
    startTransition(async () => {
      try {
        const res = await deleteProducto(producto.id_producto);
        if (res.error) alert(res.error);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-neutral-900">Productos</h1>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="search"
          placeholder="Buscar por nombre, SKU o código de barras..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <select
          value={idMarcaFiltro ?? ""}
          onChange={(e) => setIdMarcaFiltro(e.target.value || null)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">Todas las marcas</option>
          {marcas.map((m) => (
            <option key={m.id_marca} value={m.id_marca}>
              {m.nombre}
            </option>
          ))}
        </select>
        <button
          onClick={openNew}
          className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium whitespace-nowrap"
        >
          + Nuevo producto
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500 py-12 text-center">
          {initialProductos.length === 0
            ? "Todavía no cargaste ningún producto."
            : "No hay productos que coincidan con la búsqueda."}
        </p>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Producto</th>
                  <th className="p-3 text-right">Costo</th>
                  <th className="p-3 text-right">Precio</th>
                  <th className="p-3 text-right">Stock</th>
                  <th className="p-3 text-right">Mín.</th>
                  <th className="p-3 text-right">Obj.</th>
                  <th className="p-3 text-right">
                    Óptimo
                    <span className="block font-normal normal-case text-[10px] text-neutral-400">
                      ({diasCobertura} días de venta)
                    </span>
                  </th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const resumen = resumenPorProducto[p.id_producto] ?? { stock: 0, minimo: 0, objetivo: 0, optimo: 0 };
                  const tieneDescuento = (p.descuento_porcentaje ?? 0) > 0;
                  const precioConDescuento = tieneDescuento
                    ? Math.round((p.precio_venta ?? 0) * (1 - (p.descuento_porcentaje ?? 0) / 100))
                    : null;
                  const stockBajo = resumen.stock <= resumen.minimo && resumen.minimo > 0;

                  return (
                    <tr key={p.id_producto} className="border-b border-neutral-100 last:border-0 align-top">
                      <td className="p-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-neutral-900">{p.nombre}</p>
                          <span className="text-xs bg-neutral-100 text-neutral-600 rounded-full px-2 py-0.5">
                            {marcaPorId.get(p.id_marca)?.nombre ?? "—"}
                          </span>
                          <span
                            className={`text-xs rounded-full px-2 py-0.5 ${
                              p.estado === "ACTIVO" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"
                            }`}
                          >
                            {p.estado}
                          </span>
                          {marcaPorId.get(p.id_marca)?.tipo_comercializacion === "PROPIA" && (
                            <span className="text-xs bg-accent-tint text-accent-dark rounded-full px-2 py-0.5 font-medium">
                              Marca Propia
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-400 mt-0.5">
                          {(variantesPorProducto[p.id_producto] ?? []).length}{" "}
                          {(variantesPorProducto[p.id_producto] ?? []).length === 1 ? "variante" : "variantes"}
                        </p>
                      </td>
                      <td className="p-3 text-right tabular-nums text-neutral-500">
                        {p.costo_informado !== null ? `$${formatearMonto(p.costo_informado)}` : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {p.precio_venta !== null ? (
                          tieneDescuento ? (
                            <div>
                              <span className="line-through text-neutral-400 text-xs">
                                ${formatearMonto(p.precio_venta)}
                              </span>
                              <div className="font-semibold text-amber-700">
                                ${formatearMonto(precioConDescuento ?? 0)}
                                <span className="text-xs font-normal ml-1">(-{p.descuento_porcentaje}%)</span>
                              </div>
                            </div>
                          ) : (
                            <span>${formatearMonto(p.precio_venta)}</span>
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`p-3 text-right tabular-nums font-semibold ${stockBajo ? "text-red-600" : "text-neutral-900"}`}>
                        {resumen.stock}
                      </td>
                      <td className="p-3 text-right tabular-nums text-neutral-500">{resumen.minimo}</td>
                      <td className="p-3 text-right tabular-nums text-neutral-500">{resumen.objetivo}</td>
                      <td className="p-3 text-right tabular-nums text-accent font-medium">
                        {resumen.optimo > 0 ? resumen.optimo : "—"}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(p)} className="text-sm text-neutral-500 hover:text-neutral-900 mr-3">
                          Editar
                        </button>
                        <button
                          onClick={() => handleDelete(p)}
                          disabled={isPending}
                          className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                        >
                          Borrar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalOpen && (
        <ProductoFormModal
          producto={editing}
          marcas={marcas}
          subcategorias={subcategorias}
          locales={locales}
          margenMinimo={margenMinimo}
          objetivosGlobales={objetivosGlobales}
          filtrosGlobales={filtrosGlobales}
          ficha={editing ? fichaPorProducto[editing.id_producto] ?? null : null}
          objetivosAsignados={editing ? objetivosPorProducto[editing.id_producto] ?? [] : []}
          filtrosAsignados={editing ? filtrosPorProducto[editing.id_producto] ?? [] : []}
          variantesIniciales={editing ? variantesPorProducto[editing.id_producto] ?? [] : []}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
