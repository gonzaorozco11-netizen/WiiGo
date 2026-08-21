"use client";

import { Fragment, useEffect, useState } from "react";
import type { Local, Turno } from "@/lib/supabase";
import { abrirTurno, cerrarTurno, historialTurnos, resumenTurnoAbierto, ventasDeTurno } from "@/app/(app)/turnos/actions";

type Resumen = {
  totalEfectivo: number;
  totalMercadoPago: number;
  totalVueltoEntregado: number;
  cantidadVentas: number;
  montoInicial: number;
  efectivoEsperado: number;
};

type VentaTurno = {
  idVenta: string;
  numero: number;
  fecha: string;
  medioPago: string | null;
  total: number;
  totalCobrado: number | null;
  usuario: string | null;
  productos: string;
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

function formatearHora(fechaISO: string) {
  return new Date(fechaISO).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function formatearPedido(numero: number) {
  return `VTA-${String(numero).padStart(4, "0")}`;
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
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [idTurnoExpandido, setIdTurnoExpandido] = useState<string | null>(null);
  const [ventasPorTurno, setVentasPorTurno] = useState<Record<string, VentaTurno[]>>({});
  const [cargandoVentasDe, setCargandoVentasDe] = useState<string | null>(null);

  const turnoAbierto = turnosAbiertos.find((t) => t.id_local === idLocal) ?? null;

  useEffect(() => {
    setError(null);
    setCerrando(false);
    setEfectivoContado("");
    setObservaciones("");
    setResumen(null);
    setIdTurnoExpandido(null);
  }, [idLocal]);

  // El historial se muestra siempre — no hace falta ir a buscarlo con un
  // botón aparte, así se ve de entrada qué turnos cerraron con diferencia.
  useEffect(() => {
    if (!idLocal) return;
    setCargandoHistorial(true);
    historialTurnos(idLocal)
      .then(setHistorial)
      .finally(() => setCargandoHistorial(false));
  }, [idLocal, turnoAbierto]);

  function toggleExpandirTurno(idTurno: string) {
    if (idTurnoExpandido === idTurno) {
      setIdTurnoExpandido(null);
      return;
    }
    setIdTurnoExpandido(idTurno);
    if (!ventasPorTurno[idTurno]) {
      setCargandoVentasDe(idTurno);
      ventasDeTurno(idTurno)
        .then((v) => setVentasPorTurno((prev) => ({ ...prev, [idTurno]: v })))
        .finally(() => setCargandoVentasDe(null));
    }
  }

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

      <div className="mt-6">
        <h2 className="text-sm font-bold text-neutral-900 mb-2">Historial de turnos</h2>
        <p className="text-xs text-neutral-400 mb-3">Del más reciente al más viejo. Tocá una fila para ver las ventas de ese turno.</p>

        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          {cargandoHistorial ? (
            <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
          ) : historial.length === 0 ? (
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
                    const expandido = idTurnoExpandido === t.id_turno;
                    return (
                      <Fragment key={t.id_turno}>
                        <tr
                          onClick={() => toggleExpandirTurno(t.id_turno)}
                          className={`border-b border-neutral-100 last:border-0 cursor-pointer hover:bg-neutral-50 ${
                            expandido ? "bg-neutral-50" : ""
                          }`}
                        >
                          <td className="p-3 whitespace-nowrap">
                            <span className="text-neutral-400 mr-1">{expandido ? "▾" : "▸"}</span>
                            {formatearFechaHora(t.fecha_apertura)}
                            <div className="text-xs text-neutral-400 pl-3.5">{t.usuario_apertura ?? "—"}</div>
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
                        {expandido && (
                          <tr key={`${t.id_turno}-detalle`} className="border-b border-neutral-100 last:border-0">
                            <td colSpan={9} className="bg-neutral-50 p-0">
                              {cargandoVentasDe === t.id_turno ? (
                                <p className="text-sm text-neutral-400 text-center py-4">Cargando ventas...</p>
                              ) : (ventasPorTurno[t.id_turno] ?? []).length === 0 ? (
                                <p className="text-sm text-neutral-400 text-center py-4">
                                  Este turno no tuvo ninguna venta.
                                </p>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-neutral-400 border-b border-neutral-200">
                                      <th className="p-2.5 pl-8">Hora</th>
                                      <th className="p-2.5">Pedido</th>
                                      <th className="p-2.5">Productos</th>
                                      <th className="p-2.5">Pago</th>
                                      <th className="p-2.5 text-right">Total</th>
                                      <th className="p-2.5 text-right">Pagó con</th>
                                      <th className="p-2.5 text-right">Vuelto</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(ventasPorTurno[t.id_turno] ?? []).map((v) => (
                                      <tr key={v.idVenta} className="border-b border-neutral-100 last:border-0">
                                        <td className="p-2.5 pl-8 whitespace-nowrap">{formatearHora(v.fecha)}</td>
                                        <td className="p-2.5 whitespace-nowrap">{formatearPedido(v.numero)}</td>
                                        <td className="p-2.5">{v.productos || "—"}</td>
                                        <td className="p-2.5 text-neutral-500">
                                          {v.medioPago === "MERCADO_PAGO" ? "Mercado Pago" : v.medioPago === "EFECTIVO" ? "Efectivo" : "—"}
                                        </td>
                                        <td className="p-2.5 text-right tabular-nums">${formatearMonto(v.total)}</td>
                                        <td className="p-2.5 text-right tabular-nums">
                                          {v.medioPago === "EFECTIVO" && v.totalCobrado != null
                                            ? `$${formatearMonto(v.totalCobrado)}`
                                            : "—"}
                                        </td>
                                        <td className="p-2.5 text-right tabular-nums">
                                          {v.medioPago === "EFECTIVO" && v.totalCobrado != null && v.totalCobrado > v.total
                                            ? `$${formatearMonto(v.totalCobrado - v.total)}`
                                            : "—"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
