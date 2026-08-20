"use client";

import { useState, useTransition } from "react";
import type { Local } from "@/lib/supabase";
import { createLocal, updateLocal } from "@/app/(app)/locales/actions";

export default function LocalFormModal({ local, onClose }: { local: Local | null; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isEditing = Boolean(local);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        if (local) {
          await updateLocal(local.id_local, formData);
        } else {
          await createLocal(formData);
        }
        onClose();
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
            {isEditing ? "Editar local" : "Nuevo local"}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <form action={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="nombre">
              Nombre *
            </label>
            <input
              id="nombre"
              name="nombre"
              defaultValue={local?.nombre}
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="direccion">
              Dirección
            </label>
            <input
              id="direccion"
              name="direccion"
              defaultValue={local?.direccion ?? ""}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="telefono">
              Teléfono
            </label>
            <input
              id="telefono"
              name="telefono"
              type="tel"
              defaultValue={local?.telefono ?? ""}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="estado">
              Estado
            </label>
            <select
              id="estado"
              name="estado"
              defaultValue={local?.estado ?? "ACTIVO"}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="ACTIVO">ACTIVO</option>
              <option value="INACTIVO">INACTIVO</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="observaciones">
              Observaciones
            </label>
            <textarea
              id="observaciones"
              name="observaciones"
              defaultValue={local?.observaciones ?? ""}
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
