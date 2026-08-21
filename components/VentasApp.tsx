"use client";

import { useMemo, useState } from "react";
import type { Local, Venta, DetalleVenta, Producto, VarianteProducto, Marca, Cliente } from "@/lib/supabase";

type FiltroFecha = "HOY" | "SEMANA" | "MES" | "TODO" | "RANGO";
type FiltroCanal = "TODOS" | "SELF_CHECKOUT" | "POS";
type FiltroEstado = "TODOS" | "PENDIENTE_PAGO" | "PAGADA" | "CANCELADA";

const CANAL_LABEL: Record<string, string> = {
  SELF_CHECKOUT: "Self Checkout",
  POS: "Vender (POS)",
};

const ESTADO_ESTILO: Record<string, string> = {
  PENDIENTE_PAGO: "bg-amber-50 text-amber-700",
  PAGADA: "bg-emerald-50 text-emerald-700",
  CANCELADA: "bg-red-50 text-red-700",
};

const ESTADO_LABEL: Record<string, string> = {
  PENDIENTE_PAGO: "Pendiente",
  PAGADA: "Pagada",
  CANCELADA: "Cancelada",
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

function mismoDia(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fechaEnRango(fechaISO: string, filtro: FiltroFecha, desde: string, hasta: string) {
  if (filtro === "TODO") return true;
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
  const clave = fechaISO.slice(0, 10);
  return (!desde || clave >= desde) && (!hasta || clave <= hasta);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function VentasApp({
  locales,
  ventas,
  detalle,
  productos,
  variantes,
  marcas,
  clientes,
}: {
  locales: Local[];
  ventas: Venta[];
  detalle: DetalleVenta[];
  productos: Producto[];
  variantes: VarianteProducto[];
  marcas: Marca[];
  clientes: Cliente[];
}) {
  const [idLocal, setIdLocal] = useState<string>("TODOS");
  const [filtroCanal, setFiltroCanal] = useState<FiltroCanal>("TODOS");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("TODOS");
  const [filtroFecha, setFiltroFecha] = useState<FiltroFecha>("SEMANA");
  const [rangoDesde, setRangoDesde] = useState(hoyISO());
  const [rangoHasta, setRangoHasta] = useState(hoyISO());
  const [idVentaSeleccionada, setIdVentaSeleccionada] = useState<string | null>(null);

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

  const detallePorVenta = useMemo(() => {
    const map = new Map<string, DetalleVenta[]>();
    detalle.forEach((d) => {
      const grupo = map.get(d.id_venta) ?? [];
      grupo.push(d);
      map.set(d.id_venta, grupo);
    });
    return map;
  }, [detalle]);

  const ventasFiltradas = useMemo(() => {
    return ventas.filter((v) => {
      if (idLocal !== "TODOS" && v.id_local !== idLocal) return false;
      if (filtroCanal !== "TODOS" && v.canal !== filtroCanal) return false;
      if (filtroEstado !== "TODOS" && v.estado !== filtroEstado) return false;
      if (!fechaEnRango(v.fecha, filtroFecha, rangoDesde, rangoHasta)) return false;
      return true;
    });
  }, [ventas, idLocal, filtroCanal, filtroEstado, filtroFecha, rangoDesde, rangoHasta]);

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
  const detalleSeleccionado = ventaSeleccionada ? detallePorVenta.get(ventaSeleccionada.id_venta) ?? [] : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-neutral-900">Ventas</h1>
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        {resumen.cantidad} venta{resumen.cantidad === 1 ? "" : "s"} pagada{resumen.cantidad === 1 ? "" : "s"} · $
        {formatearMonto(resumen.totalBruto)}
      </p>

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
          <option value="PENDIENTE_PAGO">Pendiente</option>
          <option value="PAGADA">Pagada</option>
          <option value="CANCELADA">Cancelada</option>
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
                      onClick={() => setIdVentaSeleccionada(v.id_venta)}
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
