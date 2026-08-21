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
} from "@/lib/supabase";
import { deleteProducto } from "@/app/(app)/productos/actions";
import ProductoFormModal from "@/components/ProductoFormModal";

export default function ProductosApp({
  initialProductos,
  marcas,
  subcategorias,
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
        await deleteProducto(producto.id_producto);
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
                  {p.descuento_porcentaje !== null && p.descuento_porcentaje > 0 && (
                    <span className="text-xs bg-amber-50 text-amber-700 rounded-full px-2 py-0.5 font-medium">
                      -{p.descuento_porcentaje}%
                    </span>
                  )}
                  {marcaPorId.get(p.id_marca)?.tipo_comercializacion === "PROPIA" && (
                    <span className="text-xs bg-accent-tint text-accent-dark rounded-full px-2 py-0.5 font-medium">
                      Propia
                    </span>
                  )}
                </div>
                <div className="text-sm text-neutral-500 flex flex-wrap gap-x-3">
                  {p.precio_venta !== null && <span>${p.precio_venta}</span>}
                  <span>
                    {(variantesPorProducto[p.id_producto] ?? []).length}{" "}
                    {(variantesPorProducto[p.id_producto] ?? []).length === 1 ? "variante" : "variantes"}
                  </span>
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
