"use client";

import { Fragment, useEffect, useState } from "react";
import type { Local, Turno } from "@/lib/supabase";
import { abrirTurno, cerrarTurno, historialTurnos, resumenTurnoAbierto, ventasDeTurno } from "@/app/(app)/turnos/actions";

type Resumen = {
  totalEfectivo: number;
  totalMercadoPago: number;
  totalVueltoEntregado: number;
  totalGastosEfectivo: number;
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
  const [ventasAbierto, setVentasAbierto] = useState<VentaTurno[]>([]);
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

  useEffect(() => {
    if (!turnoAbierto) return;
    setCargandoResumen(true);
    Promise.all([resumenTurnoAbierto(turnoAbierto.id_turno), ventasDeTurno(turnoAbierto.id_turno)])
      .then(([r, v]) => {
        setResumen(r);
        setVentasAbierto(v);
      })
      .finally(() => setCargandoResumen(false));
  }, [turnoAbierto]);

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

  function handleAbrirTurno() {
    const monto = Number(montoInicial.replace(/[^\d.-]/g, "")) || 0;
    setError(null);
    setProcesando(true);
    abrirTurno(idLocal, monto)
      .then((res) => {
        if (res.error) setError(res.error);
        else window.location.reload();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo abrir el turno"))
      .finally(() => setProcesando(false));
  }

  function handleCerrarTurno() {
    if (!turnoAbierto) return;
    const contado = Number(efectivoContado.replace(/[^\d.-]/g, "")) || 0;
    setError(null);
    setProcesando(true);
    cerrarTurno(turnoAbierto.id_turno, contado, observaciones)
      .then((res) => {
        if (res.error) setError(res.error);
        else window.location.reload();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cerrar el turno"))
      .finally(() => setProcesando(false));
  }

  const contadoNum = Number(efectivoContado.replace(/[^\d.-]/g, "")) || 0;
  const diferencia = resumen ? contadoNum - resumen.efectivoEsperado : 0;
  const efectivoRecibido = resumen ? resumen.totalEfectivo + resumen.totalVueltoEntregado : 0;

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Turnos de caja</h1>
      <p className="text-sm text-neutral-500 mb-5 max-w-2xl">
        Apertura y cierre de caja por local, con arqueo de efectivo — así queda registrado qué empleado atendió cada
        turno y todas las ventas que se hicieron durante ese tiempo.
      </p>

      <div className="flex items-end gap-1 border-b border-neutral-200 mb-5">
        {locales.map((l) => {
          const activo = l.id_local === idLocal;
          return (
            <button
              key={l.id_local}
              onClick={() => setIdLocal(l.id_local)}
              className={`px-4 py-2.5 rounded-t-lg text-sm font-semibold -mb-px border ${
                activo
                  ? "bg-white border-neutral-200 border-b-white text-accent"
                  : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              📍 {l.nombre}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4" role="alert">
          {error}
        </p>
      )}

      {!turnoAbierto ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-5 max-w-md">
          <h2 className="text-sm font-semibold text-neutral-700 mb-0.5">No hay ningún turno abierto acá</h2>
          <p className="text-xs text-neutral-400 mb-3">
            Nadie va a poder cobrar ventas en este local (Vender ni Cobros en Efectivo) hasta que se abra un turno.
          </p>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Fondo inicial de efectivo</label>
          <input
            value={montoInicial}
            onChange={(e) => setMontoInicial(e.target.value)}
            placeholder="$0"
            className="w-full border border-neutral-300 rounded-lg px-3 py-1.5 text-sm mb-2.5"
          />
          <button
            onClick={handleAbrirTurno}
            disabled={procesando}
            className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-4 py-1.5 rounded-lg text-sm"
          >
            {procesando ? "Abriendo..." : "Abrir turno"}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-white border border-neutral-200 rounded-xl px-4 py-3 mb-4">
            <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Turno abierto
            </span>
            <span className="text-sm text-neutral-500">
              👤 Abierto por <b className="text-neutral-900 font-semibold">{turnoAbierto.usuario_apertura ?? "—"}</b>
            </span>
            <span className="text-sm text-neutral-500">
              🕒 Desde <b className="text-neutral-900 font-semibold">{formatearFechaHora(turnoAbierto.fecha_apertura)}</b>
            </span>
            {resumen && (
              <span className="text-sm text-neutral-500">
                🧾 <b className="text-neutral-900 font-semibold">{resumen.cantidadVentas}</b>{" "}
                {resumen.cantidadVentas === 1 ? "venta" : "ventas"}
              </span>
            )}
          </div>

          {cargandoResumen || !resumen ? (
            <p className="text-sm text-neutral-400 mb-4">Calculando ventas del turno...</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-4">
              <StatCard color="purple" icono="💼" etiqueta="Fondo inicial" valor={`$${formatearMonto(resumen.montoInicial)}`} />
              <StatCard
                color="success"
                icono="⬇"
                etiqueta="Efectivo recibido"
                valor={`$${formatearMonto(efectivoRecibido)}`}
                nota="De clientes, antes del vuelto"
              />
              <StatCard
                color="danger"
                icono="⬆"
                etiqueta="Salidas de caja"
                valor={
                  resumen.totalVueltoEntregado + resumen.totalGastosEfectivo > 0
                    ? `-$${formatearMonto(resumen.totalVueltoEntregado + resumen.totalGastosEfectivo)}`
                    : "$0"
                }
                nota={`Vuelto $${formatearMonto(resumen.totalVueltoEntregado)} · Gastos $${formatearMonto(resumen.totalGastosEfectivo)}`}
              />
              <StatCard
                color="accent"
                icono="📊"
                etiqueta="Efectivo esperado"
                valor={`$${formatearMonto(resumen.efectivoEsperado)}`}
                nota="Fondo + recibido − vuelto − gastos"
              />
            </div>
          )}

          <div className="flex justify-end mb-5">
            {!cerrando && (
              <button
                onClick={() => setCerrando(true)}
                className="border-2 border-accent text-accent hover:bg-accent-tint font-bold px-5 py-2 rounded-lg text-sm"
              >
                🔒 Cerrar turno (arqueo)
              </button>
            )}
          </div>

          {cerrando && (
            <div className="bg-white border border-neutral-200 rounded-xl p-5 mb-5 max-w-md">
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

          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden mb-6">
            <div className="flex items-baseline justify-between px-4 py-3 border-b border-neutral-100">
              <h2 className="text-sm font-bold text-neutral-900">Ventas de este turno</h2>
              <span className="text-xs text-neutral-400">{ventasAbierto.length} {ventasAbierto.length === 1 ? "venta" : "ventas"}</span>
            </div>
            {ventasAbierto.length === 0 ? (
              <p className="text-sm text-neutral-400 text-center py-8">Todavía no hay ventas en este turno.</p>
            ) : (
              <div className="overflow-x-auto">
                <VentasTabla ventas={ventasAbierto} />
              </div>
            )}
          </div>
        </>
      )}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="flex items-baseline justify-between px-4 py-3 border-b border-neutral-100">
          <h2 className="text-sm font-bold text-neutral-900">Historial de turnos</h2>
          <span className="text-xs text-neutral-400">Del más reciente al más viejo — tocá una fila para ver el detalle</span>
        </div>

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
                  <th className="p-3 text-right">Salidas</th>
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
                          {(t.total_vuelto_entregado ?? 0) + (t.total_gastos_efectivo ?? 0) > 0
                            ? `-$${formatearMonto((t.total_vuelto_entregado ?? 0) + (t.total_gastos_efectivo ?? 0))}`
                            : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums">${formatearMonto(t.total_mercado_pago ?? 0)}</td>
                        <td className="p-3 text-right tabular-nums">{t.cantidad_ventas ?? 0}</td>
                      </tr>
                      {expandido && (
                        <tr className="border-b border-neutral-100 last:border-0">
                          <td colSpan={9} className="bg-neutral-50 p-0">
                            {cargandoVentasDe === t.id_turno ? (
                              <p className="text-sm text-neutral-400 text-center py-4">Cargando ventas...</p>
                            ) : (ventasPorTurno[t.id_turno] ?? []).length === 0 ? (
                              <p className="text-sm text-neutral-400 text-center py-4">
                                Este turno no tuvo ninguna venta.
                              </p>
                            ) : (
                              <div className="pl-8 pr-2">
                                <VentasTabla ventas={ventasPorTurno[t.id_turno] ?? []} compacta />
                              </div>
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
  );
}

const COLORES_STAT = {
  purple: { borde: "border-t-purple-600", icono: "bg-purple-100 text-purple-600" },
  success: { borde: "border-t-emerald-600", icono: "bg-emerald-100 text-emerald-600" },
  danger: { borde: "border-t-red-600", icono: "bg-red-100 text-red-600" },
  accent: { borde: "border-t-accent", icono: "bg-accent-tint text-accent" },
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

function VentasTabla({ ventas, compacta = false }: { ventas: VentaTurno[]; compacta?: boolean }) {
  const tam = compacta ? "text-xs" : "text-sm";
  const pad = compacta ? "p-2.5" : "p-3";
  return (
    <table className={`w-full ${tam}`}>
      <thead>
        <tr className="text-left text-neutral-400 border-b border-neutral-200">
          <th className={pad}>Hora</th>
          <th className={pad}>Pedido</th>
          <th className={pad}>Productos</th>
          <th className={pad}>Pago</th>
          <th className={`${pad} text-right`}>Total</th>
          <th className={`${pad} text-right`}>Pagó con</th>
          <th className={`${pad} text-right`}>Vuelto</th>
        </tr>
      </thead>
      <tbody>
        {ventas.map((v) => (
          <tr key={v.idVenta} className="border-b border-neutral-100 last:border-0">
            <td className={`${pad} whitespace-nowrap text-neutral-500`}>{formatearHora(v.fecha)}</td>
            <td className={`${pad} whitespace-nowrap`}>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-tint text-accent-dark">
                {formatearPedido(v.numero)}
              </span>
            </td>
            <td className={pad}>{v.productos || "—"}</td>
            <td className={`${pad} text-neutral-500`}>
              {v.medioPago === "MERCADO_PAGO" ? "Mercado Pago" : v.medioPago === "EFECTIVO" ? "Efectivo" : "—"}
            </td>
            <td className={`${pad} text-right tabular-nums`}>${formatearMonto(v.total)}</td>
            <td className={`${pad} text-right tabular-nums`}>
              {v.medioPago === "EFECTIVO" && v.totalCobrado != null ? `$${formatearMonto(v.totalCobrado)}` : "—"}
            </td>
            <td className={`${pad} text-right tabular-nums`}>
              {v.medioPago === "EFECTIVO" && v.totalCobrado != null && v.totalCobrado > v.total
                ? `$${formatearMonto(v.totalCobrado - v.total)}`
                : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
