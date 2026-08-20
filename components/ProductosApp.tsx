"use client";

import { useMemo, useState, useTransition } from "react";
import type { Producto, Marca, Subcategoria } from "@/lib/supabase";
import { deleteProducto } from "@/app/(app)/productos/actions";
import ProductoFormModal from "@/components/ProductoFormModal";

export default function ProductosApp({
  initialProductos,
  marcas,
  subcategorias,
}: {
  initialProductos: Producto[];
  marcas: Marca[];
  subcategorias: Subcategoria[];
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
      return [p.nombre, p.sku, p.codigo_barras].filter(Boolean).some((f) => f!.toLowerCase().includes(q));
    });
  }, [initialProductos, search, idMarcaFiltro]);

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(producto: Producto) {
    setEditing(producto);
    setModalOpen(true);
  }

  function handleDelete(producto: Producto) {
    if (!confirm(`¿Borrar "${producto.nombre}"? Esto puede fallar si ya tiene ventas o stock cargado.`)) return;
    startTransition(() => deleteProducto(producto.id_producto));
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
        <ul className="space-y-2">
          {filtered.map((p) => (
            <li
              key={p.id_producto}
              className="bg-white border border-neutral-200 rounded-xl px-4 py-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-neutral-900">{p.nombre}</p>
                  <span className="text-xs bg-neutral-100 text-neutral-600 rounded-full px-2 py-0.5">
                    {marcaPorId.get(p.id_marca)?.nombre ?? "—"}
                  </span>
                  <span
                    className={`text-xs rounded-full px-2 py-0.5 ${
                      p.estado === "ACTIVO"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {p.estado}
                  </span>
                </div>
                <div className="text-sm text-neutral-500 flex flex-wrap gap-x-3">
                  {p.sku && <span>SKU {p.sku}</span>}
                  {p.precio_venta !== null && <span>${p.precio_venta}</span>}
                  <span>Stock mín. {p.stock_minimo}</span>
                </div>
              </div>
              <div className="flex gap-3 shrink-0">
                <button
                  onClick={() => openEdit(p)}
                  className="text-sm text-neutral-500 hover:text-neutral-900"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(p)}
                  disabled={isPending}
                  className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  Borrar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {modalOpen && (
        <ProductoFormModal
          producto={editing}
          marcas={marcas}
          subcategorias={subcategorias}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
