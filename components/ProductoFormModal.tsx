"use client";

import { useMemo, useState, useTransition } from "react";
import type { Producto, Marca, Subcategoria } from "@/lib/supabase";
import { createProducto, updateProducto } from "@/app/(app)/productos/actions";

export default function ProductoFormModal({
  producto,
  marcas,
  subcategorias,
  onClose,
}: {
  producto: Producto | null;
  marcas: Marca[];
  subcategorias: Subcategoria[];
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [idMarca, setIdMarca] = useState(producto?.id_marca ?? marcas[0]?.id_marca ?? "");
  const [nuevaSubcategoria, setNuevaSubcategoria] = useState(false);
  const isEditing = Boolean(producto);

  const subcategoriasDeMarca = useMemo(
    () => subcategorias.filter((s) => s.id_marca === idMarca),
    [subcategorias, idMarca]
  );

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        if (producto) {
          await updateProducto(producto.id_producto, formData);
        } else {
          await createProducto(formData);
        }
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
          <h2 className="text-lg font-semibold text-neutral-900">
            {isEditing ? "Editar producto" : "Nuevo producto"}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <form action={handleSubmit} className="space-y-3">
          <Field label="Nombre *" name="nombre" defaultValue={producto?.nombre} required />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="id_marca">
                Marca *
              </label>
              <select
                id="id_marca"
                name="id_marca"
                value={idMarca}
                onChange={(e) => setIdMarca(e.target.value)}
                required
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
              <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="id_subcategoria">
                Subcategoría
              </label>
              {!nuevaSubcategoria ? (
                <select
                  id="id_subcategoria"
                  name="id_subcategoria"
                  defaultValue={producto?.id_subcategoria ?? ""}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">Sin subcategoría</option>
                  {subcategoriasDeMarca.map((s) => (
                    <option key={s.id_subcategoria} value={s.id_subcategoria}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name="nueva_subcategoria"
                  placeholder="Nombre de la subcategoría"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              )}
              <button
                type="button"
                onClick={() => setNuevaSubcategoria((v) => !v)}
                className="text-xs text-accent mt-1"
              >
                {nuevaSubcategoria ? "Elegir una existente" : "+ Crear subcategoría nueva"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU" name="sku" defaultValue={producto?.sku ?? ""} />
            <Field label="Código de barras" name="codigo_barras" defaultValue={producto?.codigo_barras ?? ""} />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción</label>
            <textarea
              name="descripcion"
              defaultValue={producto?.descripcion ?? ""}
              rows={2}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Costo"
              name="costo_informado"
              defaultValue={producto?.costo_informado ?? ""}
              type="number"
              step="0.01"
            />
            <Field
              label="Precio de venta"
              name="precio_venta"
              defaultValue={producto?.precio_venta ?? ""}
              type="number"
              step="0.01"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field
              label="Stock mínimo"
              name="stock_minimo"
              defaultValue={producto?.stock_minimo ?? 0}
              type="number"
            />
            <Field
              label="Stock objetivo"
              name="stock_objetivo"
              defaultValue={producto?.stock_objetivo ?? 0}
              type="number"
            />
            <Field label="Puntos" name="puntos" defaultValue={producto?.puntos ?? 0} type="number" />
          </div>

          <Field label="Imagen (URL)" name="imagen" defaultValue={producto?.imagen ?? ""} />

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="estado">
              Estado
            </label>
            <select
              id="estado"
              name="estado"
              defaultValue={producto?.estado ?? "ACTIVO"}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="ACTIVO">ACTIVO</option>
              <option value="INACTIVO">INACTIVO</option>
            </select>
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
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required = false,
  step,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
  );
}
