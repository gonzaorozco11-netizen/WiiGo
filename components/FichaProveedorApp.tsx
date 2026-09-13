"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { FichaProveedor } from "@/lib/fichaProveedor";

// La ficha de un proveedor. Solo muestra: ningún botón de acá escribe.
//
// Junta lo que estaba en tres pantallas porque es lo que hace falta junto
// cuando hay que discutir con el proveedor.

function monto(v: number) {
  return v.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function fechaCorta(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

const MODO_LABEL: Record<string, string> = {
  REMITO: "Factura por orden puntual",
  PERIODO: "Factura por período",
  LIQUIDACION_VENTA: "Liquidación por venta",
};

const TIPO_MOV: Record<string, string> = {
  FACTURA_COMPRA: "Factura de compra",
  LIQUIDACION: "Liquidación",
  PAGO: "Pago",
  NOTA_CREDITO: "Nota de crédito",
  AJUSTE: "Ajuste",
};

type FiltroEntrega = "TODAS" | "SIN_COSTEAR" | "CON_DIFERENCIAS";

export default function FichaProveedorApp({ ficha }: { ficha: FichaProveedor }) {
  const [filtro, setFiltro] = useState<FiltroEntrega>("TODAS");
  const [busqueda, setBusqueda] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);

  const entregas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return ficha.entregas.filter((e) => {
      if (filtro === "SIN_COSTEAR" && e.facturada) return false;
      if (
        filtro === "CON_DIFERENCIAS" &&
        e.estadoOrden !== "RECIBIDA_PARCIAL" &&
        e.estadoOrden !== "CERRADA_INCOMPLETA" &&
        e.estadoOrden !== "RECIBIDA_CON_DIFERENCIAS"
      ) {
        return false;
      }
      if (q && !e.idOrden.toLowerCase().includes(q) && !(e.numeroFactura ?? "").toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [ficha.entregas, filtro, busqueda]);

  const sinCostear = ficha.entregas.filter((e) => !e.facturada).length;

  const filtros: { clave: FiltroEntrega; texto: string }[] = [
    { clave: "TODAS", texto: "Todas" },
    { clave: "SIN_COSTEAR", texto: `Sin costear${sinCostear ? ` (${sinCostear})` : ""}` },
    { clave: "CON_DIFERENCIAS", texto: "Con diferencias" },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <style>{`@media print { .no-imprimir { display: none !important; } body { background: #fff; } }`}</style>

      <div className="flex items-start gap-3 flex-wrap mb-4">
        <div className="flex-1 min-w-[220px]">
          <Link href="/proveedores" className="text-xs font-semibold text-accent hover:underline no-imprimir">
            ← Volver a Proveedores
          </Link>
          <h1 className="text-xl font-semibold text-neutral-900 mt-1">{ficha.nombre}</h1>
          <p className="text-xs text-neutral-500">
            {MODO_LABEL[ficha.modoFacturacion] ?? ficha.modoFacturacion} ·{" "}
            {ficha.condicionPagoDias ? `${ficha.condicionPagoDias} días` : "contado"}
            {ficha.cuit ? ` · CUIT ${ficha.cuit}` : " · sin CUIT cargado"}
            {ficha.telefono ? ` · ${ficha.telefono}` : ""}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="no-imprimir text-sm font-semibold text-neutral-700 border border-neutral-300 rounded-lg px-3 py-1.5 hover:bg-neutral-50"
        >
          🖨 Imprimir
        </button>
      </div>

      {/* ---------- Los números ---------- */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-neutral-200 border border-neutral-200 rounded-xl overflow-hidden mb-5">
        <Cifra titulo="Entregas" valor={`${ficha.entregas.length}`} pie="en el período" />
        <Cifra titulo="Unidades" valor={`${ficha.totalUnidades}`} pie="recibidas" />
        <Cifra titulo="Le compraste" valor={`$${monto(ficha.totalComprado)}`} pie="costo neto" />
        <Cifra
          titulo="Sin liquidar"
          valor={`$${monto(ficha.vendidoSinLiquidar)}`}
          pie="ya vendido"
          tono={ficha.vendidoSinLiquidar > 0 ? "ambar" : undefined}
        />
        <Cifra
          titulo="Saldo"
          valor={`$${monto(ficha.saldo)}`}
          pie={ficha.saldo > 0 ? "le debés" : "al día"}
          tono={ficha.saldo > 0 ? "rojo" : undefined}
        />
      </div>

      {/* ---------- Entregas ---------- */}
      <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-neutral-100 flex items-baseline justify-between gap-3 flex-wrap">
          <p className="text-sm font-semibold text-neutral-900">Lo que entregó</p>
          <p className="text-xs text-neutral-500 tabular-nums">
            <b className="text-neutral-800">{entregas.length}</b> · $
            {monto(entregas.reduce((a, e) => a + (e.costo ?? 0), 0))}
          </p>
        </div>

        <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-100 flex items-center gap-2 flex-wrap no-imprimir">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por número de pedido o factura..."
            className="flex-1 min-w-[180px] text-xs rounded-lg border border-neutral-300 px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {filtros.map((f) => (
            <button
              key={f.clave}
              onClick={() => setFiltro(f.clave)}
              className={`text-xs font-semibold rounded-lg px-2.5 py-1 border ${
                filtro === f.clave
                  ? "bg-neutral-800 text-white border-neutral-800"
                  : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {f.texto}
            </button>
          ))}
        </div>

        {entregas.length === 0 ? (
          <p className="px-4 py-8 text-sm text-neutral-400 text-center">No hay entregas con esos filtros.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-neutral-400 bg-neutral-50 border-b border-neutral-200">
                  <th className="px-4 py-2 font-bold">Pedido</th>
                  <th className="px-4 py-2 font-bold">Pedido el</th>
                  <th className="px-4 py-2 font-bold">Llegó el</th>
                  <th className="px-4 py-2 font-bold">Entrega</th>
                  <th className="px-4 py-2 font-bold text-right">Unid.</th>
                  <th className="px-4 py-2 font-bold text-right">Costo</th>
                  <th className="px-4 py-2 font-bold">Factura</th>
                  <th className="px-4 py-2 font-bold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {entregas.map((e) => {
                  const esta = abierta === e.idRecepcion;
                  return (
                    <Fragment key={e.idRecepcion}>
                      <tr
                        onClick={() => setAbierta(esta ? null : e.idRecepcion)}
                        className={`border-b border-neutral-50 last:border-0 cursor-pointer hover:bg-neutral-50 ${
                          esta ? "bg-neutral-50" : ""
                        }`}
                      >
                        <td className="px-4 py-2.5 font-mono text-xs text-neutral-500 whitespace-nowrap">
                          <span className="text-neutral-400 mr-1">{esta ? "▾" : "▸"}</span>#
                          {e.idOrden.slice(0, 6).toUpperCase()}
                        </td>
                        <td className="px-4 py-2.5 text-neutral-400 tabular-nums">{fechaCorta(e.fechaPedido)}</td>
                        <td className="px-4 py-2.5 text-neutral-700 tabular-nums">{fechaCorta(e.fechaRecibida)}</td>
                        <td className="px-4 py-2.5 text-xs text-neutral-400">
                          {e.totalEntregas === 1 ? "única" : `${e.numeroEntrega}ª de ${e.totalEntregas}`}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-neutral-900">{e.unidades}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-neutral-900">
                          {e.costo != null ? `$${monto(e.costo)}` : <span className="text-neutral-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-neutral-400">{e.numeroFactura ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          {!e.facturada ? (
                            <Chip tono="rojo">
                              Sin costear{e.diasSinCostear > 0 ? ` · ${e.diasSinCostear} días` : ""}
                            </Chip>
                          ) : e.estadoOrden === "RECIBIDA_PARCIAL" ? (
                            <Chip tono="ambar">Llegó a medias</Chip>
                          ) : e.estadoOrden === "CERRADA_INCOMPLETA" ? (
                            <Chip tono="rojo">Cerrada incompleta</Chip>
                          ) : (
                            <Chip tono="verde">Costeada</Chip>
                          )}
                        </td>
                      </tr>
                      {esta && (
                        <tr>
                          <td colSpan={8} className="px-4 pb-3 pt-0 bg-neutral-50 border-b border-neutral-100">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
                              Qué vino en esta entrega
                            </p>
                            {e.lineas.length === 0 ? (
                              <p className="text-xs text-neutral-400 py-1">No quedó el detalle de esta entrega.</p>
                            ) : (
                              <table className="w-full text-xs">
                                <tbody>
                                  {e.lineas.map((l, i) => (
                                    <tr key={i}>
                                      <td className="py-1 text-neutral-700">{l.nombre}</td>
                                      <td className="py-1 text-right text-neutral-400 tabular-nums w-20">
                                        {l.cantidad} un.
                                      </td>
                                      <td className="py-1 text-right text-neutral-500 tabular-nums w-28">
                                        {l.costoUnitario != null ? `$${monto(l.costoUnitario)} c/u` : "sin costear"}
                                      </td>
                                      <td className="py-1 text-right font-medium text-neutral-700 tabular-nums w-24">
                                        {l.costoUnitario != null ? `$${monto(l.costoUnitario * l.cantidad)}` : ""}
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

      {/* ---------- Qué le comprás ---------- */}
      {ficha.productos.length > 0 && (
        <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-neutral-100">
            <p className="text-sm font-semibold text-neutral-900">Qué le comprás</p>
            <p className="text-xs text-neutral-400 mt-0.5">
              Ordenado por lo que más le comprás. La variación compara contra el costo de hace más de 30 días.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-neutral-400 bg-neutral-50 border-b border-neutral-200">
                  <th className="px-4 py-2 font-bold">Producto</th>
                  <th className="px-4 py-2 font-bold text-right">Compradas</th>
                  <th className="px-4 py-2 font-bold text-right">Costo hoy</th>
                  <th className="px-4 py-2 font-bold text-right">Hace 30 días</th>
                  <th className="px-4 py-2 font-bold text-right">Variación</th>
                  <th className="px-4 py-2 font-bold text-right">En góndola</th>
                </tr>
              </thead>
              <tbody>
                {ficha.productos.map((p) => {
                  const pct =
                    p.costoHoy != null && p.costoAntes != null && p.costoAntes > 0
                      ? ((p.costoHoy - p.costoAntes) / p.costoAntes) * 100
                      : null;
                  return (
                    <tr key={p.idVariante} className="border-b border-neutral-50 last:border-0">
                      <td className="px-4 py-2.5">
                        <Link href={`/producto/${p.idVariante}`} className="text-neutral-900 hover:text-accent hover:underline">
                          {p.nombre}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-neutral-900">{p.unidadesCompradas}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-neutral-900">
                        {p.costoHoy != null ? `$${monto(p.costoHoy)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-neutral-400">
                        {p.costoAntes != null ? `$${monto(p.costoAntes)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {pct == null || Math.abs(pct) < 0.05 ? (
                          <span className="text-xs text-neutral-400">sin cambios</span>
                        ) : pct > 0 ? (
                          <span className="text-xs font-semibold text-red-600">▲ +{pct.toFixed(1)}%</span>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-600">▼ {pct.toFixed(1)}%</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{p.enGondola}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- La cuenta ---------- */}
      <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-100 flex items-baseline justify-between gap-3 flex-wrap">
          <p className="text-sm font-semibold text-neutral-900">La cuenta</p>
          <p className="text-xs text-neutral-500 tabular-nums">saldo ${monto(ficha.saldo)}</p>
        </div>
        {ficha.movimientos.length === 0 ? (
          <p className="px-4 py-8 text-sm text-neutral-400 text-center">Todavía no hay movimientos de cuenta.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-neutral-400 bg-neutral-50 border-b border-neutral-200">
                  <th className="px-4 py-2 font-bold">Fecha</th>
                  <th className="px-4 py-2 font-bold">Qué fue</th>
                  <th className="px-4 py-2 font-bold text-right">Importe</th>
                  <th className="px-4 py-2 font-bold text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {ficha.movimientos.map((m) => (
                  <tr key={m.id} className="border-b border-neutral-50 last:border-0">
                    <td className="px-4 py-2.5 text-neutral-500 tabular-nums">{fechaCorta(m.fecha)}</td>
                    <td className="px-4 py-2.5">
                      <span className="block text-neutral-900">{TIPO_MOV[m.tipo] ?? m.tipo}</span>
                      {m.observaciones && (
                        <span className="block text-[11px] text-neutral-400">{m.observaciones}</span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                        m.importe > 0 ? "text-red-600" : "text-emerald-700"
                      }`}
                    >
                      {m.importe > 0 ? "+" : ""}
                      ${monto(m.importe)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-neutral-900">
                      ${monto(m.saldo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-neutral-400 mt-4">
        Se muestran las entregas de los últimos 3 meses. Esta pantalla solo lee: para costear, liquidar o registrar un
        pago se sigue haciendo desde Compras y Proveedores.
      </p>
    </div>
  );
}

function Cifra({
  titulo,
  valor,
  pie,
  tono,
}: {
  titulo: string;
  valor: string;
  pie?: string;
  tono?: "ambar" | "rojo";
}) {
  const color = tono === "ambar" ? "text-amber-700" : tono === "rojo" ? "text-red-600" : "text-neutral-900";
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">{titulo}</p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{valor}</p>
      {pie && <p className="text-[11px] text-neutral-400">{pie}</p>}
    </div>
  );
}

function Chip({ tono, children }: { tono: "verde" | "ambar" | "rojo"; children: React.ReactNode }) {
  const estilo =
    tono === "verde"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tono === "ambar"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${estilo}`}>
      {children}
    </span>
  );
}
