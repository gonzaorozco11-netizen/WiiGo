"use client";

import { useState, useTransition } from "react";
import type { Objetivo, FiltroProducto } from "@/lib/supabase";
import { deleteObjetivo, deleteFiltro } from "@/app/(app)/catalogo-asesor/actions";
import ObjetivoFormModal from "@/components/ObjetivoFormModal";
import FiltroFormModal from "@/components/FiltroFormModal";

export default function CatalogoAsesorApp({
  initialObjetivos,
  initialFiltros,
}: {
  initialObjetivos: Objetivo[];
  initialFiltros: FiltroProducto[];
}) {
  const [isPending, startTransition] = useTransition();
  const [objModalOpen, setObjModalOpen] = useState(false);
  const [editingObj, setEditingObj] = useState<Objetivo | null>(null);
  const [filtroModalOpen, setFiltroModalOpen] = useState(false);
  const [editingFiltro, setEditingFiltro] = useState<FiltroProducto | null>(null);

  function handleDeleteObj(o: Objetivo) {
    if (!confirm(`¿Borrar el objetivo "${o.nombre}"?`)) return;
    startTransition(async () => {
      try {
        const res = await deleteObjetivo(o.id_objetivo);
        if (res.error) alert(res.error);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  function handleDeleteFiltro(f: FiltroProducto) {
    if (!confirm(`¿Borrar el filtro "${f.nombre}"?`)) return;
    startTransition(async () => {
      try {
        const res = await deleteFiltro(f.id_filtro);
        if (res.error) alert(res.error);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-neutral-900">Catálogo asesor</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Objetivos y filtros que después vas a poder asignarle a cada producto, para que se
          muestren en las pantallas de autoservicio.
        </p>
      </div>

      {/* Objetivos */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-neutral-900">🎯 Objetivos</h2>
          <button
            onClick={() => {
              setEditingObj(null);
              setObjModalOpen(true);
            }}
            className="rounded-lg bg-accent hover:bg-accent-dark text-white px-3 py-1.5 text-sm font-medium"
          >
            + Nuevo objetivo
          </button>
        </div>

        {initialObjetivos.length === 0 ? (
          <p className="text-sm text-neutral-500 py-6 text-center bg-white border border-neutral-200 rounded-xl">
            No hay objetivos cargados todavía.
          </p>
        ) : (
          <ul className="space-y-2">
            {initialObjetivos.map((o) => (
              <li
                key={o.id_objetivo}
                className="bg-white border border-neutral-200 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-900">{o.nombre}</span>
                  <span
                    className={`text-xs rounded-full px-2 py-0.5 ${
                      o.estado === "ACTIVO"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {o.estado}
                  </span>
                </div>
                <div className="flex gap-3 shrink-0">
                  <button
                    onClick={() => {
                      setEditingObj(o);
                      setObjModalOpen(true);
                    }}
                    className="text-sm text-neutral-500 hover:text-neutral-900"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDeleteObj(o)}
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
      </section>

      {/* Filtros */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-neutral-900">⚡ Filtros rápidos</h2>
          <button
            onClick={() => {
              setEditingFiltro(null);
              setFiltroModalOpen(true);
            }}
            className="rounded-lg bg-accent hover:bg-accent-dark text-white px-3 py-1.5 text-sm font-medium"
          >
            + Nuevo filtro
          </button>
        </div>

        {initialFiltros.length === 0 ? (
          <p className="text-sm text-neutral-500 py-6 text-center bg-white border border-neutral-200 rounded-xl">
            No hay filtros cargados todavía.
          </p>
        ) : (
          <ul className="space-y-2">
            {initialFiltros.map((f) => (
              <li
                key={f.id_filtro}
                className="bg-white border border-neutral-200 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-neutral-900">{f.nombre}</span>
                  {f.tipo && (
                    <span className="text-xs bg-neutral-100 text-neutral-600 rounded-full px-2 py-0.5">
                      {f.tipo}
                    </span>
                  )}
                  <span
                    className={`text-xs rounded-full px-2 py-0.5 ${
                      f.estado === "ACTIVO"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {f.estado}
                  </span>
                </div>
                <div className="flex gap-3 shrink-0">
                  <button
                    onClick={() => {
                      setEditingFiltro(f);
                      setFiltroModalOpen(true);
                    }}
                    className="text-sm text-neutral-500 hover:text-neutral-900"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDeleteFiltro(f)}
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
      </section>

      {objModalOpen && <ObjetivoFormModal objetivo={editingObj} onClose={() => setObjModalOpen(false)} />}
      {filtroModalOpen && (
        <FiltroFormModal filtro={editingFiltro} onClose={() => setFiltroModalOpen(false)} />
      )}
    </div>
  );
}
