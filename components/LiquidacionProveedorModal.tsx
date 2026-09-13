"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import type { ProveedorConSaldo } from "@/app/(app)/proveedores/actions";
import type { DetalleLiquidacion, MedioLiquidacion, LoteDeLinea } from "@/lib/liquidacionesProveedor";
import {
  detalleLiquidacionProveedorAction,
  generarLiquidacionProveedorAction,
  corregirCostoLote,
} from "@/app/(app)/proveedores/actions";

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

/**
 * Un lote consumido, con su costo corregible.
 *
 * Se corrige acá y no en el renglón del producto porque el renglón puede ser
 * la suma de varios lotes a precios distintos: cambiarlo ahí no diría cuál de
 * los dos está mal. El lote es un remito puntual, y no tiene ambigüedad.
 *
 * El candado de "liquidación cerrada" está del lado del servidor, en
 * corregirCostoLote: esa plata ya se pagó y no se reescribe.
 */
function FilaLote({
  lote,
  ivaProducto,
  onGuardado,
}: {
  lote: LoteDeLinea;
  ivaProducto: number;
  onGuardado: () => void;
}) {
  const estimado = lote.idDetalleRecepcion === "ESTIMADO";
  const [editando, setEditando] = useState(false);
  const [costo, setCosto] = useState(String(lote.costoUnitario));
  const [iva, setIva] = useState(ivaProducto);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function guardar() {
    setError(null);
    setGuardando(true);
    corregirCostoLote(lote.idDetalleRecepcion, Number(costo) || 0, iva)
      .then((r) => {
        if (r.error) setError(r.error);
        else {
          setEditando(false);
          onGuardado();
        }
      })
      .finally(() => setGuardando(false));
  }

  if (estimado) {
    return (
      <tr>
        <td className="py-1 text-amber-700" colSpan={2}>
          ⚠ Sin recepción registrada — costo estimado
        </td>
        <td className="py-1 text-right text-amber-700 tabular-nums">
          {lote.cantidad} un. · ${formatearMonto(lote.costoUnitario)} c/u
        </td>
        <td className="py-1 text-right font-medium text-amber-700 tabular-nums">
          ${formatearMonto(lote.cantidad * lote.costoUnitario)}
        </td>
      </tr>
    );
  }

  if (editando) {
    return (
      <tr className="bg-accent-tint">
        <td className="py-1.5 text-neutral-600">
          Recibido el{" "}
          {new Date(lote.fechaRecepcion).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
          {error && <span className="block text-[11px] text-red-600 mt-0.5">{error}</span>}
        </td>
        <td className="py-1.5 text-right text-neutral-500 tabular-nums">{lote.cantidad} un.</td>
        <td className="py-1.5 text-right">
          <input
            type="number"
            min={0}
            step="0.01"
            value={costo}
            onChange={(e) => setCosto(e.target.value)}
            className="w-24 rounded border border-accent px-1.5 py-1 text-xs text-right tabular-nums"
          />
          <select
            value={iva}
            onChange={(e) => setIva(Number(e.target.value))}
            className="ml-1.5 rounded border border-accent px-1 py-1 text-xs bg-white"
          >
            <option value={21}>21%</option>
            <option value={10.5}>10,5%</option>
            <option value={0}>Ex.</option>
          </select>
        </td>
        <td className="py-1.5 text-right whitespace-nowrap">
          <button
            onClick={() => setEditando(false)}
            className="text-[11px] text-neutral-500 border border-neutral-300 rounded px-1.5 py-1 mr-1"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !(Number(costo) > 0)}
            className="text-[11px] font-semibold text-white bg-accent rounded px-2 py-1 disabled:opacity-50"
          >
            {guardando ? "..." : "Guardar"}
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="group">
      <td className="py-1 text-neutral-500">
        Recibido el {new Date(lote.fechaRecepcion).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
      </td>
      <td className="py-1 text-right text-neutral-500 tabular-nums">{lote.cantidad} un.</td>
      <td className="py-1 text-right text-neutral-500 tabular-nums">${formatearMonto(lote.costoUnitario)} c/u</td>
      <td className="py-1 text-right font-medium text-neutral-700 tabular-nums whitespace-nowrap">
        ${formatearMonto(lote.cantidad * lote.costoUnitario)}
        <button
          onClick={() => setEditando(true)}
          className="ml-2 text-[11px] font-semibold text-accent hover:underline"
        >
          Corregir
        </button>
      </td>
    </tr>
  );
}

function pct(valor: number) {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
}

const ETIQUETA_MEDIO: Record<MedioLiquidacion, string> = {
  ELECTRONICO: "Mercado Pago y tarjeta",
  EFECTIVO: "Efectivo",
};

function etiquetaIva(v: number) {
  return v === 10.5 ? "10,5%" : `${v}%`;
}

function primerDiaDelMes() {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function LiquidacionProveedorModal({
  proveedor,
  onClose,
}: {
  proveedor: ProveedorConSaldo;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [fechaDesde, setFechaDesde] = useState(primerDiaDelMes());
  const [fechaHasta, setFechaHasta] = useState(hoyISO());
  const [detalle, setDetalle] = useState<DetalleLiquidacion | null>(null);
  const [montoFinal, setMontoFinal] = useState("");
  const [observaciones, setObservaciones] = useState("");
  // Qué medio de pago está desplegado, y qué producto dentro de él.
  const [medioAbierto, setMedioAbierto] = useState<MedioLiquidacion | null>(null);
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  function toggleExpandida(clave: string) {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(clave)) next.delete(clave);
      else next.add(clave);
      return next;
    });
  }

  // Se incrementa al corregir un costo, para volver a pedir el detalle: los
  // totales y el margen cambian, y dejarlos viejos sería peor que no dejar
  // corregir.
  const [version, setVersion] = useState(0);
  const recargar = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!fechaDesde || !fechaHasta) return;
    setBuscando(true);
    detalleLiquidacionProveedorAction(proveedor.id_proveedor, fechaDesde, fechaHasta)
      .then(setDetalle)
      .finally(() => setBuscando(false));
  }, [proveedor.id_proveedor, fechaDesde, fechaHasta, version]);

  // Lo que hay que pagarle es el total CON IVA: es lo que va a decir su
  // factura. Antes acá iba solo el neto y se le pagaba de menos.
  const montoCalculado = detalle?.totales.total ?? 0;
  const montoNum = Number(montoFinal) || montoCalculado;
  const diferencia = montoFinal ? Number(montoFinal) - montoCalculado : 0;
  const hayAlgo = (detalle?.totales.cantidad ?? 0) > 0;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await generarLiquidacionProveedorAction({
          idProveedor: proveedor.id_proveedor,
          fechaDesde,
          fechaHasta,
          montoFinal: montoNum,
          observaciones,
        });
        if (res.error) setError(res.error);
        else onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-200 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-accent uppercase">WiiGo</p>
            <h2 className="text-xl font-semibold text-neutral-900">Liquidación por venta</h2>
            <p className="text-xs text-neutral-400 mt-0.5">{proveedor.nombre} — se le paga el costo de lo vendido, no de lo entregado</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Desde</label>
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Hasta</label>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {buscando ? (
            <p className="text-sm text-neutral-400 text-center py-6">Calculando...</p>
          ) : !hayAlgo ? (
            <p className="text-sm text-neutral-500 text-center py-6 border border-dashed border-neutral-200 rounded-xl">
              No se vendió nada de sus productos en este período (o ya está todo liquidado).
            </p>
          ) : (
            <>
              {/* Cómo pagaron los clientes lo que se vendió de este proveedor.
                  Es información para decidir, no cambia lo que se liquida:
                  lo que le corresponde al proveedor es el total, sin importar
                  por dónde entró la plata. */}
              <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">
                Cómo pagaron tus clientes · tocá una para ver el detalle
              </p>
              <div className="grid sm:grid-cols-2 gap-2.5">
                {detalle!.porMedio.map((g) => {
                  const abierta = medioAbierto === g.medio;
                  const parte = detalle!.totales.cantidad > 0
                    ? Math.round((g.totales.cantidad / detalle!.totales.cantidad) * 100)
                    : 0;
                  return (
                    <button
                      key={g.medio}
                      onClick={() => {
                        setMedioAbierto(abierta ? null : g.medio);
                        setExpandidas(new Set());
                      }}
                      className={`text-left border rounded-xl p-3.5 ${
                        abierta ? "border-accent bg-accent-tint" : "border-neutral-200 hover:border-neutral-300"
                      }`}
                    >
                      <p className={`text-[10.5px] font-bold uppercase tracking-wide ${abierta ? "text-accent" : "text-neutral-400"}`}>
                        {ETIQUETA_MEDIO[g.medio]}
                      </p>
                      <p className="text-xs text-neutral-400">
                        {g.totales.cantidad} unidades · {parte}% de lo vendido
                      </p>
                      {/* Primero lo que entró por caja y recién después lo
                          que hay que pagar. Antes la tarjeta arrancaba por el
                          costo, y de la venta no se veía nada. */}
                      <div className="flex justify-between text-sm mt-2 font-semibold">
                        <span className="text-neutral-700">Vendiste</span>
                        <span className="tabular-nums text-neutral-900">${formatearMonto(g.totales.ventaTotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-neutral-500">Costo neto</span>
                        <span className="tabular-nums text-neutral-500">−${formatearMonto(g.totales.costoNeto)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-neutral-500">IVA de la compra</span>
                        <span className="tabular-nums text-neutral-500">${formatearMonto(g.totales.iva)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold border-t border-neutral-200 mt-1.5 pt-1.5">
                        <span>Le pagás</span>
                        <span className="tabular-nums">${formatearMonto(g.totales.total)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold text-emerald-700">
                        <span>Te queda</span>
                        <span className="tabular-nums">${formatearMonto(g.totales.margen)}</span>
                      </div>
                      <p className="text-[11.5px] font-semibold text-accent mt-2">
                        {abierta ? "▾ Detalle abierto" : "▸ Ver los productos y el margen"}
                      </p>
                    </button>
                  );
                })}
              </div>

              {medioAbierto &&
                detalle!.porMedio
                  .filter((g) => g.medio === medioAbierto)
                  .map((g) => (
                    <div key={g.medio} className="border border-accent rounded-xl overflow-hidden">
                      <div className="bg-accent-tint px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-sm font-semibold text-neutral-900">
                          {ETIQUETA_MEDIO[g.medio]} · {g.totales.cantidad} unidades
                        </p>
                        <button onClick={() => setMedioAbierto(null)} className="text-xs text-neutral-500">
                          Cerrar ✕
                        </button>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-neutral-50 border-b border-neutral-200 text-left text-[10.5px] text-neutral-400 uppercase tracking-wide">
                              <th className="p-2.5">Producto · tocá para ver los lotes</th>
                              <th className="p-2.5 text-right">Unid.</th>
                              <th className="p-2.5 text-right">Costo neto</th>
                              <th className="p-2.5 text-right">IVA</th>
                              <th className="p-2.5 text-right">Venta neta</th>
                              <th className="p-2.5 text-right">Margen</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.lineas.map((l) => {
                              const clave = `${g.medio}|${l.idVariante}`;
                              const abierta = expandidas.has(clave);
                              const margenPct = l.ventaNeta > 0 ? (l.margen / l.ventaNeta) * 100 : 0;
                              const variosLotes = l.lotes.length > 1;
                              return (
                                <Fragment key={clave}>
                                  <tr
                                    onClick={() => toggleExpandida(clave)}
                                    className="border-b border-neutral-100 cursor-pointer hover:bg-neutral-50"
                                  >
                                    <td className="p-2.5 text-neutral-900">
                                      <span className="text-neutral-400 text-xs mr-1.5">{abierta ? "▾" : "▸"}</span>
                                      {l.nombreProducto}
                                      <span className="ml-2 text-[10px] text-neutral-400">
                                        {etiquetaIva(l.ivaPorcentaje)}
                                      </span>
                                    </td>
                                    <td className="p-2.5 text-right text-neutral-500 tabular-nums">{l.cantidad}</td>
                                    <td className="p-2.5 text-right tabular-nums">
                                      ${formatearMonto(l.costoNeto)}
                                      {variosLotes && <span className="block text-[10px] text-neutral-400">2+ lotes</span>}
                                    </td>
                                    <td className="p-2.5 text-right text-neutral-500 tabular-nums">${formatearMonto(l.iva)}</td>
                                    <td className="p-2.5 text-right text-neutral-500 tabular-nums">${formatearMonto(l.ventaNeta)}</td>
                                    <td className={`p-2.5 text-right tabular-nums font-semibold ${l.margen >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                                      ${formatearMonto(l.margen)}
                                      <span className="block text-[10px] font-normal">{pct(margenPct)}</span>
                                    </td>
                                  </tr>
                                  {abierta && (
                                    <tr className="bg-neutral-50 border-b border-neutral-100">
                                      <td colSpan={6} className="px-4 py-2.5">
                                        <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">
                                          De qué recepción salió cada unidad · más vieja primero
                                        </p>
                                        <table className="w-full text-xs">
                                          <tbody>
                                            {l.lotes.map((lote, i) => (
                                              <FilaLote
                                                key={`${lote.idDetalleRecepcion}-${i}`}
                                                lote={lote}
                                                ivaProducto={l.ivaPorcentaje}
                                                onGuardado={recargar}
                                              />
                                            ))}
                                          </tbody>
                                        </table>
                                        <p className="text-[10.5px] text-neutral-400 mt-2">
                                          El costo se corrige por lote y no por renglón: si el mismo producto entró
                                          dos veces a precios distintos, cambiar el renglón no diría cuál de los dos
                                          está mal. La alícuota es del producto, así que vale para todos sus lotes.
                                        </p>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="bg-emerald-50 border-t border-emerald-200 px-4 py-3">
                        <p className="text-[10.5px] font-bold uppercase tracking-wide text-emerald-700">Ganaste con esto</p>
                        <p className="text-2xl font-bold text-emerald-700 tabular-nums">${formatearMonto(g.totales.margen)}</p>
                        <p className="text-xs text-emerald-700/80">
                          Vendiste ${formatearMonto(g.totales.ventaTotal)} · te costó ${formatearMonto(g.totales.costoNeto)} ·
                          margen del {pct(g.totales.ventaNeta > 0 ? (g.totales.margen / g.totales.ventaNeta) * 100 : 0)} sobre la
                          venta neta
                        </p>
                      </div>
                    </div>
                  ))}

              {detalle!.estimado && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Parte del costo está estimado: hay unidades vendidas sin recepción registrada con costo. Revisá que
                  todas las recepciones estén costeadas.
                </p>
              )}
            </>
          )}

          <p className="text-xs text-neutral-500">
            Lo que no se vendió (quedó en stock o se devolvió) no aparece acá — no genera ninguna deuda.
          </p>

          <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5">
            {/* La cuenta entera, de la venta al margen: sin la primera línea
                esta caja contaba solo la mitad de la historia. */}
            <div className="flex justify-between text-sm py-0.5 font-semibold">
              <span className="text-neutral-800">
                Vendiste {detalle?.totales.cantidad ?? 0}{" "}
                {(detalle?.totales.cantidad ?? 0) === 1 ? "unidad" : "unidades"}
              </span>
              <span className="tabular-nums">${formatearMonto(detalle?.totales.ventaTotal ?? 0)}</span>
            </div>
            <div className="flex justify-between text-xs py-0.5">
              <span className="text-neutral-400">Venta sin IVA</span>
              <span className="tabular-nums text-neutral-400">${formatearMonto(detalle?.totales.ventaNeta ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm py-0.5 border-t border-neutral-200 mt-1.5 pt-1.5">
              <span className="text-neutral-500">Costo neto de lo vendido</span>
              <span className="tabular-nums">${formatearMonto(detalle?.totales.costoNeto ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm py-0.5">
              <span className="text-neutral-500">IVA</span>
              <span className="tabular-nums">${formatearMonto(detalle?.totales.iva ?? 0)}</span>
            </div>
            <div className="flex justify-between text-base font-bold border-t border-neutral-200 mt-1.5 pt-2">
              <span>A liquidarle</span>
              <span className="tabular-nums">${formatearMonto(montoCalculado)}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-emerald-700 mb-3">
              <span>Tu margen</span>
              <span className="tabular-nums">${formatearMonto(detalle?.totales.margen ?? 0)}</span>
            </div>
            <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">
              Monto que dice la liquidación del proveedor (opcional, si no coincide)
            </label>
            <input
              type="number"
              min={0}
              value={montoFinal}
              onChange={(e) => setMontoFinal(e.target.value)}
              placeholder={String(montoCalculado)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {montoFinal && diferencia !== 0 && (
              <p className="text-xs text-amber-700 mt-2">
                Diferencia de ${formatearMonto(Math.abs(diferencia))} contra lo calculado — probablemente por el costo de
                referencia usado. Cotejá los pedidos del período si hace falta.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Observaciones</label>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || !hayAlgo}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Generando..." : `Generar liquidación por $${formatearMonto(montoNum)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
