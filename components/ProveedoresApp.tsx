"use client";

import { useMemo, useState } from "react";
import type { Local, Producto, VarianteProducto, Stock, OrdenCompraProveedor, DetalleOrdenCompra, DetalleRecepcionProveedor } from "@/lib/supabase";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import { cambiarEstadoProveedor } from "@/app/(app)/proveedores/actions";
import ProveedorFormModal from "./ProveedorFormModal";
import NuevaOrdenCompraModal from "./NuevaOrdenCompraModal";
import RecepcionCompraModal from "./RecepcionCompraModal";
import DevolucionProveedorModal from "./DevolucionProveedorModal";
import CostosRecepcionModal from "./CostosRecepcionModal";
import FacturaOrdenModal from "./FacturaOrdenModal";
import FacturaPeriodoModal from "./FacturaPeriodoModal";
import LiquidacionProveedorModal from "./LiquidacionProveedorModal";

const MODO_LABEL: Record<string, string> = {
  REMITO: "Factura por orden puntual",
  PERIODO: "Factura por período",
  LIQUIDACION_VENTA: "Liquidación por venta",
};

type FiltroEstado = "TODOS" | "CON_DEUDA" | "AL_DIA";
type Orden = "SALDO_DESC" | "NOMBRE";
type Tab = "CUENTAS" | "ORDENES";
type TabOrdenes = "TODAS" | "PENDIENTE" | "RECIBIDA_CON_DIFERENCIAS" | "RECIBIDA";

export const ESTADO_ESTILO_COMPRA: Record<string, string> = {
  PENDIENTE: "bg-amber-50 text-amber-700",
  RECIBIDA: "bg-emerald-50 text-emerald-700",
  RECIBIDA_CON_DIFERENCIAS: "bg-red-50 text-red-700",
};

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

export default function ProveedoresApp({
  proveedores,
  esAdmin,
  locales,
  productos,
  variantes,
  stock,
  ordenes,
  detalleOrdenes,
  reclamos,
  recepciones,
}: {
  proveedores: ProveedorConSaldo[];
  esAdmin: boolean;
  locales: Local[];
  productos: Producto[];
  variantes: VarianteProducto[];
  stock: Stock[];
  ordenes: OrdenCompraProveedor[];
  detalleOrdenes: DetalleOrdenCompra[];
  reclamos: DetalleRecepcionProveedor[];
  recepciones: { id_orden: string; facturada: boolean }[];
}) {
  const [tab, setTab] = useState<Tab>("CUENTAS");

  // ---------- Cuenta corriente ----------
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("TODOS");
  const [orden, setOrden] = useState<Orden>("SALDO_DESC");
  const [idSeleccionado, setIdSeleccionado] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState<"NUEVO" | "EDITAR" | null>(null);
  const [nuevaOrdenPara, setNuevaOrdenPara] = useState<string | null>(null);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    let lista = proveedores.filter((p) => {
      if (q && !p.nombre.toLowerCase().includes(q) && !(p.cuit ?? "").toLowerCase().includes(q)) return false;
      if (filtroEstado === "CON_DEUDA" && p.saldo <= 0) return false;
      if (filtroEstado === "AL_DIA" && p.saldo > 0) return false;
      return true;
    });
    lista = [...lista].sort((a, b) => (orden === "SALDO_DESC" ? b.saldo - a.saldo : a.nombre.localeCompare(b.nombre)));
    return lista;
  }, [proveedores, busqueda, filtroEstado, orden]);

  const seleccionado = filtrados.find((p) => p.id_proveedor === idSeleccionado) ?? null;

  const deudaTotal = proveedores.reduce((acc, p) => acc + Math.max(p.saldo, 0), 0);
  const conDeuda = proveedores.filter((p) => p.saldo > 0).length;
  const totalPendientesFacturar = proveedores.reduce((acc, p) => acc + p.pendientesFacturar, 0);

  const facturadaPorOrden = useMemo(() => {
    const map = new Map<string, boolean>();
    recepciones.forEach((r) => map.set(r.id_orden, r.facturada));
    return map;
  }, [recepciones]);

  function handleCambiarEstado(p: ProveedorConSaldo) {
    const nuevo = p.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO";
    cambiarEstadoProveedor(p.id_proveedor, nuevo).catch(() => {});
  }

  // ---------- Órdenes de compra ----------
  const [tabOrdenes, setTabOrdenes] = useState<TabOrdenes>("TODAS");
  const [nuevaOrdenAbierta, setNuevaOrdenAbierta] = useState(false);
  const [ordenAbierta, setOrdenAbierta] = useState<OrdenCompraProveedor | null>(null);
  const [facturaOrdenAbierta, setFacturaOrdenAbierta] = useState<OrdenCompraProveedor | null>(null);
  const [costosOrdenAbierta, setCostosOrdenAbierta] = useState<OrdenCompraProveedor | null>(null);
  const [facturaPeriodoAbierta, setFacturaPeriodoAbierta] = useState(false);
  const [liquidacionAbierta, setLiquidacionAbierta] = useState(false);
  const [devolucionAbierta, setDevolucionAbierta] = useState(false);

  const proveedorPorId = useMemo(() => new Map(proveedores.map((p) => [p.id_proveedor, p])), [proveedores]);
  const localPorId = useMemo(() => new Map(locales.map((l) => [l.id_local, l])), [locales]);
  const productoPorId = useMemo(() => new Map(productos.map((p) => [p.id_producto, p])), [productos]);
  const stockPorClave = useMemo(() => {
    const map = new Map<string, number>();
    stock.forEach((s) => map.set(`${s.id_variante}_${s.id_local}`, s.cantidad));
    return map;
  }, [stock]);

  const filasCatalogo = useMemo(() => {
    return variantes
      .map((variante) => {
        const producto = productoPorId.get(variante.id_producto);
        if (!producto) return null;
        return { variante, producto };
      })
      .filter((f): f is { variante: VarianteProducto; producto: Producto } => f !== null);
  }, [variantes, productoPorId]);

  const nombrePorVariante = useMemo(() => {
    const map = new Map<string, string>();
    filasCatalogo.forEach((f) => {
      map.set(f.variante.id_variante, `${f.producto.nombre}${f.variante.nombre !== "Único" ? ` — ${f.variante.nombre}` : ""}`);
    });
    return map;
  }, [filasCatalogo]);

  const costoActualPorVariante = useMemo(() => {
    const map = new Map<string, number | null>();
    filasCatalogo.forEach((f) => {
      map.set(f.variante.id_variante, f.producto.costo_informado);
    });
    return map;
  }, [filasCatalogo]);

  const detalleDeOrden = useMemo(() => {
    const map = new Map<string, DetalleOrdenCompra[]>();
    detalleOrdenes.forEach((d) => {
      const grupo = map.get(d.id_orden) ?? [];
      grupo.push(d);
      map.set(d.id_orden, grupo);
    });
    return map;
  }, [detalleOrdenes]);

  const conteosOrdenes = useMemo(
    () => ({
      TODAS: ordenes.length,
      PENDIENTE: ordenes.filter((o) => o.estado === "PENDIENTE").length,
      RECIBIDA_CON_DIFERENCIAS: ordenes.filter((o) => o.estado === "RECIBIDA_CON_DIFERENCIAS").length,
      RECIBIDA: ordenes.filter((o) => o.estado === "RECIBIDA").length,
    }),
    [ordenes]
  );

  const ordenesFiltradas = useMemo(
    () => (tabOrdenes === "TODAS" ? ordenes : ordenes.filter((o) => o.estado === tabOrdenes)),
    [ordenes, tabOrdenes]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-neutral-900">Proveedores</h1>
        {esAdmin && tab === "CUENTAS" && (
          <button
            onClick={() => setModalAbierto("NUEVO")}
            className="bg-accent hover:bg-accent-dark text-white text-sm font-semibold px-3.5 py-2 rounded-lg"
          >
            + Nuevo proveedor
          </button>
        )}
        {esAdmin && tab === "ORDENES" && (
          <button
            onClick={() => setNuevaOrdenAbierta(true)}
            className="bg-accent hover:bg-accent-dark text-white text-sm font-semibold px-3.5 py-2 rounded-lg"
          >
            + Nueva orden de compra
          </button>
        )}
      </div>
      <div className="mb-4">
        <p className="text-sm text-neutral-500">
          {conDeuda} proveedor{conDeuda === 1 ? "" : "es"} con deuda · ${formatearMonto(deudaTotal)} en total
        </p>
        {totalPendientesFacturar > 0 && (
          <p className="text-sm font-semibold text-amber-700">
            ⚠ {totalPendientesFacturar} recepción{totalPendientesFacturar === 1 ? "" : "es"} sin facturar todavía
          </p>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <TabButton activo={tab === "CUENTAS"} onClick={() => setTab("CUENTAS")}>
          Cuenta corriente
        </TabButton>
        <TabButton activo={tab === "ORDENES"} onClick={() => setTab("ORDENES")}>
          Órdenes de compra {ordenes.length > 0 ? `(${ordenes.length})` : ""}
        </TabButton>
      </div>

      {tab === "CUENTAS" ? (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o CUIT..."
              className="flex-1 min-w-[220px] border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
            />
            {(
              [
                ["TODOS", "Todos"],
                ["CON_DEUDA", "Con deuda"],
                ["AL_DIA", "Al día"],
              ] as [FiltroEstado, string][]
            ).map(([valor, label]) => (
              <button
                key={valor}
                onClick={() => setFiltroEstado(valor)}
                className={`text-sm font-semibold px-3 py-2 rounded-lg border ${
                  filtroEstado === valor ? "bg-accent border-accent text-white" : "bg-white border-neutral-300 text-neutral-600"
                }`}
              >
                {label}
              </button>
            ))}
            <select
              value={orden}
              onChange={(e) => setOrden(e.target.value as Orden)}
              className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="SALDO_DESC">Ordenar: mayor deuda primero</option>
              <option value="NOMBRE">Nombre (A-Z)</option>
            </select>
          </div>

          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_340px] min-h-[380px]">
              <div className="overflow-x-auto">
                {filtrados.length === 0 ? (
                  <p className="text-sm text-neutral-400 text-center py-16">No hay proveedores para estos filtros.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                        <th className="p-3">Proveedor</th>
                        <th className="p-3">CUIT</th>
                        <th className="p-3">Cond. pago</th>
                        <th className="p-3 text-right">Saldo</th>
                        <th className="p-3">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtrados.map((p) => (
                        <tr
                          key={p.id_proveedor}
                          onClick={() => setIdSeleccionado(p.id_proveedor)}
                          className={`border-b border-neutral-100 last:border-0 cursor-pointer ${
                            seleccionado?.id_proveedor === p.id_proveedor ? "bg-accent-tint" : "hover:bg-neutral-50"
                          }`}
                        >
                          <td className="p-3 font-medium text-neutral-900">
                            {p.nombre}
                            {p.estado === "INACTIVO" && <span className="ml-2 text-xs text-neutral-400">(inactivo)</span>}
                            {p.pendientesFacturar > 0 && (
                              <span className="ml-2 text-xs font-semibold bg-amber-50 text-amber-700 rounded-full px-1.5 py-0.5">
                                {p.pendientesFacturar} sin facturar
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-neutral-500">{p.cuit ?? "—"}</td>
                          <td className="p-3 text-neutral-500">{p.condicion_pago_dias ? `${p.condicion_pago_dias} días` : "Contado"}</td>
                          <td className={`p-3 text-right tabular-nums font-semibold ${p.saldo > 0 ? "text-red-600" : "text-neutral-900"}`}>
                            ${formatearMonto(p.saldo)}
                          </td>
                          <td className="p-3">
                            <span
                              className={`text-xs rounded-full px-2 py-0.5 ${
                                p.saldo > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                              }`}
                            >
                              {p.saldo > 0 ? "Con deuda" : "Al día"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="border-t md:border-t-0 md:border-l border-neutral-200 p-5">
                {!seleccionado ? (
                  <p className="text-sm text-neutral-400 text-center py-10">Elegí un proveedor de la lista.</p>
                ) : (
                  <div>
                    <div className="flex items-baseline justify-between mb-1">
                      <h3 className="font-bold text-neutral-900">{seleccionado.nombre}</h3>
                      {esAdmin && (
                        <button onClick={() => setModalAbierto("EDITAR")} className="text-xs font-semibold text-accent">
                          Editar
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-neutral-500 mb-1">
                      {seleccionado.cuit ? `CUIT ${seleccionado.cuit}` : "Sin CUIT cargado"} ·{" "}
                      {seleccionado.condicion_pago_dias ? `${seleccionado.condicion_pago_dias} días` : "Contado"}
                    </p>
                    <p className="text-[11px] font-semibold text-accent mb-1">{MODO_LABEL[seleccionado.modo_facturacion] ?? seleccionado.modo_facturacion}</p>
                    {seleccionado.pendientesFacturar > 0 && (
                      <p className="text-[11px] font-semibold text-amber-700 mb-4">
                        ⚠ {seleccionado.pendientesFacturar} recepción{seleccionado.pendientesFacturar === 1 ? "" : "es"} sin facturar
                      </p>
                    )}
                    {seleccionado.pendientesFacturar === 0 && <div className="mb-4" />}

                    <div className={`rounded-xl p-4 mb-4 ${seleccionado.saldo > 0 ? "bg-red-50" : "bg-emerald-50"}`}>
                      <p className={`text-[11px] font-bold uppercase tracking-wide mb-0.5 ${seleccionado.saldo > 0 ? "text-red-700" : "text-emerald-700"}`}>
                        Saldo actual {seleccionado.saldo > 0 ? "(le debemos)" : ""}
                      </p>
                      <p className={`text-2xl font-extrabold ${seleccionado.saldo > 0 ? "text-red-700" : "text-emerald-700"}`}>
                        ${formatearMonto(seleccionado.saldo)}
                      </p>
                    </div>

                    {esAdmin && (
                      <div className="flex flex-col gap-2 mb-4">
                        <button
                          onClick={() => {
                            setNuevaOrdenPara(seleccionado.id_proveedor);
                            setNuevaOrdenAbierta(true);
                          }}
                          className="w-full text-sm font-semibold text-accent border border-accent/30 bg-accent-tint rounded-lg py-2"
                        >
                          + Orden de compra
                        </button>
                        {seleccionado.modo_facturacion === "PERIODO" && (
                          <button
                            onClick={() => setFacturaPeriodoAbierta(true)}
                            className="w-full text-sm font-semibold text-white bg-accent hover:bg-accent-dark rounded-lg py-2"
                          >
                            Cargar factura del período
                          </button>
                        )}
                        {seleccionado.modo_facturacion === "LIQUIDACION_VENTA" && (
                          <button
                            onClick={() => setLiquidacionAbierta(true)}
                            className="w-full text-sm font-semibold text-white bg-accent hover:bg-accent-dark rounded-lg py-2"
                          >
                            Generar liquidación
                          </button>
                        )}
                        <button
                          onClick={() => setDevolucionAbierta(true)}
                          className="w-full text-sm font-semibold text-neutral-600 border border-neutral-300 rounded-lg py-2"
                        >
                          + Devolución
                        </button>
                      </div>
                    )}

                    {seleccionado.contacto || seleccionado.telefono || seleccionado.email ? (
                      <div className="text-xs text-neutral-500 space-y-1 mb-4">
                        {seleccionado.contacto && <p>Contacto: {seleccionado.contacto}</p>}
                        {seleccionado.telefono && <p>Tel: {seleccionado.telefono}</p>}
                        {seleccionado.email && <p>{seleccionado.email}</p>}
                      </div>
                    ) : null}

                    {esAdmin && (
                      <button onClick={() => handleCambiarEstado(seleccionado)} className="text-xs font-semibold text-neutral-500">
                        {seleccionado.estado === "ACTIVO" ? "Marcar inactivo" : "Marcar activo"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {reclamos.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
              <p className="text-sm font-semibold text-red-800 mb-2">⚠ Diferencias sin resolver ({reclamos.length})</p>
              <ul className="text-sm text-red-800 space-y-1">
                {reclamos.map((r) => (
                  <li key={r.id_detalle}>
                    {nombrePorVariante.get(r.id_variante) ?? "Producto"}: pedido {r.cantidad_solicitada}, llegó {r.cantidad_recibida} (
                    {r.estado_control === "FALTANTE" ? "faltante" : "sobrante"} de {Math.abs(r.diferencia ?? 0)})
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-4">
            <TabButton activo={tabOrdenes === "TODAS"} onClick={() => setTabOrdenes("TODAS")}>
              Todas ({conteosOrdenes.TODAS})
            </TabButton>
            <TabButton activo={tabOrdenes === "PENDIENTE"} onClick={() => setTabOrdenes("PENDIENTE")}>
              Pendientes de recepcionar ({conteosOrdenes.PENDIENTE})
            </TabButton>
            <TabButton activo={tabOrdenes === "RECIBIDA_CON_DIFERENCIAS"} onClick={() => setTabOrdenes("RECIBIDA_CON_DIFERENCIAS")}>
              Con diferencias ({conteosOrdenes.RECIBIDA_CON_DIFERENCIAS})
            </TabButton>
            <TabButton activo={tabOrdenes === "RECIBIDA"} onClick={() => setTabOrdenes("RECIBIDA")}>
              Recibidas OK ({conteosOrdenes.RECIBIDA})
            </TabButton>
          </div>

          {ordenesFiltradas.length === 0 ? (
            <p className="text-sm text-neutral-500 py-12 text-center">
              {ordenes.length === 0 ? "Todavía no generaste ninguna orden de compra." : "No hay órdenes en esta categoría."}
            </p>
          ) : (
            <ul className="space-y-2">
              {ordenesFiltradas.map((o) => (
                <li key={o.id_orden} className="bg-white border border-neutral-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-neutral-900">{proveedorPorId.get(o.id_proveedor)?.nombre ?? "—"}</p>
                      <span className="text-xs font-mono text-neutral-400">#{o.id_orden.slice(0, 8).toUpperCase()}</span>
                      <span className={`text-xs rounded-full px-2 py-0.5 ${ESTADO_ESTILO_COMPRA[o.estado] ?? "bg-neutral-100 text-neutral-600"}`}>
                        {o.estado.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-500">
                      {localPorId.get(o.id_local)?.nombre ?? "—"} · {o.total_unidades} unidades ·{" "}
                      {new Date(o.fecha_alta).toLocaleDateString("es-AR")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {o.estado !== "PENDIENTE" && facturadaPorOrden.get(o.id_orden) && (
                      <span className="text-xs font-semibold text-emerald-600">✓ Facturada</span>
                    )}
                    {o.estado !== "PENDIENTE" &&
                      !facturadaPorOrden.get(o.id_orden) &&
                      esAdmin &&
                      proveedorPorId.get(o.id_proveedor)?.modo_facturacion === "REMITO" && (
                        <button onClick={() => setFacturaOrdenAbierta(o)} className="text-sm text-accent hover:underline">
                          Facturar
                        </button>
                      )}
                    {o.estado !== "PENDIENTE" &&
                      !facturadaPorOrden.get(o.id_orden) &&
                      esAdmin &&
                      proveedorPorId.get(o.id_proveedor)?.modo_facturacion === "LIQUIDACION_VENTA" && (
                        <button onClick={() => setCostosOrdenAbierta(o)} className="text-sm text-accent hover:underline">
                          Cargar factura
                        </button>
                      )}
                    <button onClick={() => setOrdenAbierta(o)} className="text-sm text-accent hover:underline">
                      {o.estado === "PENDIENTE" ? "Recepcionar" : "Ver"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {modalAbierto && (
        <ProveedorFormModal proveedor={modalAbierto === "EDITAR" ? seleccionado : null} onClose={() => setModalAbierto(null)} />
      )}

      {nuevaOrdenAbierta && (
        <NuevaOrdenCompraModal
          proveedores={proveedores}
          locales={locales}
          filas={filasCatalogo}
          cantidadPorClave={stockPorClave}
          proveedorInicial={nuevaOrdenPara ?? undefined}
          onClose={() => {
            setNuevaOrdenAbierta(false);
            setNuevaOrdenPara(null);
          }}
        />
      )}

      {ordenAbierta && (
        <RecepcionCompraModal
          orden={ordenAbierta}
          detalle={detalleDeOrden.get(ordenAbierta.id_orden) ?? []}
          proveedor={proveedorPorId.get(ordenAbierta.id_proveedor)}
          local={localPorId.get(ordenAbierta.id_local)}
          nombrePorVariante={nombrePorVariante}
          onClose={() => setOrdenAbierta(null)}
        />
      )}

      {facturaOrdenAbierta && (
        <FacturaOrdenModal
          orden={facturaOrdenAbierta}
          detalle={detalleDeOrden.get(facturaOrdenAbierta.id_orden) ?? []}
          proveedor={proveedorPorId.get(facturaOrdenAbierta.id_proveedor)}
          nombrePorVariante={nombrePorVariante}
          costoActualPorVariante={costoActualPorVariante}
          onClose={() => setFacturaOrdenAbierta(null)}
        />
      )}

      {costosOrdenAbierta && (
        <CostosRecepcionModal
          orden={costosOrdenAbierta}
          detalle={detalleDeOrden.get(costosOrdenAbierta.id_orden) ?? []}
          proveedor={proveedorPorId.get(costosOrdenAbierta.id_proveedor)}
          nombrePorVariante={nombrePorVariante}
          costoActualPorVariante={costoActualPorVariante}
          onClose={() => setCostosOrdenAbierta(null)}
        />
      )}

      {facturaPeriodoAbierta && seleccionado && (
        <FacturaPeriodoModal
          proveedor={seleccionado}
          nombrePorVariante={nombrePorVariante}
          costoActualPorVariante={costoActualPorVariante}
          onClose={() => setFacturaPeriodoAbierta(false)}
        />
      )}

      {liquidacionAbierta && seleccionado && (
        <LiquidacionProveedorModal proveedor={seleccionado} onClose={() => setLiquidacionAbierta(false)} />
      )}

      {devolucionAbierta && seleccionado && (
        <DevolucionProveedorModal
          proveedor={seleccionado}
          locales={locales}
          filas={filasCatalogo}
          onClose={() => setDevolucionAbierta(false)}
        />
      )}
    </div>
  );
}

function TabButton({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-sm rounded-full px-3 py-1.5 border ${
        activo ? "bg-accent text-white border-accent" : "bg-white text-neutral-600 border-neutral-300"
      }`}
    >
      {children}
    </button>
  );
}
