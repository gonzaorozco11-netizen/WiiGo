"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Local, Venta, DetalleVenta, Producto, VarianteProducto, Marca, Cliente } from "@/lib/supabase";
import { anularVenta, listarVentasFiltradas, obtenerDetalleVenta } from "@/app/(app)/ventas/actions";

type FiltroFecha = "HOY" | "SEMANA" | "MES" | "TODO" | "RANGO";
type FiltroCanal = "TODOS" | "SELF_CHECKOUT" | "POS";
type FiltroEstado = "TODOS" | "PENDIENTE_PAGO" | "PAGADA" | "CANCELADA" | "ANULADA";

const CANAL_LABEL: Record<string, string> = {
  SELF_CHECKOUT: "Self Checkout",
  POS: "Vender (POS)",
};

const ESTADO_ESTILO: Record<string, string> = {
  PENDIENTE_PAGO: "bg-amber-50 text-amber-700",
  PAGADA: "bg-emerald-50 text-emerald-700",
  CANCELADA: "bg-red-50 text-red-700",
  ANULADA: "bg-red-50 text-red-700",
};

const ESTADO_LABEL: Record<string, string> = {
  PENDIENTE_PAGO: "Pendiente",
  PAGADA: "Pagada",
  CANCELADA: "Cancelada",
  ANULADA: "Anulada",
};

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearPedido(numero: number) {
  return `VTA-${String(numero).padStart(4, "0")}`;
}

function formatearFechaHora(fechaISO: string) {
  return new Date(fechaISO).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

// Traduce el filtro elegido en pantalla a un rango de fechas concreto para
// pedírselo al servidor — antes esto filtraba en el navegador sobre TODA la
// tabla ya cargada; ahora el servidor solo manda lo que corresponde a este
// rango (ver listarVentasFiltradas en actions.ts).
function rangoParaFiltro(
  filtro: FiltroFecha,
  rangoDesde: string,
  rangoHasta: string
): { desde: string | null; hasta: string | null } {
  const hoy = new Date();
  if (filtro === "TODO") return { desde: null, hasta: null };
  if (filtro === "HOY") return { desde: hoyISO(), hasta: hoyISO() };
  if (filtro === "SEMANA") {
    const hace7 = new Date(hoy);
    hace7.setDate(hoy.getDate() - 6);
    return { desde: hace7.toISOString().slice(0, 10), hasta: hoyISO() };
  }
  if (filtro === "MES") {
    const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    return { desde: primerDia.toISOString().slice(0, 10), hasta: hoyISO() };
  }
  return { desde: rangoDesde || null, hasta: rangoHasta || null };
}

export default function VentasApp({
  locales,
  ventasIniciales,
  productos,
  variantes,
  marcas,
  clientes,
}: {
  locales: Local[];
  ventasIniciales: Venta[];
  productos: Producto[];
  variantes: VarianteProducto[];
  marcas: Marca[];
  clientes: Cliente[];
}) {
  const [ventas, setVentas] = useState<Venta[]>(ventasIniciales);
  const [cargandoVentas, setCargandoVentas] = useState(false);
  const [posibleTruncado, setPosibleTruncado] = useState(false);
  const [idLocal, setIdLocal] = useState<string>("TODOS");
  const [filtroCanal, setFiltroCanal] = useState<FiltroCanal>("TODOS");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("TODOS");
  const [filtroFecha, setFiltroFecha] = useState<FiltroFecha>("SEMANA");
  const [rangoDesde, setRangoDesde] = useState(hoyISO());
  const [rangoHasta, setRangoHasta] = useState(hoyISO());
  const [idVentaSeleccionada, setIdVentaSeleccionada] = useState<string | null>(null);
  const [detalleSeleccionado, setDetalleSeleccionado] = useState<DetalleVenta[]>([]);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [motivoAnular, setMotivoAnular] = useState("");
  const [procesandoAnular, setProcesandoAnular] = useState(false);
  const [mensajeAnular, setMensajeAnular] = useState<{ tipo: "error" | "aviso"; texto: string } | null>(null);

  // La carga inicial (ventasIniciales) ya viene filtrada por "esta semana"
  // desde el servidor — solo hay que volver a pedir cuando el filtro de
  // fecha cambia a otra cosa.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    const { desde, hasta } = rangoParaFiltro(filtroFecha, rangoDesde, rangoHasta);
    setCargandoVentas(true);
    listarVentasFiltradas({ desde, hasta })
      .then((res) => {
        if (!res.error) {
          setVentas(res.ventas);
          setPosibleTruncado(res.posibleTruncado);
        }
      })
      .finally(() => setCargandoVentas(false));
  }, [filtroFecha, rangoDesde, rangoHasta]);

  useEffect(() => {
    if (!idVentaSeleccionada) {
      setDetalleSeleccionado([]);
      return;
    }
    setCargandoDetalle(true);
    obtenerDetalleVenta(idVentaSeleccionada)
      .then(setDetalleSeleccionado)
      .catch(() => setDetalleSeleccionado([]))
      .finally(() => setCargandoDetalle(false));
  }, [idVentaSeleccionada]);

  function seleccionarVenta(id: string) {
    setIdVentaSeleccionada(id);
    setAnulando(false);
    setMotivoAnular("");
    setMensajeAnular(null);
  }

  function handleAnularVenta() {
    if (!ventaSeleccionada) return;
    setProcesandoAnular(true);
    setMensajeAnular(null);
    anularVenta(ventaSeleccionada.id_venta, motivoAnular)
      .then((res) => {
        if (res.error) {
          setMensajeAnular({ tipo: "error", texto: res.error });
          return;
        }
        setAnulando(false);
        setMotivoAnular("");
        if (res.aviso) setMensajeAnular({ tipo: "aviso", texto: res.aviso });
      })
      .catch((e) => setMensajeAnular({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo anular la venta" }))
      .finally(() => setProcesandoAnular(false));
  }

  const localPorId = useMemo(() => new Map(locales.map((l) => [l.id_local, l])), [locales]);
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id_cliente, c])), [clientes]);
  const variantePorId = useMemo(() => new Map(variantes.map((v) => [v.id_variante, v])), [variantes]);
  const productoPorId = useMemo(() => new Map(productos.map((p) => [p.id_producto, p])), [productos]);
  const marcaPorId = useMemo(() => new Map(marcas.map((m) => [m.id_marca, m])), [marcas]);

  const nombreVariante = (idVariante: string) => {
    const variante = variantePorId.get(idVariante);
    if (!variante) return "Producto";
    const producto = productoPorId.get(variante.id_producto);
    const base = producto?.nombre ?? "Producto";
    return variante.nombre !== "Único" ? `${base} — ${variante.nombre}` : base;
  };

  // El filtro de fecha ya vino aplicado desde el servidor (ver el useEffect
  // de arriba) — acá solo quedan los filtros que no ameritan un viaje al
  // servidor porque ya operan sobre un conjunto acotado.
  const ventasFiltradas = useMemo(() => {
    return ventas.filter((v) => {
      if (idLocal !== "TODOS" && v.id_local !== idLocal) return false;
      if (filtroCanal !== "TODOS" && v.canal !== filtroCanal) return false;
      if (filtroEstado !== "TODOS" && v.estado !== filtroEstado) return false;
      return true;
    });
  }, [ventas, idLocal, filtroCanal, filtroEstado]);

  const resumen = useMemo(() => {
    const pagadas = ventasFiltradas.filter((v) => v.estado === "PAGADA");
    return {
      cantidad: pagadas.length,
      totalBruto: pagadas.reduce((acc, v) => acc + (v.total ?? 0), 0),
    };
  }, [ventasFiltradas]);

  const ventaSeleccionada = useMemo(
    () => ventasFiltradas.find((v) => v.id_venta === idVentaSeleccionada) ?? null,
    [ventasFiltradas, idVentaSeleccionada]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-neutral-900">Transacciones</h1>
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        {resumen.cantidad} venta{resumen.cantidad === 1 ? "" : "s"} pagada{resumen.cantidad === 1 ? "" : "s"} · $
        {formatearMonto(resumen.totalBruto)}
        {cargandoVentas && <span className="text-neutral-400"> · Actualizando…</span>}
      </p>
      {posibleTruncado && (
        <p className="text-xs font-semibold text-amber-700 mb-3">
          ⚠ Hay muchas ventas en este rango — se están mostrando las 5000 más recientes. Achicá el filtro de fecha para ver el
          resto.
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={idLocal}
          onChange={(e) => setIdLocal(e.target.value)}
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="TODOS">Todos los locales</option>
          {locales.map((l) => (
            <option key={l.id_local} value={l.id_local}>
              {l.nombre}
            </option>
          ))}
        </select>

        <select
          value={filtroCanal}
          onChange={(e) => setFiltroCanal(e.target.value as FiltroCanal)}
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="TODOS">Todos los canales</option>
          <option value="SELF_CHECKOUT">Self Checkout</option>
          <option value="POS">Vender (POS)</option>
        </select>

        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value as FiltroEstado)}
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="TODOS">Todos los estados</option>
          <option value="PAGADA">Pagada</option>
          <option value="CANCELADA">Cancelada</option>
          <option value="ANULADA">Anulada</option>
        </select>

        {(["HOY", "SEMANA", "MES", "TODO", "RANGO"] as FiltroFecha[]).map((f) => (
          <button
            key={f}
            onClick={() => setFiltroFecha(f)}
            className={`text-sm font-semibold px-3 py-2 rounded-lg border ${
              filtroFecha === f ? "bg-accent border-accent text-white" : "bg-white border-neutral-300 text-neutral-600"
            }`}
          >
            {f === "HOY" ? "Hoy" : f === "SEMANA" ? "Esta semana" : f === "MES" ? "Este mes" : f === "TODO" ? "Todo" : "Rango"}
          </button>
        ))}
        {filtroFecha === "RANGO" && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={rangoDesde}
              onChange={(e) => setRangoDesde(e.target.value)}
              className="border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            />
            <span className="text-neutral-400 text-sm">–</span>
            <input
              type="date"
              value={rangoHasta}
              onChange={(e) => setRangoHasta(e.target.value)}
              className="border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            />
          </div>
        )}
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] min-h-[400px]">
          <div className="overflow-x-auto">
            {ventasFiltradas.length === 0 ? (
              <p className="text-sm text-neutral-400 text-center py-16">No hay ventas para estos filtros.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="p-3">Venta</th>
                    <th className="p-3">Fecha</th>
                    <th className="p-3">Canal</th>
                    <th className="p-3">Cliente</th>
                    <th className="p-3">Pago</th>
                    <th className="p-3 text-right">Subtotal</th>
                    <th className="p-3 text-right">Desc.</th>
                    <th className="p-3 text-right">Total</th>
                    <th className="p-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {ventasFiltradas.map((v) => (
                    <tr
                      key={v.id_venta}
                      onClick={() => seleccionarVenta(v.id_venta)}
                      className={`border-b border-neutral-100 last:border-0 cursor-pointer ${
                        ventaSeleccionada?.id_venta === v.id_venta ? "bg-accent-tint" : "hover:bg-neutral-50"
                      }`}
                    >
                      <td className="p-3 font-medium text-neutral-900">{formatearPedido(v.numero)}</td>
                      <td className="p-3 text-neutral-500 whitespace-nowrap">{formatearFechaHora(v.fecha)}</td>
                      <td className="p-3 text-neutral-500">{CANAL_LABEL[v.canal ?? ""] ?? v.canal ?? "—"}</td>
                      <td className="p-3 text-neutral-500">
                        {v.id_cliente ? clientePorId.get(v.id_cliente)?.nombre ?? "Cliente" : "Sin cliente"}
                      </td>
                      <td className="p-3 text-neutral-500">
                        {v.medio_pago === "MERCADO_PAGO" ? "Mercado Pago" : v.medio_pago === "EFECTIVO" ? "Efectivo" : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums">${formatearMonto(v.subtotal ?? 0)}</td>
                      <td className="p-3 text-right tabular-nums text-neutral-400">
                        {v.descuento ? `-$${formatearMonto(v.descuento)}` : "—"}
                      </td>
                      <td className="p-3 text-right font-semibold tabular-nums">${formatearMonto(v.total ?? 0)}</td>
                      <td className="p-3">
                        <span className={`text-xs rounded-full px-2 py-0.5 ${ESTADO_ESTILO[v.estado] ?? "bg-neutral-100 text-neutral-600"}`}>
                          {ESTADO_LABEL[v.estado] ?? v.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="border-t md:border-t-0 md:border-l border-neutral-200 p-5">
            {!ventaSeleccionada ? (
              <p className="text-sm text-neutral-400 text-center py-10">Elegí una venta de la lista.</p>
            ) : (
              <div>
                <div className="flex items-baseline justify-between mb-3.5">
                  <h3 className="font-bold text-neutral-900">{formatearPedido(ventaSeleccionada.numero)}</h3>
                  <span className={`text-xs rounded-full px-2.5 py-1 font-semibold ${ESTADO_ESTILO[ventaSeleccionada.estado] ?? ""}`}>
                    {ESTADO_LABEL[ventaSeleccionada.estado] ?? ventaSeleccionada.estado}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-neutral-400">Local</p>
                    <p className="font-medium text-neutral-900">
                      {ventaSeleccionada.id_local ? localPorId.get(ventaSeleccionada.id_local)?.nombre ?? "—" : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-neutral-400">Canal</p>
                    <p className="font-medium text-neutral-900">{CANAL_LABEL[ventaSeleccionada.canal ?? ""] ?? ventaSeleccionada.canal}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-neutral-400">Cliente</p>
                    <p className="font-medium text-neutral-900">
                      {ventaSeleccionada.id_cliente ? clientePorId.get(ventaSeleccionada.id_cliente)?.nombre ?? "Cliente" : "Sin cliente"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-neutral-400">Pago</p>
                    <p className="font-medium text-neutral-900">
                      {ventaSeleccionada.medio_pago === "MERCADO_PAGO" ? "Mercado Pago" : ventaSeleccionada.medio_pago === "EFECTIVO" ? "Efectivo" : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-neutral-400">WiiGo Points</p>
                    <p className="font-medium text-neutral-900">
                      {ventaSeleccionada.puntos_generados > 0 ? `+${ventaSeleccionada.puntos_generados}` : "—"}
                    </p>
                  </div>
                </div>

                {cargandoDetalle ? (
                  <p className="text-sm text-neutral-400 text-center py-4">Cargando detalle...</p>
                ) : (
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-neutral-400 border-b border-neutral-200">
                      <th className="text-left font-bold pb-2">Producto</th>
                      <th className="text-left font-bold pb-2">Marca</th>
                      <th className="text-left font-bold pb-2">Cant.</th>
                      <th className="text-right font-bold pb-2">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalleSeleccionado.map((d) => (
                      <tr key={d.id_detalle} className="border-b border-neutral-100">
                        <td className="py-2">{nombreVariante(d.id_variante)}</td>
                        <td className="py-2 text-neutral-500">{d.id_marca ? marcaPorId.get(d.id_marca)?.nombre ?? "—" : "—"}</td>
                        <td className="py-2">{d.cantidad}</td>
                        <td className="py-2 text-right tabular-nums">${formatearMonto(d.subtotal ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}

                <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 text-sm">
                  <div className="flex justify-between mb-1.5">
                    <span className="text-neutral-500">Subtotal</span>
                    <span>${formatearMonto(ventaSeleccionada.subtotal ?? 0)}</span>
                  </div>
                  {!!ventaSeleccionada.descuento && (
                    <div className="flex justify-between mb-1.5">
                      <span className="text-neutral-500">Descuento</span>
                      <span className="text-red-600">-${formatearMonto(ventaSeleccionada.descuento)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-extrabold text-base border-t border-neutral-200 pt-1.5">
                    <span>Total</span>
                    <span>${formatearMonto(ventaSeleccionada.total ?? 0)}</span>
                  </div>
                </div>

                {ventaSeleccionada.estado === "PAGADA" && (
                  <div className="mt-4">
                    {!anulando ? (
                      <button
                        onClick={() => {
                          setAnulando(true);
                          setMensajeAnular(null);
                        }}
                        className="w-full text-sm font-semibold text-red-600 border border-red-200 rounded-lg py-2 hover:bg-red-50"
                      >
                        Anular venta
                      </button>
                    ) : (
                      <div className="border border-red-200 bg-red-50 rounded-xl p-3.5">
                        <p className="text-sm font-semibold text-red-700 mb-1">¿Anular esta venta?</p>
                        <p className="text-xs text-red-600 mb-2.5">
                          Se repone el stock vendido y se revierten los puntos, referidos o canjes que haya generado.
                          {ventaSeleccionada.medio_pago === "MERCADO_PAGO" &&
                            " El reintegro al cliente por Mercado Pago hay que hacerlo aparte, esto no lo hace solo."}
                        </p>
                        <textarea
                          value={motivoAnular}
                          onChange={(e) => setMotivoAnular(e.target.value)}
                          placeholder="Motivo de la anulación (obligatorio)"
                          rows={2}
                          className="w-full border border-neutral-300 rounded-lg px-2.5 py-2 text-sm mb-2.5"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleAnularVenta}
                            disabled={procesandoAnular || !motivoAnular.trim()}
                            className="flex-1 text-sm font-semibold text-white bg-red-600 rounded-lg py-2 disabled:opacity-50"
                          >
                            {procesandoAnular ? "Anulando…" : "Confirmar anulación"}
                          </button>
                          <button
                            onClick={() => {
                              setAnulando(false);
                              setMotivoAnular("");
                            }}
                            disabled={procesandoAnular}
                            className="text-sm font-semibold text-neutral-500 px-3"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {mensajeAnular && (
                  <p
                    className={`text-xs mt-2.5 ${mensajeAnular.tipo === "error" ? "text-red-600" : "text-amber-700"}`}
                  >
                    {mensajeAnular.texto}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
