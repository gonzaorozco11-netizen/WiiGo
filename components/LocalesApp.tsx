"use client";

import { useMemo, useState, useTransition } from "react";
import type { Local } from "@/lib/supabase";
import { deleteLocal } from "@/app/(app)/locales/actions";
import LocalFormModal from "@/components/LocalFormModal";

export default function LocalesApp({ initialLocales }: { initialLocales: Local[] }) {
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Local | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return initialLocales;
    return initialLocales.filter((l) => l.nombre.toLowerCase().includes(q));
  }, [initialLocales, search]);

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(local: Local) {
    setEditing(local);
    setModalOpen(true);
  }

  function handleDelete(local: Local) {
    if (!confirm(`¿Borrar el local "${local.nombre}"?`)) return;
    startTransition(async () => {
      try {
        const res = await deleteLocal(local.id_local);
        if (res.error) alert(res.error);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-neutral-900">Locales</h1>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="search"
          placeholder="Buscar local..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          onClick={openNew}
          className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium whitespace-nowrap"
        >
          + Nuevo local
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500 py-12 text-center">
          {initialLocales.length === 0
            ? "Todavía no cargaste ningún local."
            : "No hay locales que coincidan con la búsqueda."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((l) => (
            <li
              key={l.id_local}
              className="bg-white border border-neutral-200 rounded-xl px-4 py-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-neutral-900">{l.nombre}</p>
                  <span
                    className={`text-xs rounded-full px-2 py-0.5 ${
                      l.estado === "ACTIVO"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {l.estado}
                  </span>
                </div>
                <div className="text-sm text-neutral-500 flex flex-wrap gap-x-3">
                  {l.direccion && <span>{l.direccion}</span>}
                  {l.telefono && <span>{l.telefono}</span>}
                </div>
              </div>
              <div className="flex gap-3 shrink-0">
                <button
                  onClick={() => openEdit(l)}
                  className="text-sm text-neutral-500 hover:text-neutral-900"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(l)}
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

      {modalOpen && <LocalFormModal local={editing} onClose={() => setModalOpen(false)} />}
    </div>
  );
}
