"use client";

import { useEffect, useState } from "react";
import type { MovimientoCajaAdmin } from "@/lib/supabase";
import { resumenCajaAdmin, movimientosCajaAdmin, registrarMovimientoCajaAdmin, totalCobradoPorBanco } from "@/app/(app)/gastos/actions";

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearFechaHora(fechaISO: string) {
  return new Date(fechaISO).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function inicioDeMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

const COLORES_STAT = {
  success: { borde: "border-t-emerald-600", icono: "bg-emerald-100 text-emerald-600" },
  danger: { borde: "border-t-red-600", icono: "bg-red-100 text-red-600" },
  neutro: { borde: "border-t-neutral-400", icono: "bg-neutral-100 text-neutral-500" },
} as const;

function StatCard({
  color,
  icono,
  etiqueta,
  valor,
  nota,
}: {
  color: keyof typeof COLORES_STAT;
  icono: string;
  etiqueta: string;
  valor: string;
  nota?: string;
}) {
  const c = COLORES_STAT[color];
  return (
    <div className={`bg-white border border-neutral-200 border-t-4 ${c.borde} rounded-xl p-4`}>
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${c.icono}`}>{icono}</span>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{etiqueta}</p>
      </div>
      <p className="text-xl font-extrabold text-neutral-900 tabular-nums tracking-tight">{valor}</p>
      {nota && <p className="text-[11px] text-neutral-400 mt-0.5">{nota}</p>}
    </div>
  );
}

export default function TesoreriaApp() {
  const [resumen, setResumen] = useState<{ saldo: number; ingresadoSemana: number; gastadoSemana: number } | null>(null);
  const [movimientos, setMovimientos] = useState<(MovimientoCajaAdmin & { saldoAcumulado: number })[]>([]);
  const [cobradoBanco, setCobradoBanco] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [mostrarForm, setMostrarForm] = useState<"retiro" | "deposito" | null>(null);
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function recargar() {
    setCargando(true);
    Promise.all([resumenCajaAdmin(), movimientosCajaAdmin(), totalCobradoPorBanco(inicioDeMes(), hoyISO())])
      .then(([r, m, c]) => {
        setResumen(r);
        setMovimientos(m);
        setCobradoBanco(c);
      })
      .finally(() => setCargando(false));
  }

  useEffect(recargar, []);

  function handleRegistrar() {
    const montoNum = Number(monto.replace(/[^\d.-]/g, "")) || 0;
    setError(null);
    setGuardando(true);
    registrarMovimientoCajaAdmin(mostrarForm === "retiro" ? "RETIRO_MANUAL" : "DEPOSITO_MANUAL", montoNum, descripcion)
      .then((res) => {
        if (res.error) {
          setError(res.error);
          return;
        }
        setMostrarForm(null);
        setMonto("");
        setDescripcion("");
        recargar();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Tesorería</h1>
      <p className="text-sm text-neutral-500 mb-5 max-w-2xl">Caja Administración — el efectivo físico que administración maneja a mano.</p>

      <div className="bg-gradient-to-br from-accent to-accent-dark rounded-xl p-6 text-white mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide opacity-80">Efectivo en Caja Administración</p>
          <p className="text-3xl font-extrabold tabular-nums">${formatearMonto(resumen?.saldo ?? 0)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setMostrarForm("deposito")} className="bg-white/15 border border-white/40 rounded-lg px-3.5 py-2 text-sm font-semibold">
            + Registrar depósito
          </button>
          <button onClick={() => setMostrarForm("retiro")} className="bg-white/15 border border-white/40 rounded-lg px-3.5 py-2 text-sm font-semibold">
            − Registrar retiro
          </button>
        </div>
      </div>
      <p className="text-xs text-neutral-400 mb-4">
        Este saldo es solo efectivo físico — lo que entra por Mercado Pago o transferencia va directo al banco, nunca
        pasa por acá.
      </p>

      {mostrarForm && (
        <div className="bg-white border border-neutral-200 rounded-xl p-4 mb-4 max-w-md">
          <h3 className="text-sm font-bold text-neutral-900 mb-2">{mostrarForm === "retiro" ? "Registrar retiro" : "Registrar depósito"}</h3>
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
          <label className="block text-xs font-medium text-neutral-500 mb-1">Monto</label>
          <input value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="$0" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-2" />
          <label className="block text-xs font-medium text-neutral-500 mb-1">Descripción</label>
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej: depósito al banco" className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-3" />
          <div className="flex gap-2">
            <button onClick={() => setMostrarForm(null)} className="flex-1 border border-neutral-300 text-neutral-700 font-semibold py-2 rounded-lg text-sm">
              Cancelar
            </button>
            <button onClick={handleRegistrar} disabled={guardando} className="flex-1 bg-accent hover:bg-accent-dark disabled:opacity-40 text-white font-bold py-2 rounded-lg text-sm">
              {guardando ? "Guardando..." : "Confirmar"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-6">
        <StatCard color="success" icono="⬇" etiqueta="Ingresado esta semana" valor={`$${formatearMonto(resumen?.ingresadoSemana ?? 0)}`} />
        <StatCard color="danger" icono="⬆" etiqueta="Gastado esta semana" valor={`$${formatearMonto(resumen?.gastadoSemana ?? 0)}`} />
        <StatCard color="neutro" icono="🏦" etiqueta="Cobrado por banco (mes)" valor={`$${formatearMonto(cobradoBanco)}`} nota="Mercado Pago/transferencia — informativo" />
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="flex items-baseline justify-between px-4 py-3 border-b border-neutral-100">
          <h2 className="text-sm font-bold text-neutral-900">Movimientos</h2>
          <span className="text-xs text-neutral-400">Cada cierre de turno entra acá solo</span>
        </div>
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : movimientos.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">Todavía no hay movimientos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Detalle</th>
                  <th className="p-3 text-right">Monto</th>
                  <th className="p-3 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id_movimiento} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3 whitespace-nowrap text-neutral-500">{formatearFechaHora(m.fecha)}</td>
                    <td className="p-3">{m.tipo}</td>
                    <td className="p-3">{m.descripcion ?? "—"}</td>
                    <td className={`p-3 text-right tabular-nums font-semibold ${m.monto >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {m.monto >= 0 ? "+" : "-"}${formatearMonto(Math.abs(m.monto))}
                    </td>
                    <td className="p-3 text-right tabular-nums">${formatearMonto(m.saldoAcumulado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
