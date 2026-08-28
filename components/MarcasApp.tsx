"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { Marca } from "@/lib/supabase";
import { deleteMarca } from "@/app/(app)/marcas/actions";
import MarcaFormModal from "@/components/MarcaFormModal";

export default function MarcasApp({ initialMarcas, esAdmin }: { initialMarcas: Marca[]; esAdmin: boolean }) {
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Marca | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return initialMarcas;
    return initialMarcas.filter((m) =>
      [m.nombre, m.cuit, m.contacto, m.email].filter(Boolean).some((f) => f!.toLowerCase().includes(q))
    );
  }, [initialMarcas, search]);

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(marca: Marca) {
    setEditing(marca);
    setModalOpen(true);
  }

  function handleDelete(marca: Marca) {
    if (!confirm(`¿Borrar la marca "${marca.nombre}"?`)) return;
    startTransition(async () => {
      try {
        const res = await deleteMarca(marca.id_marca);
        if (res.error) alert(res.error);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-neutral-900">Marcas</h1>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="search"
          placeholder="Buscar por nombre, CUIT, contacto..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {esAdmin && (
          <button
            onClick={openNew}
            className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium whitespace-nowrap"
          >
            + Nueva marca
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500 py-12 text-center">
          {initialMarcas.length === 0
            ? "Todavía no cargaste ninguna marca."
            : "No hay marcas que coincidan con la búsqueda."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((m) => (
            <li
              key={m.id_marca}
              className="bg-white border border-neutral-200 rounded-xl px-4 py-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-neutral-900">{m.nombre}</p>
                  <span
                    className={`text-xs rounded-full px-2 py-0.5 ${
                      m.estado === "ACTIVA"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {m.estado}
                  </span>
                </div>
                <div className="text-sm text-neutral-500 flex flex-wrap gap-x-3">
                  {m.cuit && <span>CUIT {m.cuit}</span>}
                  {m.contacto && <span>{m.contacto}</span>}
                  {m.email && <span>{m.email}</span>}
                  {m.royalty_porcentaje !== null && <span>Royalty {m.royalty_porcentaje}%</span>}
                </div>
              </div>
              <div className="flex gap-3 shrink-0">
                <Link
                  href={`/marcas/${m.id_marca}`}
                  className="text-sm text-neutral-500 hover:text-neutral-900"
                >
                  Ver
                </Link>
                {esAdmin && (
                  <button
                    onClick={() => openEdit(m)}
                    className="text-sm text-neutral-500 hover:text-neutral-900"
                  >
                    Editar
                  </button>
                )}
                {esAdmin && (
                  <button
                    onClick={() => handleDelete(m)}
                    disabled={isPending}
                    className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    Borrar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {modalOpen && <MarcaFormModal marca={editing} onClose={() => setModalOpen(false)} />}
    </div>
  );
}
