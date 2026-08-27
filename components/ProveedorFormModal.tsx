"use client";

import { useState, useTransition } from "react";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import { crearProveedor, actualizarProveedor } from "@/app/(app)/proveedores/actions";

export default function ProveedorFormModal({
  proveedor,
  onClose,
}: {
  proveedor: ProveedorConSaldo | null;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isEditing = Boolean(proveedor);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const res = proveedor ? await actualizarProveedor(proveedor.id_proveedor, formData) : await crearProveedor(formData);
        if (res.error) setError(res.error);
        else onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">
            {isEditing ? "Editar proveedor" : "Nuevo proveedor"}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <form action={handleSubmit} className="space-y-3">
          <Field label="Nombre *" name="nombre" defaultValue={proveedor?.nombre} required />
          <Field label="CUIT" name="cuit" defaultValue={proveedor?.cuit ?? ""} />
          <Field label="Contacto" name="contacto" defaultValue={proveedor?.contacto ?? ""} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Teléfono" name="telefono" defaultValue={proveedor?.telefono ?? ""} />
            <Field label="Condición de pago (días)" name="condicion_pago_dias" type="number" defaultValue={proveedor?.condicion_pago_dias ?? ""} />
          </div>
          <Field label="Email" name="email" type="email" defaultValue={proveedor?.email ?? ""} />
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="modo_facturacion">
              Cómo factura
            </label>
            <select
              id="modo_facturacion"
              name="modo_facturacion"
              defaultValue={proveedor?.modo_facturacion ?? "REMITO"}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="REMITO">Por orden puntual (factura cada entrega)</option>
              <option value="PERIODO">Por período (factura mensual consolidada)</option>
              <option value="LIQUIDACION_VENTA">Liquidación por venta (se le paga el costo de lo vendido)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Observaciones</label>
            <textarea
              name="observaciones"
              defaultValue={proveedor?.observaciones ?? ""}
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
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
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
        defaultValue={defaultValue ?? ""}
        required={required}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
  );
}
