"use client";

import { useMemo, useState } from "react";
import type { Local, Venta, DetalleVenta, Producto, VarianteProducto, Cliente } from "@/lib/supabase";
import { confirmarCobro, cancelarPedido } from "@/app/(app)/cobros-efectivo/actions";

type Tab = "PENDIENTE" | "COMPLETOS" | "CANCELADOS";
type FiltroFecha = "HOY" | "SEMANA" | "MES" | "RANGO";

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearPedido(numero: number) {
  return `VTA-${String(numero).padStart(4, "0")}`;
}

function formatearHora(fechaISO: string) {
  return new Date(fechaISO).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

const FORMAS_PAGO_MP: { valor: string; etiqueta: string }[] = [
  { valor: "DINERO_CUENTA", etiqueta: "Dinero en cuenta MP" },
  { valor: "DEBITO", etiqueta: "Tarjeta de débito" },
  { valor: "CUOTAS_SIN_INTERES", etiqueta: "Cuotas sin interés" },
  { valor: "PREPAGA", etiqueta: "Tarjeta prepaga" },
  { valor: "CREDITO", etiqueta: "Tarjeta de crédito" },
];

function mismoDia(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fechaEnRango(fechaISO: string, filtro: FiltroFecha, desde: string, hasta: string) {
  const fecha = new Date(fechaISO);
  const hoy = new Date();
  if (filtro === "HOY") return mismoDia(fecha, hoy);
  if (filtro === "SEMANA") {
    const hace7 = new Date(hoy);
    hace7.setDate(hoy.getDate() - 6);
    hace7.setHours(0, 0, 0, 0);
    return fecha >= hace7;
  }
  if (filtro === "MES") return fecha.getFullYear() === hoy.getFullYear() && fecha.getMonth() === hoy.getMonth();
  // RANGO
  const clave = fechaISO.slice(0, 10);
  return (!desde || clave >= desde) && (!hasta || clave <= hasta);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function CobrosEfectivoApp({
  locales,
  ventas,
  detalle,
  productos,
  variantes,
  clientes,
}: {
  locales: Local[];
  ventas: Venta[];
  detalle: DetalleVenta[];
  productos: Producto[];
  variantes: VarianteProducto[];
  clientes: Cliente[];
}) {
  const [idLocal, setIdLocal] = useState(locales[0]?.id_local ?? "");
  const [tab, setTab] = useState<Tab>("PENDIENTE");
  const [filtroFecha, setFiltroFecha] = useState<FiltroFecha>("HOY");
  const [rangoDesde, setRangoDesde] = useState(hoyISO());
  const [rangoHasta, setRangoHasta] = useState(hoyISO());
  const [idVentaSeleccionada, setIdVentaSeleccionada] = useState<string | null>(null);
  const [montoRecibido, setMontoRecibido] = useState("");
  const [formaPagoMp, setFormaPagoMp] = useState("");
  const [cancelando, setCancelando] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variantePorId = useMemo(() => new Map(variantes.map((v) => [v.id_variante, v])), [variantes]);
  const productoPorId = useMemo(() => new Map(productos.map((p) => [p.id_producto, p])), [productos]);
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id_cliente, c])), [clientes]);

  const nombreVariante = (idVariante: string) => {
    const variante = variantePorId.get(idVariante);
    if (!variante) return "Producto";
    const producto = productoPorId.get(variante.id_producto);
    const base = producto?.nombre ?? "Producto";
    return variante.nombre !== "Único" ? `${base} — ${variante.nombre}` : base;
  };

  const detallePorVenta = useMemo(() => {
    const map = new Map<string, DetalleVenta[]>();
    detalle.forEach((d) => {
      const grupo = map.get(d.id_venta) ?? [];
      grupo.push(d);
      map.set(d.id_venta, grupo);
    });
    return map;
  }, [detalle]);

  const ventasDelLocal = useMemo(() => ventas.filter((v) => v.id_local === idLocal), [ventas, idLocal]);

  const pendientes = useMemo(() => ventasDelLocal.filter((v) => v.estado === "PENDIENTE_PAGO"), [ventasDelLocal]);
  const completos = useMemo(
    () =>
      ventasDelLocal
        .filter((v) => v.estado === "PAGADA")
        .filter((v) => fechaEnRango(v.fecha, filtroFecha, rangoDesde, rangoHasta)),
    [ventasDelLocal, filtroFecha, rangoDesde, rangoHasta]
  );
  const cancelados = useMemo(
    () =>
      ventasDelLocal
        .filter((v) => v.estado === "CANCELADA")
        .filter((v) => fechaEnRango(v.fecha, filtroFecha, rangoDesde, rangoHasta)),
    [ventasDelLocal, filtroFecha, rangoDesde, rangoHasta]
  );

  const listaActual = tab === "PENDIENTE" ? pendientes : tab === "COMPLETOS" ? completos : cancelados;

  const ventaSeleccionada = useMemo(
    () => listaActual.find((v) => v.id_venta === idVentaSeleccionada) ?? listaActual[0] ?? null,
    [listaActual, idVentaSeleccionada]
  );

  const detalleSeleccionado = ventaSeleccionada ? detallePorVenta.get(ventaSeleccionada.id_venta) ?? [] : [];

  function seleccionar(idVenta: string) {
    setIdVentaSeleccionada(idVenta);
    setMontoRecibido("");
    setFormaPagoMp("");
    setCancelando(false);
    setMotivoCancelacion("");
    setError(null);
  }

  function cambiarTab(nuevo: Tab) {
    setTab(nuevo);
    setIdVentaSeleccionada(null);
    setCancelando(false);
    setError(null);
  }

  const esMercadoPago = ventaSeleccionada?.medio_pago === "MERCADO_PAGO";
  const montoNum = esMercadoPago ? ventaSeleccionada?.total ?? 0 : Number(montoRecibido.replace(/[^\d.-]/g, "")) || 0;
  const vuelto = ventaSeleccionada ? montoNum - (ventaSeleccionada.total ?? 0) : 0;

  function handleConfirmarCobro() {
    if (!ventaSeleccionada) return;
    setError(null);
    setProcesando(true);
    confirmarCobro(ventaSeleccionada.id_venta, montoNum, esMercadoPago ? formaPagoMp : undefined)
      .then(() => setIdVentaSeleccionada(null))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo confirmar el cobro"))
      .finally(() => setProcesando(false));
  }

  function handleCancelarPedido() {
    if (!ventaSeleccionada) return;
    setError(null);
    setProcesando(true);
    cancelarPedido(ventaSeleccionada.id_venta, motivoCancelacion)
      .then(() => {
        setIdVentaSeleccionada(null);
        setCancelando(false);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cancelar el pedido"))
      .finally(() => setProcesando(false));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Cobros en efectivo</h1>
          <p className="text-sm text-neutral-500">Confirmación rápida de pedidos del Self Checkout.</p>
        </div>
        <select
          value={idLocal}
          onChange={(e) => {
            setIdLocal(e.target.value);
            setIdVentaSeleccionada(null);
          }}
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          {locales.map((l) => (
            <option key={l.id_local} value={l.id_local}>
              {l.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="flex gap-1 px-5 pt-3 border-b border-neutral-200">
          <TabButton activo={tab === "PENDIENTE"} onClick={() => cambiarTab("PENDIENTE")}>
            Pendientes {pendientes.length > 0 && <span className="ml-1 text-xs bg-accent-tint text-accent font-bold px-1.5 py-0.5 rounded-full">{pendientes.length}</span>}
          </TabButton>
          <TabButton activo={tab === "COMPLETOS"} onClick={() => cambiarTab("COMPLETOS")}>
            Completos
          </TabButton>
          <TabButton activo={tab === "CANCELADOS"} onClick={() => cambiarTab("CANCELADOS")}>
            Cancelados
          </TabButton>
        </div>

        {tab !== "PENDIENTE" && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-neutral-200">
            {(["HOY", "SEMANA", "MES", "RANGO"] as FiltroFecha[]).map((f) => (
              <button
                key={f}
                onClick={() => setFiltroFecha(f)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                  filtroFecha === f ? "bg-accent border-accent text-white" : "bg-neutral-50 border-neutral-200 text-neutral-600"
                }`}
              >
                {f === "HOY" ? "Hoy" : f === "SEMANA" ? "Esta semana" : f === "MES" ? "Este mes" : "Rango"}
              </button>
            ))}
            {filtroFecha === "RANGO" && (
              <div className="flex items-center gap-1.5 ml-1">
                <input
                  type="date"
                  value={rangoDesde}
                  onChange={(e) => setRangoDesde(e.target.value)}
                  className="border border-neutral-300 rounded-md px-2 py-1 text-xs"
                />
                <span className="text-neutral-400 text-xs">–</span>
                <input
                  type="date"
                  value={rangoHasta}
                  onChange={(e) => setRangoHasta(e.target.value)}
                  className="border border-neutral-300 rounded-md px-2 py-1 text-xs"
                />
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] min-h-[360px]">
          <div className="border-b md:border-b-0 md:border-r border-neutral-200 p-3.5 flex flex-col gap-2">
            {listaActual.length === 0 && <p className="text-sm text-neutral-400 text-center py-8">Sin pedidos acá.</p>}
            {listaActual.map((v) => (
              <button
                key={v.id_venta}
                onClick={() => seleccionar(v.id_venta)}
                className={`text-left rounded-xl border px-3.5 py-3 ${
                  ventaSeleccionada?.id_venta === v.id_venta ? "border-accent bg-accent-tint" : "border-neutral-200 bg-neutral-50"
                }`}
              >
                <div className="font-bold text-sm text-neutral-900">{formatearPedido(v.numero)}</div>
                <div className="text-xs text-neutral-400 mb-1.5">
                  {v.id_cliente ? clientePorId.get(v.id_cliente)?.nombre ?? "Cliente" : "Sin cliente"}
                </div>
                <div className="text-xs text-neutral-500">
                  {(detallePorVenta.get(v.id_venta) ?? []).length} producto
                  {(detallePorVenta.get(v.id_venta) ?? []).length === 1 ? "" : "s"}
                </div>
                <div className="font-bold text-sm text-neutral-900 mt-0.5">${formatearMonto(v.total ?? 0)}</div>
                {tab === "PENDIENTE" && (
                  <div className="text-xs text-neutral-400 mt-1.5">
                    {v.medio_pago === "MERCADO_PAGO" ? "📱 Mercado Pago" : "💵 Efectivo"}
                  </div>
                )}
                {tab === "COMPLETOS" && (
                  <div className="text-xs text-neutral-400 mt-1.5">
                    {v.medio_pago === "MERCADO_PAGO" ? "📱 Mercado Pago" : "💵 Efectivo"} · {formatearHora(v.fecha)}
                  </div>
                )}
                {tab === "CANCELADOS" && (
                  <div className="text-xs text-red-500 mt-1.5">✕ Cancelado {formatearHora(v.fecha_cancelacion ?? v.fecha)}</div>
                )}
              </button>
            ))}
          </div>

          <div className="p-5">
            {!ventaSeleccionada ? (
              <p className="text-sm text-neutral-400 text-center py-10">Elegí un pedido de la lista.</p>
            ) : (
              <div className="flex flex-col h-full">
                <div className="flex items-baseline justify-between mb-3.5">
                  <h3 className="font-bold text-neutral-900">{formatearPedido(ventaSeleccionada.numero)}</h3>
                  {tab === "PENDIENTE" && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-accent-tint text-accent">
                        {esMercadoPago ? "📱 Mercado Pago" : "💵 Efectivo"}
                      </span>
                      <button onClick={() => setIdVentaSeleccionada(null)} className="text-xs text-neutral-400">
                        Cerrar
                      </button>
                    </div>
                  )}
                  {tab === "COMPLETOS" && (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
                      {ventaSeleccionada.medio_pago === "MERCADO_PAGO" ? "📱 Mercado Pago" : "💵 Efectivo"}
                    </span>
                  )}
                  {tab === "CANCELADOS" && (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-700">Cancelado</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-7 mb-4">
                  <Campo etiqueta="Cliente" valor={ventaSeleccionada.id_cliente ? clientePorId.get(ventaSeleccionada.id_cliente)?.nombre ?? "Cliente" : "Sin cliente"} />
                  {tab === "PENDIENTE" && <Campo etiqueta="Subtotal" valor={`$${formatearMonto(ventaSeleccionada.subtotal ?? 0)}`} />}
                  {tab === "COMPLETOS" && <Campo etiqueta="Cobrado" valor={formatearHora(ventaSeleccionada.fecha)} />}
                  {tab === "COMPLETOS" && (
                    <Campo
                      etiqueta="WiiGo Points"
                      valor={ventaSeleccionada.puntos_generados > 0 ? `+${ventaSeleccionada.puntos_generados}` : "—"}
                    />
                  )}
                  {tab === "CANCELADOS" && (
                    <Campo etiqueta="Motivo" valor={ventaSeleccionada.motivo_cancelacion ?? "—"} />
                  )}
                </div>

                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-neutral-400 border-b border-neutral-200">
                      <th className="text-left font-bold pb-2">Producto</th>
                      <th className="text-left font-bold pb-2">Cant.</th>
                      <th className="text-right font-bold pb-2">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalleSeleccionado.map((d) => (
                      <tr key={d.id_detalle} className="border-b border-neutral-100">
                        <td className="py-2">{nombreVariante(d.id_variante)}</td>
                        <td className="py-2">{d.cantidad}</td>
                        <td className="py-2 text-right tabular-nums">${formatearMonto(d.subtotal ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {tab === "PENDIENTE" && !cancelando && (
                  <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 mt-auto">
                    <div className="flex justify-between items-center font-extrabold text-base pb-2 border-b border-neutral-200 mb-2">
                      <span>A cobrar</span>
                      <span>${formatearMonto(ventaSeleccionada.total ?? 0)}</span>
                    </div>
                    {esMercadoPago ? (
                      <div>
                        <label className="block text-sm text-neutral-500 mb-1">¿Cómo pagó el cliente?</label>
                        <select
                          value={formaPagoMp}
                          onChange={(e) => setFormaPagoMp(e.target.value)}
                          className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm bg-white"
                        >
                          <option value="">Elegí una opción...</option>
                          {FORMAS_PAGO_MP.map((f) => (
                            <option key={f.valor} value={f.valor}>
                              {f.etiqueta}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-neutral-400 mt-1">
                          Se ve en el detalle del cobro de Mercado Pago — de esto depende la comisión real que se
                          descuenta en Liquidaciones y Rentabilidad.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-center text-sm mb-2">
                          <label className="text-neutral-500">Pagó con</label>
                          <input
                            value={montoRecibido}
                            onChange={(e) => setMontoRecibido(e.target.value)}
                            placeholder="$0"
                            className="w-32 text-right border border-neutral-300 rounded-lg px-2.5 py-1.5"
                          />
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <label className="text-neutral-500">Vuelto</label>
                          <span className={`font-bold ${vuelto < 0 ? "text-red-600" : "text-emerald-600"}`}>
                            ${formatearMonto(Math.max(vuelto, 0))}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-600 mt-2" role="alert">
                    {error}
                  </p>
                )}

                {tab === "PENDIENTE" && !cancelando && (
                  <div className="flex gap-2.5 mt-3">
                    <button
                      onClick={() => setCancelando(true)}
                      className="flex-1 border border-neutral-300 text-neutral-700 font-semibold py-2.5 rounded-xl text-sm"
                    >
                      Cancelar pedido
                    </button>
                    <button
                      onClick={handleConfirmarCobro}
                      disabled={procesando || (esMercadoPago ? !formaPagoMp : montoNum < (ventaSeleccionada.total ?? 0))}
                      className="flex-1 bg-accent hover:bg-accent-dark disabled:opacity-40 text-white font-bold py-2.5 rounded-xl text-sm"
                    >
                      {procesando ? "Confirmando..." : `Confirmar cobro · $${formatearMonto(ventaSeleccionada.total ?? 0)}`}
                    </button>
                  </div>
                )}

                {tab === "PENDIENTE" && cancelando && (
                  <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-4">
                    <p className="text-sm font-semibold text-red-800 mb-2">¿Cancelar este pedido?</p>
                    <input
                      value={motivoCancelacion}
                      onChange={(e) => setMotivoCancelacion(e.target.value)}
                      placeholder="Motivo (opcional) — ej: el cliente se fue sin pagar"
                      className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm mb-3"
                    />
                    <div className="flex gap-2.5">
                      <button
                        onClick={() => setCancelando(false)}
                        className="flex-1 border border-neutral-300 text-neutral-700 font-semibold py-2.5 rounded-xl text-sm bg-white"
                      >
                        Volver
                      </button>
                      <button
                        onClick={handleCancelarPedido}
                        disabled={procesando}
                        className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl text-sm"
                      >
                        {procesando ? "Cancelando..." : "Confirmar cancelación"}
                      </button>
                    </div>
                  </div>
                )}

                {tab === "COMPLETOS" && (
                  <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 mt-auto text-sm">
                    <div className="flex justify-between mb-1.5">
                      <span className="text-neutral-500">Total</span>
                      <span className="font-semibold">${formatearMonto(ventaSeleccionada.total ?? 0)}</span>
                    </div>
                    {ventaSeleccionada.total_cobrado != null && (
                      <>
                        <div className="flex justify-between mb-1.5">
                          <span className="text-neutral-500">Pagó con</span>
                          <span className="font-semibold">${formatearMonto(ventaSeleccionada.total_cobrado)}</span>
                        </div>
                        <div className="flex justify-between font-extrabold border-t border-neutral-200 pt-1.5">
                          <span>Vuelto entregado</span>
                          <span className="text-emerald-600">
                            ${formatearMonto(Math.max(ventaSeleccionada.total_cobrado - (ventaSeleccionada.total ?? 0), 0))}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-sm font-bold px-3.5 py-2.5 border-b-2 ${
        activo ? "text-accent border-accent" : "text-neutral-400 border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">{etiqueta}</p>
      <p className="text-sm font-bold text-neutral-900 mt-0.5">{valor}</p>
    </div>
  );
}
