"use client";

import { useEffect, useState } from "react";
import type { Local, Turno } from "@/lib/supabase";
import { abrirTurno, cerrarTurno, historialTurnos, resumenTurnoAbierto } from "@/app/(app)/turnos/actions";

type Resumen = {
  totalEfectivo: number;
  totalMercadoPago: number;
  totalVueltoEntregado: number;
  cantidadVentas: number;
  montoInicial: number;
  efectivoEsperado: number;
};

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearFechaHora(fechaISO: string) {
  return new Date(fechaISO).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TurnosApp({ locales, turnosAbiertos }: { locales: Local[]; turnosAbiertos: Turno[] }) {
  const [idLocal, setIdLocal] = useState(locales[0]?.id_local ?? "");
  const [montoInicial, setMontoInicial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [efectivoContado, setEfectivoContado] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [historial, setHistorial] = useState<Turno[]>([]);
  const [verHistorial, setVerHistorial] = useState(false);

  const turnoAbierto = turnosAbiertos.find((t) => t.id_local === idLocal) ?? null;

  useEffect(() => {
    setError(null);
    setCerrando(false);
    setEfectivoContado("");
    setObservaciones("");
    setVerHistorial(false);
    setResumen(null);
  }, [idLocal]);

  useEffect(() => {
    if (!turnoAbierto) return;
    setCargandoResumen(true);
    resumenTurnoAbierto(turnoAbierto.id_turno)
      .then(setResumen)
      .finally(() => setCargandoResumen(false));
  }, [turnoAbierto]);

  function handleAbrirTurno() {
    const monto = Number(montoInicial.replace(/[^\d.-]/g, "")) || 0;
    setError(null);
    setProcesando(true);
    abrirTurno(idLocal, monto)
      .then(() => window.location.reload())
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo abrir el turno"))
      .finally(() => setProcesando(false));
  }

  function handleCerrarTurno() {
    if (!turnoAbierto) return;
    const contado = Number(efectivoContado.replace(/[^\d.-]/g, "")) || 0;
    setError(null);
    setProcesando(true);
    cerrarTurno(turnoAbierto.id_turno, contado, observaciones)
      .then(() => window.location.reload())
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cerrar el turno"))
      .finally(() => setProcesando(false));
  }

  function handleVerHistorial() {
    setVerHistorial((v) => !v);
    if (!verHistorial) {
      historialTurnos(idLocal).then(setHistorial);
    }
  }

  const contadoNum = Number(efectivoContado.replace(/[^\d.-]/g, "")) || 0;
  const diferencia = resumen ? contadoNum - resumen.efectivoEsperado : 0;

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Turnos de caja</h1>
      <p className="text-sm text-neutral-500 mb-4">
        Apertura y cierre de caja por local, con arqueo de efectivo — así queda registrado qué empleado atendió cada
        turno y todas las ventas que se hicieron durante ese tiempo.
      </p>

      <div className="mb-5">
        <label className="block text-xs font-medium text-neutral-500 mb-1">Local</label>
        <select
          value={idLocal}
          onChange={(e) => setIdLocal(e.target.value)}
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          {locales.map((l) => (
            <option key={l.id_local} value={l.id_local}>
              {l.nombre}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4" role="alert">
          {error}
        </p>
      )}

      {!turnoAbierto ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-5">
          <h2 className="text-base font-semibold text-neutral-900 mb-1">No hay ningún turno abierto acá</h2>
          <p className="text-sm text-neutral-500 mb-4">
            Nadie va a poder cobrar ventas en este local (Vender ni Cobros en Efectivo) hasta que se abra un turno.
          </p>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Fondo inicial de efectivo</label>
          <input
            value={montoInicial}
            onChange={(e) => setMontoInicial(e.target.value)}
            placeholder="$0"
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <button
            onClick={handleAbrirTurno}
            disabled={procesando}
            className="w-full bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm"
          >
            {procesando ? "Abriendo..." : "Abrir turno"}
          </button>
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
              🟢 Turno abierto
            </span>
            <span className="text-xs text-neutral-400">Desde {formatearFechaHora(turnoAbierto.fecha_apertura)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm mb-4">
            <Campo etiqueta="Abierto por" valor={turnoAbierto.usuario_apertura ?? "—"} />
            <Campo etiqueta="Fondo inicial" valor={`$${formatearMonto(turnoAbierto.monto_inicial_efectivo)}`} />
          </div>

          {cargandoResumen || !resumen ? (
            <p className="text-sm text-neutral-400 mb-4">Calculando ventas del turno...</p>
          ) : (
            <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 mb-4">
              <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                <Campo etiqueta="Ventas" valor={String(resumen.cantidadVentas)} />
                <Campo etiqueta="Efectivo recibido" valor={`$${formatearMonto(resumen.totalEfectivo + resumen.totalVueltoEntregado)}`} />
                <Campo etiqueta="Mercado Pago" valor={`$${formatearMonto(resumen.totalMercadoPago)}`} />
              </div>
              {resumen.totalVueltoEntregado > 0 && (
                <div className="flex justify-between items-center text-sm text-red-600 mb-2">
                  <span>Vuelto entregado (salida)</span>
                  <span className="font-semibold">-${formatearMonto(resumen.totalVueltoEntregado)}</span>
                </div>
              )}
              <div className="flex justify-between items-center border-t border-neutral-200 pt-2.5">
                <span className="font-semibold text-neutral-900">Efectivo esperado en caja</span>
                <span className="font-extrabold text-lg text-neutral-900">${formatearMonto(resumen.efectivoEsperado)}</span>
              </div>
              <p className="text-xs text-neutral-400 mt-1">
                Fondo inicial + efectivo recibido de clientes − vuelto entregado.
              </p>
            </div>
          )}

          {!cerrando ? (
            <button
              onClick={() => setCerrando(true)}
              className="w-full border-2 border-accent text-accent font-bold py-3 rounded-xl text-sm"
            >
              Cerrar turno (arqueo)
            </button>
          ) : (
            <div className="border-t border-neutral-200 pt-4">
              <h3 className="text-sm font-bold text-neutral-900 mb-2">Arqueo de cierre</h3>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Efectivo contado (contá la caja física)</label>
              <input
                value={efectivoContado}
                onChange={(e) => setEfectivoContado(e.target.value)}
                placeholder="$0"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-2"
              />
              {resumen && efectivoContado !== "" && (
                <p
                  className={`text-sm font-semibold mb-3 ${
                    diferencia === 0 ? "text-emerald-600" : diferencia > 0 ? "text-accent" : "text-red-600"
                  }`}
                >
                  {diferencia === 0
                    ? "✓ Cierra justo, sin diferencia."
                    : diferencia > 0
                      ? `Sobran $${formatearMonto(diferencia)} respecto de lo esperado.`
                      : `Faltan $${formatearMonto(Math.abs(diferencia))} respecto de lo esperado.`}
                </p>
              )}
              <label className="block text-sm font-medium text-neutral-700 mb-1">Observaciones (opcional)</label>
              <input
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Ej: faltante por vuelto mal dado en la venta #0012"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-3"
              />
              <div className="flex gap-2.5">
                <button
                  onClick={() => setCerrando(false)}
                  className="flex-1 border border-neutral-300 text-neutral-700 font-semibold py-2.5 rounded-xl text-sm"
                >
                  Volver
                </button>
                <button
                  onClick={handleCerrarTurno}
                  disabled={procesando || efectivoContado === ""}
                  className="flex-1 bg-accent hover:bg-accent-dark disabled:opacity-40 text-white font-bold py-2.5 rounded-xl text-sm"
                >
                  {procesando ? "Cerrando..." : "Confirmar cierre"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-5">
        <button onClick={handleVerHistorial} className="text-sm text-accent font-medium">
          {verHistorial ? "Ocultar historial ▴" : "Ver historial de turnos ▾"}
        </button>

        {verHistorial && (
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden mt-3">
            {historial.length === 0 ? (
              <p className="text-sm text-neutral-400 text-center py-8">Todavía no hay turnos cerrados en este local.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                      <th className="p-3">Apertura</th>
                      <th className="p-3">Cierre</th>
                      <th className="p-3 text-right">Fondo inicial</th>
                      <th className="p-3 text-right">Esperado</th>
                      <th className="p-3 text-right">Contado</th>
                      <th className="p-3 text-right">Diferencia</th>
                      <th className="p-3 text-right">Vuelto</th>
                      <th className="p-3 text-right">Mercado Pago</th>
                      <th className="p-3 text-right">Ventas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map((t) => {
                      const diff = t.diferencia_efectivo ?? 0;
                      return (
                        <tr key={t.id_turno} className="border-b border-neutral-100 last:border-0">
                          <td className="p-3 whitespace-nowrap">
                            {formatearFechaHora(t.fecha_apertura)}
                            <div className="text-xs text-neutral-400">{t.usuario_apertura ?? "—"}</div>
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            {t.fecha_cierre ? formatearFechaHora(t.fecha_cierre) : "—"}
                            <div className="text-xs text-neutral-400">{t.usuario_cierre ?? "—"}</div>
                          </td>
                          <td className="p-3 text-right tabular-nums">${formatearMonto(t.monto_inicial_efectivo)}</td>
                          <td className="p-3 text-right tabular-nums">${formatearMonto(t.efectivo_esperado ?? 0)}</td>
                          <td className="p-3 text-right tabular-nums">${formatearMonto(t.efectivo_contado ?? 0)}</td>
                          <td
                            className={`p-3 text-right tabular-nums font-semibold ${
                              diff === 0 ? "text-emerald-600" : "text-red-600"
                            }`}
                          >
                            {diff === 0 ? "$0" : `${diff > 0 ? "+" : "-"}$${formatearMonto(Math.abs(diff))}`}
                          </td>
                          <td className="p-3 text-right tabular-nums text-neutral-500">
                            {t.total_vuelto_entregado ? `-$${formatearMonto(t.total_vuelto_entregado)}` : "—"}
                          </td>
                          <td className="p-3 text-right tabular-nums">${formatearMonto(t.total_mercado_pago ?? 0)}</td>
                          <td className="p-3 text-right tabular-nums">{t.cantidad_ventas ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{etiqueta}</p>
      <p className="text-sm font-semibold text-neutral-900">{valor}</p>
    </div>
  );
}
