"use client";

import { Fragment, useEffect, useState } from "react";
import type { Local, Turno } from "@/lib/supabase";
import {
  abrirTurno,
  historialTurnos,
  resumenTurnoAbierto,
  ventasDeTurno,
  confirmarRecuento,
  urlFotoArqueo,
  actualizarFondoCambio,
} from "@/app/(app)/turnos/actions";
import ArqueoCaja from "@/components/ArqueoCaja";

type Resumen = {
  totalEfectivo: number;
  totalMercadoPago: number;
  totalVueltoEntregado: number;
  totalGastosEfectivo: number;
  totalPagosProveedorEfectivo: number;
  totalDevolucionesEfectivo: number;
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

const fondoDe = (l: Local | undefined) => Number((l as Record<string, unknown> | undefined)?.fondo_cambio ?? 20000) || 0;

export default function TurnosApp({
  locales,
  turnosAbiertos,
  puedeAdministrar,
  yo,
}: {
  locales: Local[];
  turnosAbiertos: Turno[];
  /** Administración: cierra la caja de cualquiera, recuenta sobres y cambia el fondo de cambio. */
  puedeAdministrar: boolean;
  yo: { idUsuario: string | null; nombre: string | null };
}) {
  const [idLocal, setIdLocal] = useState(locales[0]?.id_local ?? "");
  const [montoInicial, setMontoInicial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [editandoFondo, setEditandoFondo] = useState(false);
  const [fondoNuevo, setFondoNuevo] = useState("");

  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [ventasAbierto, setVentasAbierto] = useState<VentaTurno[]>([]);
  const [cerrando, setCerrando] = useState(false);

  const [historial, setHistorial] = useState<Turno[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [idTurnoExpandido, setIdTurnoExpandido] = useState<string | null>(null);
  const [ventasPorTurno, setVentasPorTurno] = useState<Record<string, VentaTurno[]>>({});
  const [cargandoVentasDe, setCargandoVentasDe] = useState<string | null>(null);

  const turnoAbierto = turnosAbiertos.find((t) => t.id_local === idLocal) ?? null;
  const local = locales.find((l) => l.id_local === idLocal);
  const fondo = fondoDe(local);
  const esMiCaja =
    !!turnoAbierto &&
    ((Boolean(turnoAbierto.id_usuario_apertura) && turnoAbierto.id_usuario_apertura === yo.idUsuario) || turnoAbierto.usuario_apertura === yo.nombre);
  const puedoCerrar = puedeAdministrar || esMiCaja;

  useEffect(() => {
    setError(null);
    setCerrando(false);
    setResumen(null);
    setIdTurnoExpandido(null);
    setMontoInicial(String(fondoDe(locales.find((l) => l.id_local === idLocal))));
  }, [idLocal, locales]);

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
    abrirTurno(idLocal, monto, fondo)
      .then((res) => {
        if (res.error) setError(res.error);
        else window.location.reload();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo abrir el turno"))
      .finally(() => setProcesando(false));
  }

  function handleGuardarFondo() {
    const monto = Number(fondoNuevo.replace(/[^\d]/g, "")) || 0;
    setProcesando(true);
    actualizarFondoCambio(idLocal, monto)
      .then((res) => {
        if (res.error) setError(res.error);
        else window.location.reload();
      })
      .finally(() => setProcesando(false));
  }

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

      {/* El sobre de cambio de este local: con eso abre cada turno. */}
      <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600 mb-4">
        <span>
          Sobre de cambio de este local: <b className="text-neutral-900">${formatearMonto(fondo)}</b>
        </span>
        {puedeAdministrar &&
          (editandoFondo ? (
            <>
              <input
                value={fondoNuevo}
                onChange={(e) => setFondoNuevo(e.target.value)}
                inputMode="numeric"
                className="w-28 border border-neutral-300 rounded-lg px-2 py-1 text-sm"
                autoFocus
              />
              <button onClick={handleGuardarFondo} disabled={procesando} className="text-xs font-semibold text-white bg-accent rounded-lg px-3 py-1.5">
                Guardar
              </button>
              <button onClick={() => setEditandoFondo(false)} className="text-xs text-neutral-500">
                Cancelar
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setFondoNuevo(String(fondo));
                setEditandoFondo(true);
              }}
              className="text-xs font-semibold text-accent hover:underline"
            >
              cambiar
            </button>
          ))}
      </div>

      {!turnoAbierto ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-5 max-w-md">
          <h2 className="text-sm font-semibold text-neutral-700 mb-0.5">No hay ningún turno abierto acá</h2>
          <p className="text-xs text-neutral-400 mb-3">
            Nadie va a poder cobrar ventas en este local (Vender ni Cobros en Efectivo) hasta que se abra un turno. Lo normal es abrirlo al fichar la
            entrada.
          </p>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Lo que hay en el sobre de cambio</label>
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
                  resumen.totalVueltoEntregado +
                    resumen.totalGastosEfectivo +
                    resumen.totalPagosProveedorEfectivo +
                    resumen.totalDevolucionesEfectivo >
                  0
                    ? `-$${formatearMonto(
                        resumen.totalVueltoEntregado +
                          resumen.totalGastosEfectivo +
                          resumen.totalPagosProveedorEfectivo +
                          resumen.totalDevolucionesEfectivo
                      )}`
                    : "$0"
                }
                nota={`Vuelto $${formatearMonto(resumen.totalVueltoEntregado)} · Gastos $${formatearMonto(resumen.totalGastosEfectivo)}${
                  resumen.totalPagosProveedorEfectivo > 0 ? ` · Pagos a proveedores $${formatearMonto(resumen.totalPagosProveedorEfectivo)}` : ""
                }${
                  resumen.totalDevolucionesEfectivo > 0
                    ? ` · Devoluciones $${formatearMonto(resumen.totalDevolucionesEfectivo)}`
                    : ""
                }`}
              />
              <StatCard
                color="accent"
                icono="📊"
                etiqueta="Efectivo esperado"
                valor={`$${formatearMonto(resumen.efectivoEsperado)}`}
                nota="Fondo + recibido − vuelto − gastos − pagos a proveedores"
              />
            </div>
          )}

          <div className="flex justify-end mb-5">
            {!cerrando &&
              (puedoCerrar ? (
                <button
                  onClick={() => setCerrando(true)}
                  className="border-2 border-accent text-accent hover:bg-accent-tint font-bold px-5 py-2 rounded-lg text-sm"
                >
                  🔒 Cerrar turno (arqueo)
                </button>
              ) : (
                <p className="text-sm text-neutral-500">
                  Esta caja la abrió <b>{turnoAbierto.usuario_apertura ?? "otra persona"}</b>: la cierra esa persona o administración.
                </p>
              ))}
          </div>

          {cerrando && (
            <div className="max-w-md mb-5">
              <ArqueoCaja
                idTurno={turnoAbierto.id_turno}
                fondo={fondo}
                exigirFotoYFirma={!puedeAdministrar}
                textoBoton="Confirmar cierre"
                onCerrado={() => window.location.reload()}
                onCancelar={() => setCerrando(false)}
              />
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
                          {t.recaudacion != null && t.recuento == null && (
                            <div className="pl-3.5 mt-0.5">
                              <span className="text-[10.5px] font-bold rounded-full px-1.5 py-px bg-amber-50 text-amber-700">Sobre sin contar</span>
                            </div>
                          )}
                          {t.recaudacion != null && t.recuento != null && t.recuento !== t.recaudacion && (
                            <div className="pl-3.5 mt-0.5">
                              <span className="text-[10.5px] font-bold rounded-full px-1.5 py-px bg-red-50 text-red-700">El sobre no coincide</span>
                            </div>
                          )}
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
                          {(t.total_vuelto_entregado ?? 0) + (t.total_gastos_efectivo ?? 0) + (t.total_pagos_proveedor_efectivo ?? 0) > 0
                            ? `-$${formatearMonto(
                                (t.total_vuelto_entregado ?? 0) + (t.total_gastos_efectivo ?? 0) + (t.total_pagos_proveedor_efectivo ?? 0)
                              )}`
                            : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums">${formatearMonto(t.total_mercado_pago ?? 0)}</td>
                        <td className="p-3 text-right tabular-nums">{t.cantidad_ventas ?? 0}</td>
                      </tr>
                      {expandido && (
                        <tr className="border-b border-neutral-100 last:border-0">
                          <td colSpan={9} className="bg-neutral-50 p-0">
                            <DetalleArqueo turno={t} puedeAdministrar={puedeAdministrar} />
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

/**
 * El arqueo de un turno cerrado: los dos sobres, el conteo por billete, la
 * foto y la firma. Administración anota acá cuánto había en el sobre de
 * recaudación cuando lo cuenta.
 */
function DetalleArqueo({ turno, puedeAdministrar }: { turno: Turno; puedeAdministrar: boolean }) {
  const [monto, setMonto] = useState(turno.recuento != null ? String(turno.recuento) : turno.recaudacion != null ? String(turno.recaudacion) : "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verFoto, setVerFoto] = useState<string | null>(null);

  if (turno.recaudacion == null && !turno.foto_arqueo && !turno.firma_cierre) {
    return turno.observaciones ? <p className="text-xs text-neutral-500 px-8 pt-3">Observaciones: {turno.observaciones}</p> : null;
  }

  const billetes = Object.entries(turno.conteo_billetes ?? {})
    .filter(([, n]) => Number(n) > 0)
    .sort((a, b) => (b[0] === "otros" ? -1 : a[0] === "otros" ? 1 : Number(b[0]) - Number(a[0])));
  const recuentoDistinto = turno.recuento != null && turno.recaudacion != null && turno.recuento !== turno.recaudacion;

  return (
    <div className="px-8 pt-3 pb-1 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] text-[13px]">
      <div className="space-y-1">
        {turno.cambio_esperado != null && turno.cambio_esperado !== turno.monto_inicial_efectivo && (
          <p className="text-amber-700 font-semibold">
            Abrió con ${formatearMonto(turno.monto_inicial_efectivo)} en el sobre de cambio: tenía que haber ${formatearMonto(turno.cambio_esperado)}.
          </p>
        )}
        <p>
          Sobre de recaudación: <b>${formatearMonto(turno.recaudacion ?? 0)}</b> · sobre de cambio que dejó: <b>${formatearMonto(turno.cambio_dejado ?? 0)}</b>
        </p>
        {billetes.length > 0 && (
          <p className="text-neutral-500">
            Contó:{" "}
            {billetes.map(([b, n]) => (b === "otros" ? `$${formatearMonto(Number(n))} en billetes chicos y monedas` : `${n} de $${formatearMonto(Number(b))}`)).join(" · ")}
          </p>
        )}
        {turno.observaciones && <p className="text-neutral-500">Observaciones: {turno.observaciones}</p>}
        {puedeAdministrar && turno.recaudacion != null && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className={recuentoDistinto ? "text-red-700 font-semibold" : "text-neutral-600"}>
              {turno.recuento != null
                ? recuentoDistinto
                  ? `Contaste $${formatearMonto(turno.recuento)}: ${turno.recuento < turno.recaudacion ? "faltan" : "sobran"} $${formatearMonto(Math.abs(turno.recuento - turno.recaudacion))}`
                  : `Contaste el sobre: coincide ✓`
                : "Cuando cuentes el sobre, anotá cuánto había:"}
            </span>
            <input
              value={monto}
              onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="w-28 border border-neutral-300 rounded-lg px-2 py-1 text-sm"
              aria-label="Lo que había en el sobre de recaudación"
            />
            <button
              onClick={() => {
                setGuardando(true);
                setError(null);
                confirmarRecuento(turno.id_turno, Number(monto) || 0)
                  .then((res) => (res.error ? setError(res.error) : window.location.reload()))
                  .finally(() => setGuardando(false));
              }}
              disabled={guardando || monto === ""}
              className="text-xs font-semibold text-white bg-accent disabled:opacity-40 rounded-lg px-3 py-1.5"
            >
              {guardando ? "Guardando..." : turno.recuento != null ? "Corregir" : "Confirmar"}
            </button>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        )}
      </div>
      <div className="flex items-start gap-3">
        {turno.foto_arqueo && puedeAdministrar && (
          <button
            onClick={() => urlFotoArqueo(turno.foto_arqueo!).then((u) => u && setVerFoto(u))}
            className="text-xs font-semibold text-accent border border-neutral-200 bg-white rounded-lg px-3 py-1.5"
          >
            📷 Ver foto
          </button>
        )}
        {turno.firma_cierre && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={turno.firma_cierre} alt="Firma del arqueo" className="h-10 w-28 object-contain bg-white border border-neutral-200 rounded" />
        )}
      </div>
      {verFoto && (
        <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={() => setVerFoto(null)} role="dialog" aria-label="Foto del arqueo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={verFoto} alt="Foto del arqueo" className="max-h-[90vh] max-w-full rounded-lg" />
        </div>
      )}
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
