"use client";

import { useEffect, useMemo, useState } from "react";
import { calcularResumenVentas, type LineaResumenVentas } from "@/app/(app)/resumen-ventas/actions";

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function primerDiaDelMes() {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ResumenVentasApp() {
  const [fechaDesde, setFechaDesde] = useState(primerDiaDelMes());
  const [fechaHasta, setFechaHasta] = useState(hoyISO());
  const [cargando, setCargando] = useState(false);
  const [lineas, setLineas] = useState<LineaResumenVentas[]>([]);
  const [posibleTruncado, setPosibleTruncado] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"TODOS" | "PROPIA" | "CONSIGNACION">("TODOS");

  const lineasFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return lineas.filter((l) => {
      if (filtroTipo !== "TODOS" && l.tipoComercializacion !== filtroTipo) return false;
      if (q && !l.nombreProducto.toLowerCase().includes(q) && !l.marca.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lineas, busqueda, filtroTipo]);

  // Los totales de arriba reflejan lo filtrado, no siempre el período
  // entero — así buscar un producto puntual también muestra su propio total.
  const totalFacturadoFiltrado = useMemo(() => lineasFiltradas.reduce((acc, l) => acc + l.totalFacturado, 0), [lineasFiltradas]);
  const totalMargenFiltrado = useMemo(() => lineasFiltradas.reduce((acc, l) => acc + l.margen, 0), [lineasFiltradas]);
  const hayFiltroActivo = busqueda.trim() !== "" || filtroTipo !== "TODOS";

  useEffect(() => {
    if (!fechaDesde || !fechaHasta) return;
    setCargando(true);
    calcularResumenVentas(fechaDesde, fechaHasta)
      .then((r) => {
        setLineas(r.lineas);
        setPosibleTruncado(r.posibleTruncado);
      })
      .finally(() => setCargando(false));
  }, [fechaDesde, fechaHasta]);

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Resumen de ventas</h1>
      <p className="text-sm text-neutral-500 mb-4 max-w-2xl">
        Todo lo vendido en el rango elegido, agrupado por producto — mezcla marca propia, proveedores y marcas en
        consignación. En consignación el margen es el royalty (WiiGo no compra esa mercadería); en marca propia y
        proveedores es venta menos costo.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Desde</label>
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Hasta</label>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {posibleTruncado && (
        <p className="text-xs font-semibold text-amber-700 mb-3">
          ⚠ Hay muchas ventas en este rango — se están contando las 3000 más recientes. Achicá el rango de fechas para
          ver el total exacto.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400 mb-0.5">
            Total facturado{hayFiltroActivo ? " (filtrado)" : ""}
          </p>
          <p className="text-xl font-extrabold text-neutral-900">${formatearMonto(totalFacturadoFiltrado)}</p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400 mb-0.5">
            Margen total{hayFiltroActivo ? " (filtrado)" : ""}
          </p>
          <p className="text-xl font-extrabold text-emerald-700">${formatearMonto(totalMargenFiltrado)}</p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400 mb-0.5">Margen %</p>
          <p className="text-xl font-extrabold text-neutral-900">
            {totalFacturadoFiltrado > 0 ? ((totalMargenFiltrado / totalFacturadoFiltrado) * 100).toFixed(1) : "0.0"}%
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          type="search"
          placeholder="Buscar por producto o marca..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="flex-1 min-w-[200px] border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
        />
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value as "TODOS" | "PROPIA" | "CONSIGNACION")}
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="TODOS">Todos los tipos</option>
          <option value="PROPIA">Propia / Proveedores</option>
          <option value="CONSIGNACION">Consignación</option>
        </select>
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-16">Calculando...</p>
        ) : lineas.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-16">No hay ventas pagadas en este rango.</p>
        ) : lineasFiltradas.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-16">No hay productos que coincidan con la búsqueda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Producto</th>
                  <th className="p-3">Marca</th>
                  <th className="p-3 text-right">Cant.</th>
                  <th className="p-3 text-right">Total facturado</th>
                  <th className="p-3 text-right">Costo</th>
                  <th className="p-3 text-right">Margen</th>
                  <th className="p-3 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {lineasFiltradas.map((l) => (
                  <tr key={l.idProducto} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3 text-neutral-900">{l.nombreProducto}</td>
                    <td className="p-3 text-neutral-500">
                      {l.marca}
                      {l.tipoComercializacion === "CONSIGNACION" && (
                        <span className="ml-1.5 text-[10px] font-semibold text-purple-700 bg-purple-50 rounded-full px-1.5 py-0.5">
                          consignación
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums">{l.cantidadVendida}</td>
                    <td className="p-3 text-right tabular-nums font-medium">${formatearMonto(l.totalFacturado)}</td>
                    <td className="p-3 text-right tabular-nums text-neutral-400">
                      {l.costo > 0 ? `-$${formatearMonto(l.costo)}` : "—"}
                    </td>
                    <td className="p-3 text-right tabular-nums font-semibold text-emerald-700">${formatearMonto(l.margen)}</td>
                    <td className="p-3 text-right tabular-nums text-neutral-500">{l.margenPorcentaje.toFixed(1)}%</td>
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
