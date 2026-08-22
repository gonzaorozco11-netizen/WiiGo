"use client";

import { useEffect, useState } from "react";
import type { Marca } from "@/lib/supabase";
import { listarAuditoria, type FilaAuditoria } from "@/app/(app)/auditoria/actions";

function formatearMonto(valor: number) {
  return Math.round(valor).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearFecha(fechaISO: string) {
  return new Date(fechaISO).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function inicioDeMes() {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

const ORIGENES = ["Comercial", "Retenciones", "Compensación", "Profesional"] as const;

const COLOR_ORIGEN: Record<string, string> = {
  Comercial: "bg-amber-50 text-amber-700",
  Retenciones: "bg-purple-50 text-purple-700",
  Compensación: "bg-teal-50 text-teal-700",
  Profesional: "bg-emerald-50 text-emerald-700",
};

export default function AuditoriaFinancieraApp({ marcas }: { marcas: Marca[] }) {
  const [idMarca, setIdMarca] = useState("");
  const [origen, setOrigen] = useState("");
  const [desde, setDesde] = useState(inicioDeMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [filas, setFilas] = useState<FilaAuditoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCargando(true);
    listarAuditoria({ idMarca: idMarca || undefined, origen: origen || undefined, desde, hasta })
      .then((res) => {
        if (res.error) setError(res.error);
        else setFilas(res.filas);
      })
      .finally(() => setCargando(false));
  }, [idMarca, origen, desde, hasta]);

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Auditoría financiera</h1>
      <p className="text-sm text-neutral-500 mb-4 max-w-2xl">
        Todos los movimientos de plata de Situación de marca, Compensaciones y Profesionales, en una sola línea de
        tiempo — quién hizo qué, cuándo y en qué marca. Solo de consulta.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={idMarca} onChange={(e) => setIdMarca(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
          <option value="">Todas las marcas</option>
          {marcas.map((m) => (
            <option key={m.id_marca} value={m.id_marca}>
              {m.nombre}
            </option>
          ))}
        </select>
        <select value={origen} onChange={(e) => setOrigen(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
          <option value="">Todos los orígenes</option>
          {ORIGENES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden overflow-x-auto">
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-10">Cargando...</p>
        ) : filas.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-10">No hay movimientos en este filtro.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-neutral-400 border-b border-neutral-200">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Marca</th>
                <th className="px-3 py-2">Origen</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={`${f.origen}-${f.id}`} className="border-b border-neutral-100 last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-500">{formatearFecha(f.fecha)}</td>
                  <td className="px-3 py-2">{f.nombreMarca}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${COLOR_ORIGEN[f.origen]}`}>{f.origen}</span>
                  </td>
                  <td className="px-3 py-2">{f.tipo}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${f.importe < 0 ? "text-emerald-600" : ""}`}>
                    {f.importe >= 0 ? "+" : ""}${formatearMonto(f.importe)}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{f.usuario ?? "—"}</td>
                  <td className="px-3 py-2 text-neutral-400">{f.observaciones ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
