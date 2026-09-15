"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Local, Producto, VarianteProducto, Stock, OrdenCompraProveedor, DetalleOrdenCompra, DetalleRecepcionProveedor } from "@/lib/supabase";
import type { ProveedorConSaldo, MarcaEnLista } from "@/app/(app)/proveedores/actions";
import {
  cambiarEstadoProveedor,
  registrarPagoProveedor,
  obtenerUrlComprobanteProveedor,
  historialProveedorAction,
} from "@/app/(app)/proveedores/actions";
import ProveedorFormModal from "./ProveedorFormModal";
import DevolucionProveedorModal from "./DevolucionProveedorModal";
import FacturaPeriodoModal from "./FacturaPeriodoModal";
import LiquidacionProveedorModal from "./LiquidacionProveedorModal";
import FacturaLiquidacionModal from "./FacturaLiquidacionModal";
import { estaAbierta, RECIBIDA_PARCIAL } from "@/lib/estadosOrden";

// Los tres tonos no son decoración: marcan tres relaciones de plata
// distintas, y ayudan a no confundirse de grupo al escanear la lista.
const TONO_GRUPO = {
  violeta: { cab: "bg-violet-50 border-violet-200", texto: "text-violet-700" },
  ambar: { cab: "bg-amber-50 border-amber-200", texto: "text-amber-700" },
  azul: { cab: "bg-accent-tint border-blue-200", texto: "text-accent" },
} as const;

function GrupoProveedor({
  tono,
  titulo,
  como,
  cantidad,
  children,
}: {
  tono: keyof typeof TONO_GRUPO;
  titulo: string;
  como: string;
  cantidad: number;
  children: React.ReactNode;
}) {
  // Un grupo vacío no se muestra: si no tenés ningún proveedor tradicional,
  // un cartel diciéndolo todos los días es ruido.
  if (cantidad === 0) return null;
  const t = TONO_GRUPO[tono];
  return (
    <div className="border border-neutral-200 rounded-xl overflow-hidden">
      <div className={`px-4 py-2.5 border-b flex items-center gap-2.5 flex-wrap ${t.cab}`}>
        <span className="font-semibold text-sm text-neutral-900">{titulo}</span>
        <span className={`text-xs flex-1 ${t.texto}`}>{como}</span>
        <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 bg-white/70 ${t.texto}`}>{cantidad}</span>
      </div>
      {children}
    </div>
  );
}

function FilaProveedor({
  p,
  seleccionado,
  onClick,
  etiquetaPendiente,
}: {
  p: ProveedorConSaldo;
  seleccionado: boolean;
  onClick: () => void;
  etiquetaPendiente: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 flex-wrap px-4 py-3 border-t border-neutral-100 first:border-t-0 ${
        seleccionado ? "bg-accent-tint" : "hover:bg-neutral-50"
      }`}
    >
      <span className="flex-1 min-w-[190px]">
        <span className="block font-semibold text-neutral-900">
          {p.nombre}
          {p.estado === "INACTIVO" && <span className="ml-2 text-xs font-normal text-neutral-400">(inactivo)</span>}
        </span>
        <span className="block text-xs text-neutral-400">
          {MODO_LABEL[p.modo_facturacion] ?? p.modo_facturacion}
          {p.condicion_pago_dias ? ` · ${p.condicion_pago_dias} días` : " · contado"}
          {p.cuit ? ` · CUIT ${p.cuit}` : ""}
        </span>
      </span>
      {p.pendientesFacturar > 0 && (
        <span className="text-[10.5px] font-bold bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
          {p.pendientesFacturar} {etiquetaPendiente}
        </span>
      )}
      {/* Con liquidación por venta el saldo es $0 hasta que se liquida, así
          que mostrar solo eso decía "al día" aunque le hubieras vendido medio
          depósito. Lo que se acumula va acá, al lado. */}
      {p.vendidoSinLiquidar > 0 && (
        <span className="text-right min-w-[104px]">
          <span className="block font-semibold tabular-nums text-amber-700">
            ${formatearMonto(p.vendidoSinLiquidar)}
          </span>
          <span className="block text-[10.5px] text-amber-700">
            vendido · {p.unidadesSinLiquidar} un.
          </span>
        </span>
      )}
      <span className="text-right min-w-[92px]">
        <span className={`block font-semibold tabular-nums ${p.saldo > 0 ? "text-red-600" : "text-neutral-900"}`}>
          ${formatearMonto(p.saldo)}
        </span>
        <span className="block text-[10.5px] text-neutral-400">
          {p.saldo > 0 ? "le debés" : p.vendidoSinLiquidar > 0 ? "sin liquidar" : "al día"}
        </span>
      </span>
      <span className="text-neutral-300">›</span>
    </button>
  );
}

const MODO_LABEL: Record<string, string> = {
  REMITO: "Factura por orden puntual",
  PERIODO: "Factura por período",
  LIQUIDACION_VENTA: "Liquidación por venta",
};

const MEDIO_PAGO_LABEL: Record<string, string> = {
  EFECTIVO_TURNO: "💵 Efectivo del turno",
  EFECTIVO_ADMIN: "🔒 Caja Administración",
  TRANSFERENCIA: "🏦 Transferencia",
  MERCADO_PAGO: "💳 Mercado Pago / Tarjeta",
};

const TIPO_MOVIMIENTO_LABEL: Record<string, string> = {
  FACTURA_COMPRA: "Factura de compra",
  LIQUIDACION: "Liquidación",
  PAGO: "Pago",
  NOTA_CREDITO: "Nota de crédito",
  AJUSTE: "Ajuste",
};

type FiltroEstado = "TODOS" | "CON_DEUDA" | "AL_DIA";
type Orden = "SALDO_DESC" | "NOMBRE";

export const ESTADO_ESTILO_COMPRA: Record<string, string> = {
  PENDIENTE: "bg-amber-50 text-amber-700",
  // Llegó una parte: sigue abierto, por eso comparte el ámbar de lo pendiente.
  RECIBIDA_PARCIAL: "bg-amber-50 text-amber-700",
  RECIBIDA: "bg-emerald-50 text-emerald-700",
  RECIBIDA_CON_DIFERENCIAS: "bg-red-50 text-red-700",
  CERRADA_INCOMPLETA: "bg-red-50 text-red-700",
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
  recepciones,
  turnosAbiertos,
  marcasEnLista,
}: {
  proveedores: ProveedorConSaldo[];
  esAdmin: boolean;
  locales: Local[];
  productos: Producto[];
  variantes: VarianteProducto[];
  stock: Stock[];
  recepciones: { id_orden: string; facturada: boolean }[];
  turnosAbiertos: { id_turno: string; id_local: string }[];
  marcasEnLista: MarcaEnLista[];
}) {
  // ---------- Cuenta corriente ----------
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("TODOS");
  const [orden, setOrden] = useState<Orden>("SALDO_DESC");
  const [idSeleccionado, setIdSeleccionado] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState<"NUEVO" | "EDITAR" | null>(null);
  const [nuevaOrdenPara, setNuevaOrdenPara] = useState<string | null>(null);
  const [mostrarPagoForm, setMostrarPagoForm] = useState(false);
  // Sube al guardar un pago: es la señal para que la lista de movimientos
  // vuelva a pedir los datos y el pago recién hecho aparezca al toque.
  const [versionHistorial, setVersionHistorial] = useState(0);

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
  // En las marcas el signo va al revés: saldo positivo es plata que te deben.
  const aFavorMarcas = marcasEnLista.reduce((acc, m) => acc + Math.max(m.saldo, 0), 0);
  const marcasConSaldo = marcasEnLista.filter((m) => m.saldo > 0).length;
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

  const [facturaPeriodoAbierta, setFacturaPeriodoAbierta] = useState(false);
  const [liquidacionAbierta, setLiquidacionAbierta] = useState(false);
  const [facturaLiquidacionAbierta, setFacturaLiquidacionAbierta] = useState(false);
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

  // 21% cuando el producto todavía no tiene alícuota cargada: es la general,
  // y los del 10,5% se marcan a mano al costear.
  // Los dos tipos de proveedor de verdad, separados por su modo de
  // facturación — que es lo que define cuándo se le debe la plata.
  const porLiquidacion = useMemo(
    () => filtrados.filter((p) => p.modo_facturacion === "LIQUIDACION_VENTA"),
    [filtrados]
  );
  const tradicionales = useMemo(
    () => filtrados.filter((p) => p.modo_facturacion !== "LIQUIDACION_VENTA"),
    [filtrados]
  );

  // Las marcas siguen el mismo buscador que los proveedores, pero no los
  // filtros de deuda: su saldo va al revés y "con deuda" ahí significaría
  // otra cosa.
  const marcasFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return marcasEnLista;
    return marcasEnLista.filter((m) => m.nombre.toLowerCase().includes(q));
  }, [marcasEnLista, busqueda]);

  const ivaActualPorVariante = useMemo(() => {
    const map = new Map<string, number>();
    filasCatalogo.forEach((f) => {
      map.set(f.variante.id_variante, f.producto.iva_porcentaje ?? 21);
    });
    return map;
  }, [filasCatalogo]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-neutral-900">Proveedores</h1>
        {esAdmin && (
          <button
            onClick={() => setModalAbierto("NUEVO")}
            className="bg-accent hover:bg-accent-dark text-white text-sm font-semibold px-3.5 py-2 rounded-lg"
          >
            + Nuevo proveedor
          </button>
        )}
      </div>
      {/* La plata partida en dos. Antes acá iba un solo renglón con la deuda a
          proveedores, y lo que las marcas te deben —que suele ser mucho más—
          no aparecía en ningún total, aunque las marcas estén en esta misma
          lista. Son dos plata que van en direcciones opuestas y no se pueden
          sumar ni leer juntas. */}
      <div className="grid sm:grid-cols-2 gap-2.5 mb-4">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-red-700">Le debés a proveedores</p>
          <p className="text-2xl font-extrabold text-red-700 tabular-nums">${formatearMonto(deudaTotal)}</p>
          <p className="text-xs text-red-700/70">
            {conDeuda === 0
              ? "Ninguno con deuda"
              : `${conDeuda} proveedor${conDeuda === 1 ? "" : "es"}`}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-emerald-700">Te deben las marcas</p>
          <p className="text-2xl font-extrabold text-emerald-700 tabular-nums">${formatearMonto(aFavorMarcas)}</p>
          <p className="text-xs text-emerald-700/70">
            {marcasConSaldo === 0
              ? "Ninguna con saldo"
              : `${marcasConSaldo} marca${marcasConSaldo === 1 ? "" : "s"} en consignación`}
          </p>
        </div>
      </div>
      {totalPendientesFacturar > 0 && (
        <p className="text-sm font-semibold text-amber-700 mb-4">
          ⚠ {totalPendientesFacturar} recepción{totalPendientesFacturar === 1 ? "" : "es"} sin facturar todavía
        </p>
      )}

      {/* La pestaña "Órdenes de compra" vivía acá y se fue entera a Compras.
          No era solo un duplicado de la lista: tenía un botón "Facturar" que
          cargaba la factura SIN los costos de los lotes, así que una recepción
          facturada por ahí quedaba con el FIFO vacío y la liquidación después
          salía estimada. En Compras → Costeo las dos cosas van juntas, que es
          la única forma en que el número cierra. */}
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
            {/* El panel de la derecha más ancho que la lista, no al revés: la
                lista son nombres cortos, y el panel es donde está todo lo que
                hay que leer. En 340px los movimientos no entraban. */}
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] min-h-[380px]">
              {/* Agrupados por CÓMO se le paga a cada uno, no alfabético:
                  lo que los diferencia no es el nombre, es en qué momento se
                  le debe la plata. Y el signo va al revés según el grupo —
                  las marcas te deben a vos, los proveedores les debés vos.
                  Por eso el saldo dice "te deben" o "le debés": el número
                  solo significa cosas opuestas. */}
              <div className="p-3 space-y-3">
                {marcasFiltradas.length === 0 && filtrados.length === 0 ? (
                  <p className="text-sm text-neutral-400 text-center py-16">No hay nadie para estos filtros.</p>
                ) : (
                  <>
                    <GrupoProveedor
                      tono="violeta"
                      titulo="Marcas en consignación"
                      como="Cobrás un royalty · el precio lo pone la marca"
                      cantidad={marcasFiltradas.length}
                    >
                      {marcasFiltradas.map((m) => (
                        <Link
                          key={m.idMarca}
                          href={`/marcas/${m.idMarca}`}
                          className="flex items-center gap-3 flex-wrap px-4 py-3 border-t border-neutral-100 first:border-t-0 hover:bg-neutral-50"
                        >
                          <span className="flex-1 min-w-[190px]">
                            <span className="block font-semibold text-neutral-900">{m.nombre}</span>
                            <span className="block text-xs text-neutral-400">
                              Royalty {m.royalty}% · plan {m.plan.charAt(0) + m.plan.slice(1).toLowerCase()}
                            </span>
                          </span>
                          {m.solicitudesPendientes > 0 && (
                            <span className="text-[10.5px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                              {m.solicitudesPendientes} {m.solicitudesPendientes === 1 ? "solicitud" : "solicitudes"}
                            </span>
                          )}
                          <span className="text-right min-w-[92px]">
                            <span className="block font-semibold tabular-nums">${formatearMonto(Math.abs(m.saldo))}</span>
                            <span className="block text-[10.5px] text-neutral-400">
                              {m.saldo > 0 ? "te deben" : m.saldo < 0 ? "le debés" : "sin saldo"}
                            </span>
                          </span>
                          <span className="text-xs font-semibold text-accent whitespace-nowrap">Ver en Marcas →</span>
                        </Link>
                      ))}
                    </GrupoProveedor>

                    <GrupoProveedor
                      tono="ambar"
                      titulo="Consignación con costo tuyo"
                      como="Le pagás el costo de lo vendido · el precio lo ponés vos"
                      cantidad={porLiquidacion.length}
                    >
                      {porLiquidacion.map((p) => (
                        <FilaProveedor
                          key={p.id_proveedor}
                          p={p}
                          seleccionado={seleccionado?.id_proveedor === p.id_proveedor}
                          onClick={() => setIdSeleccionado(p.id_proveedor)}
                          etiquetaPendiente="sin costear"
                        />
                      ))}
                    </GrupoProveedor>

                    <GrupoProveedor
                      tono="azul"
                      titulo="Compra tradicional"
                      como="La mercadería es tuya desde que entra"
                      cantidad={tradicionales.length}
                    >
                      {tradicionales.map((p) => (
                        <FilaProveedor
                          key={p.id_proveedor}
                          p={p}
                          seleccionado={seleccionado?.id_proveedor === p.id_proveedor}
                          onClick={() => setIdSeleccionado(p.id_proveedor)}
                          etiquetaPendiente="sin facturar"
                        />
                      ))}
                    </GrupoProveedor>

                    <p className="text-xs text-neutral-400 px-1">
                      Las marcas se ven acá para tener la foto completa de quién te provee, pero se manejan en su
                      propia pantalla.
                    </p>
                  </>
                )}
              </div>

              <div className="border-t md:border-t-0 md:border-l border-neutral-200 p-5">
                {!seleccionado ? (
                  <p className="text-sm text-neutral-400 text-center py-10">Elegí un proveedor de la lista.</p>
                ) : (
                  <div>
                    <div className="flex items-baseline justify-between mb-1 gap-2">
                      <h3 className="font-bold text-neutral-900">{seleccionado.nombre}</h3>
                      <span className="flex items-center gap-2.5 shrink-0">
                        {/* Todo lo suyo junto: entregas con su costo, qué le
                            comprás y la cuenta. Hoy eso está en tres lados. */}
                        <Link
                          href={`/proveedor/${seleccionado.id_proveedor}`}
                          className="text-xs font-semibold text-accent"
                        >
                          Ver ficha
                        </Link>
                        {esAdmin && (
                          <button onClick={() => setModalAbierto("EDITAR")} className="text-xs font-semibold text-accent">
                            Editar
                          </button>
                        )}
                      </span>
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

                    {/* Lo que se viene. Con liquidación por venta el saldo de
                        arriba es $0 hasta que se liquida — este es el número
                        que dice cuánto se le va a deber. */}
                    {seleccionado.vendidoSinLiquidar > 0 && (
                      <div className="rounded-xl p-4 mb-4 bg-amber-50 border border-amber-200">
                        <p className="text-[11px] font-bold uppercase tracking-wide mb-0.5 text-amber-800">
                          Vendido sin liquidar
                        </p>
                        <p className="text-2xl font-extrabold text-amber-800">
                          ${formatearMonto(seleccionado.vendidoSinLiquidar)}
                        </p>
                        <p className="text-[11px] text-amber-700 mt-1">
                          {seleccionado.unidadesSinLiquidar} unidades suyas ya vendidas. Todavía no es deuda: pasa al
                          saldo cuando generes la liquidación. Aproximado — el exacto sale ahí.
                        </p>
                      </div>
                    )}

                    {esAdmin && (
                      <div className="flex flex-col gap-2 mb-4">
                        {/* "Orden de compra" vivía acá y se fue a Compras →
                            Órdenes de compra, que es su lugar desde que
                            existe ese módulo. Dos puertas para lo mismo
                            terminan en que nadie sabe cuál es la buena. */}
                        {seleccionado.modo_facturacion === "PERIODO" && (
                          <button
                            onClick={() => setFacturaPeriodoAbierta(true)}
                            className="w-full text-sm font-semibold text-white bg-accent hover:bg-accent-dark rounded-lg py-2"
                          >
                            Cargar factura del período
                          </button>
                        )}
                        {seleccionado.modo_facturacion === "LIQUIDACION_VENTA" && (
                          <>
                            <button
                              onClick={() => setLiquidacionAbierta(true)}
                              className="w-full text-sm font-semibold text-white bg-accent hover:bg-accent-dark rounded-lg py-2"
                            >
                              Generar liquidación
                            </button>
                            {/* Después de liquidar, el proveedor factura ese
                                monto. Cargar esa factura es lo que hace nacer
                                el crédito fiscal — sin este paso, el IVA de
                                todo lo vendido de este proveedor no entra en
                                IVA a pagar. */}
                            <button
                              onClick={() => setFacturaLiquidacionAbierta(true)}
                              className="w-full text-sm font-semibold text-neutral-700 border border-neutral-300 rounded-lg py-2"
                            >
                              Cargar factura de una liquidación
                            </button>
                          </>
                        )}
                        {/* La única acción que mueve plata va primero y sola.
                            En modal y no acá adentro: en esta columna angosta
                            los medios de pago quedaban apilados en radios
                            minúsculos, con el monto peleando por lugar. */}
                        <button
                          onClick={() => setMostrarPagoForm(true)}
                          className="w-full text-sm font-semibold text-white bg-accent hover:bg-accent-dark rounded-lg py-2.5"
                        >
                          Registrar pago
                        </button>
                        <button
                          onClick={() => setDevolucionAbierta(true)}
                          className="w-full text-xs font-semibold text-neutral-500 border border-neutral-300 rounded-lg py-1.5 hover:bg-neutral-50"
                        >
                          Devolución
                        </button>
                      </div>
                    )}

                    <HistorialProveedor
                      key={`hist-${seleccionado.id_proveedor}`}
                      idProveedor={seleccionado.id_proveedor}
                      recargar={versionHistorial}
                    />

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

      {modalAbierto && (
        <ProveedorFormModal proveedor={modalAbierto === "EDITAR" ? seleccionado : null} onClose={() => setModalAbierto(null)} />
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

      {facturaLiquidacionAbierta && seleccionado && (
        <FacturaLiquidacionModal proveedor={seleccionado} onClose={() => setFacturaLiquidacionAbierta(false)} />
      )}

      {devolucionAbierta && seleccionado && (
        <DevolucionProveedorModal
          proveedor={seleccionado}
          locales={locales}
          filas={filasCatalogo}
          onClose={() => setDevolucionAbierta(false)}
        />
      )}

      {mostrarPagoForm && seleccionado && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
            <div className="px-6 pt-6 pb-4 border-b border-neutral-200 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">Registrar pago</h2>
                <p className="text-sm text-neutral-500 mt-0.5">
                  {seleccionado.nombre}
                  {seleccionado.saldo > 0
                    ? ` · le debés $${formatearMonto(seleccionado.saldo)}`
                    : " · está al día"}
                </p>
              </div>
              <button
                onClick={() => setMostrarPagoForm(false)}
                className="text-neutral-400 hover:text-neutral-700 text-xl leading-none"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <PagoProveedorForm
              key={seleccionado.id_proveedor}
              idProveedor={seleccionado.id_proveedor}
              saldo={seleccionado.saldo}
              locales={locales}
              turnosAbiertos={turnosAbiertos}
              onGuardado={() => {
                setMostrarPagoForm(false);
                setVersionHistorial((v) => v + 1);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const OPCIONES_MEDIO_PAGO = ["EFECTIVO_TURNO", "EFECTIVO_ADMIN", "TRANSFERENCIA", "MERCADO_PAGO"] as const;

function PagoProveedorForm({
  idProveedor,
  locales,
  saldo,
  turnosAbiertos,
  onGuardado,
}: {
  idProveedor: string;
  /** Lo que se le debe hoy, para el botón "Todo" y el saldo que queda. */
  saldo: number;
  locales: Local[];
  turnosAbiertos: { id_turno: string; id_local: string }[];
  onGuardado: () => void;
}) {
  const [monto, setMonto] = useState("");
  const [medioPago, setMedioPago] = useState<(typeof OPCIONES_MEDIO_PAGO)[number]>("TRANSFERENCIA");
  const [idLocal, setIdLocal] = useState(locales[0]?.id_local ?? "");
  const [descripcion, setDescripcion] = useState("");
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const turnoAbiertoDelLocal = turnosAbiertos.some((t) => t.id_local === idLocal);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("monto", monto);
    formData.set("medio_pago", medioPago);
    formData.set("descripcion", descripcion);
    if (medioPago === "EFECTIVO_TURNO") formData.set("id_local", idLocal);
    if (comprobante) formData.set("comprobante", comprobante);
    setGuardando(true);
    registrarPagoProveedor(idProveedor, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else onGuardado();
      })
      .finally(() => setGuardando(false));
  }

  const montoNum = Number(monto) || 0;
  const quedaDespues = saldo - montoNum;

  return (
    <form onSubmit={handleSubmit}>
      <div className="p-6 space-y-5">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        <div>
          <label className="block text-[10.5px] font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
            Cuánto le pagás
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min={0}
              step="0.01"
              required
              autoFocus
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0,00"
              className="flex-1 border border-neutral-300 rounded-lg px-3 py-2.5 text-lg font-bold text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {/* Pagar todo es lo que se hace casi siempre, y obligar a copiar
                el saldo a mano es la forma más fácil de que se pague de menos
                por un dígito. */}
            {saldo > 0 && (
              <button
                type="button"
                onClick={() => setMonto(String(saldo))}
                className="text-xs font-bold text-accent bg-accent-tint rounded-lg px-3 py-2.5 whitespace-nowrap"
              >
                Todo
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-[10.5px] font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
            De dónde sale
          </label>
          <div className="grid grid-cols-2 gap-2">
            {OPCIONES_MEDIO_PAGO.map((opcion) => {
              const bloqueada = opcion === "EFECTIVO_TURNO" && !turnoAbiertoDelLocal;
              return (
                <button
                  key={opcion}
                  type="button"
                  disabled={bloqueada}
                  onClick={() => setMedioPago(opcion)}
                  className={`text-left border rounded-lg px-3 py-2.5 text-xs font-semibold ${
                    medioPago === opcion
                      ? "border-accent bg-accent-tint text-accent"
                      : "border-neutral-300 text-neutral-600 hover:border-neutral-400"
                  } ${bloqueada ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  {MEDIO_PAGO_LABEL[opcion]}
                  {/* Si toca la caja o no es la diferencia real entre elegir
                      uno u otro, y era lo único que no se decía. */}
                  <span className="block text-[10px] font-normal opacity-70 mt-0.5">
                    {bloqueada
                      ? "no hay turno abierto"
                      : opcion === "EFECTIVO_TURNO"
                        ? "sale de la caja del local"
                        : opcion === "EFECTIVO_ADMIN"
                          ? "sale de la caja chica"
                          : "no toca caja"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {medioPago === "EFECTIVO_TURNO" && (
          <div>
            <label className="block text-[10.5px] font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
              De qué local
            </label>
            <select
              value={idLocal}
              onChange={(e) => setIdLocal(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              {locales.map((l) => (
                <option key={l.id_local} value={l.id_local}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-[10.5px] font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
            Descripción <span className="font-normal normal-case tracking-normal">(opcional)</span>
          </label>
          <input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Pago factura A1"
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <label className="flex items-center gap-2 border border-dashed border-neutral-300 rounded-lg px-3 py-2.5 text-sm bg-white cursor-pointer hover:border-neutral-400">
          📎
          <span className="truncate text-neutral-500">
            {comprobante ? comprobante.name : "Adjuntar comprobante (opcional)"}
          </span>
          <input
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => setComprobante(e.target.files?.[0] ?? null)}
          />
        </label>

        {montoNum > 0 && saldo > 0 && (
          <p
            className={`rounded-lg px-3.5 py-2.5 text-sm font-semibold ${
              quedaDespues <= 0 ? "bg-emerald-50 text-emerald-800" : "bg-neutral-100 text-neutral-700"
            }`}
          >
            {quedaDespues <= 0
              ? quedaDespues < 0
                ? `Le pagás $${formatearMonto(-quedaDespues)} de más: le va a quedar saldo a favor.`
                : "Después de este pago el saldo queda en $0."
              : `Después de este pago le vas a seguir debiendo $${formatearMonto(quedaDespues)}.`}
          </p>
        )}
      </div>

      <div className="px-6 pb-6 flex gap-2.5">
        <button
          type="button"
          onClick={onGuardado}
          disabled={guardando}
          className="flex-1 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={guardando}
          className="flex-1 rounded-lg bg-accent hover:bg-accent-dark px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {guardando ? "Guardando..." : "Registrar pago"}
        </button>
      </div>
    </form>
  );
}

type MovimientoHistorial = {
  idMovimiento: string;
  tipoMovimiento: string;
  importe: number;
  saldoNuevo: number;
  medioPago: string | null;
  /** El del pago, o el de la factura si el movimiento nació de una. */
  comprobantePath: string | null;
  numeroFactura: string | null;
  tipoComprobante: string | null;
  vencimiento: string | null;
  usuario: string | null;
  observaciones: string | null;
  fecha: string;
};

/**
 * La cuenta corriente propiamente dicha.
 *
 * Abierta por defecto, y no detrás de un "▸ Historial": una cuenta corriente
 * sin los movimientos no es una cuenta corriente. El saldo solo dice cuánto;
 * estos renglones dicen por qué, que es lo que hace falta cuando el proveedor
 * discute un número.
 */
function HistorialProveedor({ idProveedor, recargar }: { idProveedor: string; recargar: number }) {
  const [cargando, setCargando] = useState(true);
  const [historial, setHistorial] = useState<MovimientoHistorial[]>([]);

  useEffect(() => {
    setCargando(true);
    historialProveedorAction(idProveedor)
      .then(setHistorial)
      .finally(() => setCargando(false));
  }, [idProveedor, recargar]);

  function handleVerComprobante(path: string) {
    obtenerUrlComprobanteProveedor(path).then((url) => window.open(url, "_blank"));
  }

  return (
    <div className="border border-neutral-200 rounded-xl overflow-hidden">
      <div className="px-3.5 py-2.5 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Movimientos</p>
        {historial.length > 0 && (
          <span className="text-[11px] text-neutral-400">{historial.length}</span>
        )}
      </div>

      {cargando ? (
        <p className="text-xs text-neutral-400 text-center py-6">Cargando...</p>
      ) : historial.length === 0 ? (
        <p className="text-xs text-neutral-400 text-center py-6">
          Todavía no hay movimientos. Nacen con la primera factura o liquidación.
        </p>
      ) : (
        /* Bloques apilados y no una tabla: tres columnas en un panel angosto
           se cortan de costado, y lo primero que sale de pantalla es el
           importe — que es lo único que se mira. Apilado entra a cualquier
           ancho, en el celular también. */
        <div>
          {historial.map((m) => (
            <div key={m.idMovimiento} className="px-3.5 py-2.5 border-b border-neutral-100 last:border-0">
              <div className="flex items-baseline justify-between gap-2.5">
                <span className="text-[13px] font-semibold text-neutral-900">
                  {TIPO_MOVIMIENTO_LABEL[m.tipoMovimiento] ?? m.tipoMovimiento}
                  {m.numeroFactura && ` ${m.tipoComprobante ?? ""} #${m.numeroFactura}`}
                </span>
                <span
                  className={`text-[13.5px] font-bold tabular-nums whitespace-nowrap ${
                    m.importe >= 0 ? "text-red-600" : "text-emerald-600"
                  }`}
                >
                  {m.importe >= 0 ? "+" : ""}${formatearMonto(m.importe)}
                </span>
              </div>

              <p className="text-[11px] text-neutral-400 mt-0.5">
                {new Date(m.fecha).toLocaleDateString("es-AR")}
                {m.medioPago && ` · ${MEDIO_PAGO_LABEL[m.medioPago] ?? m.medioPago}`}
                {m.vencimiento && ` · vence ${new Date(`${m.vencimiento}T12:00:00`).toLocaleDateString("es-AR")}`}
                {m.usuario && ` · ${m.usuario}`}
              </p>
              {m.observaciones && <p className="text-[11px] text-neutral-400">{m.observaciones}</p>}

              <div className="flex items-center justify-between gap-2.5 mt-1.5">
                {/* El papel, o el aviso de que falta. Que se note cuál no lo
                    tiene es el punto: así se sabe qué ir a buscar antes de
                    que lo pida el contador. */}
                {m.comprobantePath ? (
                  <button
                    onClick={() => handleVerComprobante(m.comprobantePath!)}
                    className="text-[10.5px] font-semibold text-accent bg-accent-tint rounded-full px-2 py-0.5 whitespace-nowrap"
                  >
                    📎 Ver
                  </button>
                ) : (
                  <span className="text-[10.5px] text-neutral-300 whitespace-nowrap">sin adjunto</span>
                )}
                <span className="text-[11px] text-neutral-400 whitespace-nowrap">
                  saldo{" "}
                  <b className="text-neutral-900 font-bold tabular-nums">${formatearMonto(m.saldoNuevo)}</b>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
