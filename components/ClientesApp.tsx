"use client";

import { useMemo, useState, useTransition } from "react";
import type { Cliente } from "@/lib/supabase";
import { deleteCliente } from "@/app/(app)/clientes/actions";
import ClienteFormModal from "@/components/ClienteFormModal";

export default function ClientesApp({ initialClientes }: { initialClientes: Cliente[] }) {
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Cliente | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return initialClientes;
    return initialClientes.filter((c) =>
      [c.nombre, c.apellido, c.dni, c.email, c.telefono].filter(Boolean).some((v) => v!.toLowerCase().includes(q))
    );
  }, [initialClientes, search]);

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(cliente: Cliente) {
    setEditing(cliente);
    setModalOpen(true);
  }

  function handleDelete(cliente: Cliente) {
    if (!confirm(`¿Borrar a "${cliente.nombre}"?`)) return;
    startTransition(async () => {
      try {
        const res = await deleteCliente(cliente.id_cliente);
        if (res.error) alert(res.error);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-neutral-900">Clientes</h1>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="search"
          placeholder="Buscar por nombre, DNI, email o teléfono..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          onClick={openNew}
          className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium whitespace-nowrap"
        >
          + Nuevo cliente
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500 py-12 text-center">
          {initialClientes.length === 0
            ? "Todavía no hay clientes cargados."
            : "No hay clientes que coincidan con la búsqueda."}
        </p>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="p-3">Nombre</th>
                <th className="p-3">DNI</th>
                <th className="p-3">Contacto</th>
                <th className="p-3">WiiGo Points</th>
                <th className="p-3">Estado</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id_cliente} className="border-b border-neutral-100 last:border-0">
                  <td className="p-3 font-medium text-neutral-900">
                    {c.nombre} {c.apellido ?? ""}
                  </td>
                  <td className="p-3 text-neutral-500">{c.dni ?? "—"}</td>
                  <td className="p-3 text-neutral-500">
                    <div className="flex flex-col">
                      {c.email && <span>{c.email}</span>}
                      {c.telefono && <span>{c.telefono}</span>}
                      {!c.email && !c.telefono && "—"}
                    </div>
                  </td>
                  <td className="p-3 font-semibold text-neutral-900">{c.puntos}</td>
                  <td className="p-3">
                    <span
                      className={`text-xs rounded-full px-2 py-0.5 ${
                        c.estado === "ACTIVO" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {c.estado}
                    </span>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(c)} className="text-sm text-accent hover:underline mr-3">
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(c)}
                      disabled={isPending}
                      className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && <ClienteFormModal cliente={editing} onClose={() => setModalOpen(false)} />}
    </div>
  );
}
