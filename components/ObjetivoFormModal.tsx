"use client";

import { useState, useTransition } from "react";
import type { Objetivo } from "@/lib/supabase";
import { createObjetivo, updateObjetivo } from "@/app/(app)/catalogo-asesor/actions";

export default function ObjetivoFormModal({
  objetivo,
  onClose,
}: {
  objetivo: Objetivo | null;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isEditing = Boolean(objetivo);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const res = objetivo ? await updateObjetivo(objetivo.id_objetivo, formData) : await createObjetivo(formData);
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
            {isEditing ? "Editar objetivo" : "Nuevo objetivo"}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <form action={handleSubmit} className="space-y-3">
          <Field label="Nombre *" name="nombre" defaultValue={objetivo?.nombre} required />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre (inglés)" name="nombre_en" defaultValue={objetivo?.nombre_en ?? ""} />
            <Field label="Nombre (portugués)" name="nombre_pt" defaultValue={objetivo?.nombre_pt ?? ""} />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción</label>
            <textarea
              name="descripcion"
              defaultValue={objetivo?.descripcion ?? ""}
              rows={2}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <Field label="Imagen (URL)" name="imagen" defaultValue={objetivo?.imagen ?? ""} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Orden" name="orden" defaultValue={objetivo?.orden ?? ""} type="number" />
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="estado">
                Estado
              </label>
              <select
                id="estado"
                name="estado"
                defaultValue={objetivo?.estado ?? "ACTIVO"}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="ACTIVO">ACTIVO</option>
                <option value="INACTIVO">INACTIVO</option>
              </select>
            </div>
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
