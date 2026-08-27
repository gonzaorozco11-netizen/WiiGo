"use client";

import { useMemo, useState } from "react";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import { cambiarEstadoProveedor } from "@/app/(app)/proveedores/actions";
import ProveedorFormModal from "./ProveedorFormModal";

type FiltroEstado = "TODOS" | "CON_DEUDA" | "AL_DIA";
type Orden = "SALDO_DESC" | "NOMBRE";

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

export default function ProveedoresApp({ proveedores, esAdmin }: { proveedores: ProveedorConSaldo[]; esAdmin: boolean }) {
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("TODOS");
  const [orden, setOrden] = useState<Orden>("SALDO_DESC");
  const [idSeleccionado, setIdSeleccionado] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState<"NUEVO" | "EDITAR" | null>(null);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    let lista = proveedores.filter((p) => {
      if (q && !p.nombre.toLowerCase().includes(q) && !(p.cuit ?? "").toLowerCase().includes(q)) return false;
      if (filtroEstado === "CON_DEUDA" && p.saldo <= 0) return false;
      if (filtroEstado === "AL_DIA" && p.saldo > 0) return false;
      return true;
    });
    lista = [...lista].sort((a, b) => (orden === "SALDO_DESC" ? b.saldo - a.saldo : a.nombre.localeCompare(b.nombre)));
    return lista;
  }, [proveedores, busqueda, filtroEstado, orden]);

  const seleccionado = filtrados.find((p) => p.id_proveedor === idSeleccionado) ?? null;

  const deudaTotal = proveedores.reduce((acc, p) => acc + Math.max(p.saldo, 0), 0);
  const conDeuda = proveedores.filter((p) => p.saldo > 0).length;

  function handleCambiarEstado(p: ProveedorConSaldo) {
    const nuevo = p.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO";
    cambiarEstadoProveedor(p.id_proveedor, nuevo).catch(() => {});
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-neutral-900">Proveedores</h1>
        {esAdmin && (
          <button
            onClick={() => setModalAbierto("NUEVO")}
            className="bg-accent hover:bg-accent-dark text-white text-sm font-semibold px-3.5 py-2 rounded-lg"
          >
            + Nuevo proveedor
          </button>
        )}
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        {conDeuda} proveedor{conDeuda === 1 ? "" : "es"} con deuda · ${formatearMonto(deudaTotal)} en total
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o CUIT..."
          className="flex-1 min-w-[220px] border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
        />
        {(
          [
            ["TODOS", "Todos"],
            ["CON_DEUDA", "Con deuda"],
            ["AL_DIA", "Al día"],
          ] as [FiltroEstado, string][]
        ).map(([valor, label]) => (
          <button
            key={valor}
            onClick={() => setFiltroEstado(valor)}
            className={`text-sm font-semibold px-3 py-2 rounded-lg border ${
              filtroEstado === valor ? "bg-accent border-accent text-white" : "bg-white border-neutral-300 text-neutral-600"
            }`}
          >
            {label}
          </button>
        ))}
        <select
          value={orden}
          onChange={(e) => setOrden(e.target.value as Orden)}
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="SALDO_DESC">Ordenar: mayor deuda primero</option>
          <option value="NOMBRE">Nombre (A-Z)</option>
        </select>
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_340px] min-h-[380px]">
          <div className="overflow-x-auto">
            {filtrados.length === 0 ? (
              <p className="text-sm text-neutral-400 text-center py-16">No hay proveedores para estos filtros.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="p-3">Proveedor</th>
                    <th className="p-3">CUIT</th>
                    <th className="p-3">Cond. pago</th>
                    <th className="p-3 text-right">Saldo</th>
                    <th className="p-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((p) => (
                    <tr
                      key={p.id_proveedor}
                      onClick={() => setIdSeleccionado(p.id_proveedor)}
                      className={`border-b border-neutral-100 last:border-0 cursor-pointer ${
                        seleccionado?.id_proveedor === p.id_proveedor ? "bg-accent-tint" : "hover:bg-neutral-50"
                      }`}
                    >
                      <td className="p-3 font-medium text-neutral-900">
                        {p.nombre}
                        {p.estado === "INACTIVO" && <span className="ml-2 text-xs text-neutral-400">(inactivo)</span>}
                      </td>
                      <td className="p-3 text-neutral-500">{p.cuit ?? "—"}</td>
                      <td className="p-3 text-neutral-500">{p.condicion_pago_dias ? `${p.condicion_pago_dias} días` : "Contado"}</td>
                      <td className={`p-3 text-right tabular-nums font-semibold ${p.saldo > 0 ? "text-red-600" : "text-neutral-900"}`}>
                        ${formatearMonto(p.saldo)}
                      </td>
                      <td className="p-3">
                        <span
                          className={`text-xs rounded-full px-2 py-0.5 ${
                            p.saldo > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {p.saldo > 0 ? "Con deuda" : "Al día"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="border-t md:border-t-0 md:border-l border-neutral-200 p-5">
            {!seleccionado ? (
              <p className="text-sm text-neutral-400 text-center py-10">Elegí un proveedor de la lista.</p>
            ) : (
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="font-bold text-neutral-900">{seleccionado.nombre}</h3>
                  {esAdmin && (
                    <button onClick={() => setModalAbierto("EDITAR")} className="text-xs font-semibold text-accent">
                      Editar
                    </button>
                  )}
                </div>
                <p className="text-xs text-neutral-500 mb-4">
                  {seleccionado.cuit ? `CUIT ${seleccionado.cuit}` : "Sin CUIT cargado"} ·{" "}
                  {seleccionado.condicion_pago_dias ? `${seleccionado.condicion_pago_dias} días` : "Contado"}
                </p>

                <div className={`rounded-xl p-4 mb-4 ${seleccionado.saldo > 0 ? "bg-red-50" : "bg-emerald-50"}`}>
                  <p className={`text-[11px] font-bold uppercase tracking-wide mb-0.5 ${seleccionado.saldo > 0 ? "text-red-700" : "text-emerald-700"}`}>
                    Saldo actual {seleccionado.saldo > 0 ? "(le debemos)" : ""}
                  </p>
                  <p className={`text-2xl font-extrabold ${seleccionado.saldo > 0 ? "text-red-700" : "text-emerald-700"}`}>
                    ${formatearMonto(seleccionado.saldo)}
                  </p>
                </div>

                <p className="text-sm text-neutral-400 text-center py-8 border border-dashed border-neutral-200 rounded-xl mb-4">
                  Todavía no hay facturas ni movimientos — se cargan desde Órdenes de compra y Facturas (próximo paso).
                </p>

                {seleccionado.contacto || seleccionado.telefono || seleccionado.email ? (
                  <div className="text-xs text-neutral-500 space-y-1 mb-4">
                    {seleccionado.contacto && <p>Contacto: {seleccionado.contacto}</p>}
                    {seleccionado.telefono && <p>Tel: {seleccionado.telefono}</p>}
                    {seleccionado.email && <p>{seleccionado.email}</p>}
                  </div>
                ) : null}

                {esAdmin && (
                  <button onClick={() => handleCambiarEstado(seleccionado)} className="text-xs font-semibold text-neutral-500">
                    {seleccionado.estado === "ACTIVO" ? "Marcar inactivo" : "Marcar activo"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {modalAbierto && (
        <ProveedorFormModal
          proveedor={modalAbierto === "EDITAR" ? seleccionado : null}
          onClose={() => setModalAbierto(null)}
        />
      )}
    </div>
  );
}
