"use client";

import { useEffect, useState } from "react";
import type { Marca, Liquidacion } from "@/lib/supabase";
import {
  calcularRendicion,
  marcarComoLiquidada,
  historialLiquidaciones,
  subirComprobante,
  obtenerUrlComprobante,
  saldosRetencionMarcaAction,
  historialRetencionMarcaAction,
  type LineaRendicion,
} from "@/app/(app)/liquidaciones/actions";

type Resumen = {
  ventaBruta: number;
  comisionWiigo: number;
  ivaComision: number;
  impCreditos: number;
  feeMp: number;
  sircreb: number;
  netoARendir: number;
  netoEfectivo: number;
  netoTransferencia: number;
};

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearFecha(fechaISO: string) {
  // Un string tipo "2026-08-01" (sin hora) lo interpreta como UTC y lo
  // muestra un día antes en horarios negativos como Argentina — forzamos
  // que se lea como hora local agregando la hora si falta.
  const fecha = fechaISO.includes("T") ? new Date(fechaISO) : new Date(`${fechaISO}T00:00:00`);
  return fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const ETIQUETA_FORMA_PAGO_MP: Record<string, string> = {
  DINERO_CUENTA: "Dinero en cuenta",
  DEBITO: "Débito",
  CUOTAS_SIN_INTERES: "Cuotas s/interés",
  PREPAGA: "Prepaga",
  CREDITO: "Crédito",
};

function formatearMedioPago(medioPago: string | null, formaPagoMp: string | null) {
  if (medioPago === "EFECTIVO") return "Efectivo";
  if (medioPago === "MERCADO_PAGO") {
    const forma = formaPagoMp ? ETIQUETA_FORMA_PAGO_MP[formaPagoMp] : null;
    return forma ? `Mercado Pago (${forma})` : "Mercado Pago";
  }
  return "—";
}

function inicioDeMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function LiquidacionesApp({ marcas }: { marcas: Marca[] }) {
  const [idMarca, setIdMarca] = useState(marcas[0]?.id_marca ?? "");
  const [desde, setDesde] = useState(inicioDeMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCierre, setErrorCierre] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ lineas: LineaRendicion[]; resumen: Resumen } | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const [historial, setHistorial] = useState<Liquidacion[]>([]);
  const [verHistorial, setVerHistorial] = useState(false);

  useEffect(() => {
    setResultado(null);
    setError(null);
    setErrorCierre(null);
  }, [idMarca]);

  function handleCalcular() {
    setError(null);
    setCargando(true);
    calcularRendicion(idMarca, desde, hasta)
      .then((r) => setResultado(r))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo calcular la rendición"))
      .finally(() => setCargando(false));
  }

  function handleMarcarLiquidada() {
    if (!resultado || resultado.lineas.length === 0) return;
    if (!confirm(`¿Marcar como liquidado? Se van a cerrar ${resultado.lineas.length} líneas por un neto de $${formatearMonto(resultado.resumen.netoARendir)}.`)) return;
    setErrorCierre(null);
    setCerrando(true);
    marcarComoLiquidada(idMarca, desde, hasta, resultado.resumen)
      .then((res) => {
        if (res.error) setErrorCierre(res.error);
        else setResultado(null);
      })
      .catch((e) => setErrorCierre(e instanceof Error ? e.message : "No se pudo cerrar la liquidación"))
      .finally(() => setCerrando(false));
  }

  function handleVerHistorial() {
    setVerHistorial((v) => !v);
    if (!verHistorial) {
      historialLiquidaciones(idMarca).then(setHistorial);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Liquidaciones</h1>
      <p className="text-sm text-neutral-500 mb-4">Rendición de ventas a marcas en consignación, línea por línea.</p>

      <div className="flex flex-wrap gap-2 items-end mb-5">
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Marca</label>
          <select
            value={idMarca}
            onChange={(e) => setIdMarca(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {marcas.map((m) => (
              <option key={m.id_marca} value={m.id_marca}>
                {m.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={handleCalcular}
          disabled={cargando}
          className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm"
        >
          {cargando ? "Calculando..." : "Calcular rendición"}
        </button>
        <button onClick={handleVerHistorial} className="text-sm text-accent font-medium px-2 py-2">
          {verHistorial ? "Ocultar historial" : "Ver historial ▾"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4" role="alert">
          {error}
        </p>
      )}

      {idMarca && <RetencionesMarca key={idMarca} idMarca={idMarca} />}

      {verHistorial && (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden mb-5">
          {historial.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-8">Todavía no hay liquidaciones cerradas para esta marca.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Período</th>
                  <th className="p-3">Fecha de cierre</th>
                  <th className="p-3 text-right">Venta bruta</th>
                  <th className="p-3 text-right">Deducciones</th>
                  <th className="p-3 text-right">Neto rendido</th>
                  <th className="p-3">Comprobante</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((l) => (
                  <tr key={l.id_liquidacion} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3">
                      {formatearFecha(l.fecha_desde)} – {formatearFecha(l.fecha_hasta)}
                    </td>
                    <td className="p-3 text-neutral-500">{formatearFecha(l.fecha_generacion)}</td>
                    <td className="p-3 text-right tabular-nums">${formatearMonto(l.venta_bruta ?? 0)}</td>
                    <td className="p-3 text-right tabular-nums text-red-600">-${formatearMonto(l.total_retenciones ?? 0)}</td>
                    <td className="p-3 text-right tabular-nums font-semibold">${formatearMonto(l.neto_a_transferir ?? 0)}</td>
                    <td className="p-3">
                      <FilaComprobante liquidacion={l} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {resultado && (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          {resultado.lineas.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-12">
              No hay ventas pendientes de rendir para {resultado.marca} en ese rango de fechas.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                      <th className="p-3">Fecha / Venta</th>
                      <th className="p-3">Producto</th>
                      <th className="p-3">Cant.</th>
                      <th className="p-3">Pago</th>
                      <th className="p-3 text-right">Venta bruta</th>
                      <th className="p-3 text-right">Comisión WiiGo</th>
                      <th className="p-3 text-right">IVA s/comisión</th>
                      <th className="p-3 text-right">Imp. créd.</th>
                      <th className="p-3 text-right">Fee MP</th>
                      <th className="p-3 text-right">SIRCREB</th>
                      <th className="p-3 text-right">Neto a rendir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.lineas.map((l) => (
                      <tr key={l.idDetalle} className="border-b border-neutral-100 last:border-0">
                        <td className="p-3 whitespace-nowrap text-neutral-500">
                          {formatearFecha(l.fecha)} · #{String(l.numeroVenta).padStart(4, "0")}
                        </td>
                        <td className="p-3">{l.producto}</td>
                        <td className="p-3">{l.cantidad}</td>
                        <td className="p-3 text-neutral-500 whitespace-nowrap">
                          {formatearMedioPago(l.medioPago, l.formaPagoMp)}
                        </td>
                        <td className="p-3 text-right tabular-nums">${formatearMonto(l.ventaBruta)}</td>
                        <td className="p-3 text-right tabular-nums text-red-600">-${formatearMonto(l.comisionWiigo)}</td>
                        <td className="p-3 text-right tabular-nums text-red-600">
                          {l.ivaComision > 0 ? `-$${formatearMonto(l.ivaComision)}` : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums text-red-600">
                          {l.impCreditos > 0 ? `-$${formatearMonto(l.impCreditos)}` : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums text-red-600">
                          {l.feeMp > 0 ? `-$${formatearMonto(l.feeMp)}` : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums text-purple-600">
                          {l.sircreb > 0 ? `-$${formatearMonto(l.sircreb)}` : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums font-semibold">${formatearMonto(l.netoARendir)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-neutral-200 bg-neutral-50 p-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
                  <ResumenCampo etiqueta="Venta bruta total" valor={resultado.resumen.ventaBruta} />
                  <ResumenCampo etiqueta="Comisión WiiGo" valor={-resultado.resumen.comisionWiigo} />
                  <ResumenCampo etiqueta="IVA s/comisión" valor={-resultado.resumen.ivaComision} />
                  <ResumenCampo etiqueta="Imp. a los créditos" valor={-resultado.resumen.impCreditos} />
                  <ResumenCampo etiqueta="Fee Mercado Pago" valor={-resultado.resumen.feeMp} />
                  <ResumenCampo etiqueta="SIRCREB retenido" valor={-resultado.resumen.sircreb} />
                  <ResumenCampo etiqueta="Total deducciones" valor={-(resultado.resumen.comisionWiigo + resultado.resumen.ivaComision + resultado.resumen.impCreditos + resultado.resumen.feeMp + resultado.resumen.sircreb)} />
                </div>

                {resultado.resumen.sircreb > 0 && (
                  <p className="text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 mb-4">
                    ⓘ El SIRCREB retenido (${formatearMonto(resultado.resumen.sircreb)}) no es ganancia de WiiGo — queda en la cuenta corriente de retenciones de {resultado.marca}, pendiente de compensar o devolver.
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <div className="bg-white border-2 border-emerald-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">💵 Efectivo a entregar</p>
                    <p className="text-xl font-extrabold text-neutral-900">${formatearMonto(resultado.resumen.netoEfectivo)}</p>
                    <p className="text-xs text-neutral-400 mt-1">Se le paga la comisión + IVA — sin Impuesto a los Créditos, no pasa por el banco.</p>
                  </div>
                  <div className="bg-white border-2 border-accent-tint rounded-xl p-4" style={{ borderColor: "var(--color-accent)" }}>
                    <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-1">🏦 A transferir por banco</p>
                    <p className="text-xl font-extrabold text-neutral-900">${formatearMonto(resultado.resumen.netoTransferencia)}</p>
                    <p className="text-xs text-neutral-400 mt-1">Ventas por Mercado Pago u otro medio bancario — con todas las deducciones.</p>
                  </div>
                </div>

                {errorCierre && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3" role="alert">
                    {errorCierre}
                  </p>
                )}
                <button
                  onClick={handleMarcarLiquidada}
                  disabled={cerrando}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg text-sm"
                >
                  {cerrando ? "Cerrando..." : "Marcar como liquidado"}
                </button>
                <p className="text-xs text-neutral-400 mt-2">
                  Esto cierra el período: estas ventas dejan de contarse en la próxima rendición.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FilaComprobante({ liquidacion }: { liquidacion: Liquidacion }) {
  const [path, setPath] = useState(liquidacion.comprobante_path);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setError(null);
    setSubiendo(true);
    const formData = new FormData();
    formData.set("archivo", archivo);
    subirComprobante(liquidacion.id_liquidacion, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else setPath(`${liquidacion.id_liquidacion}.${archivo.name.split(".").pop() ?? "pdf"}`);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo subir"))
      .finally(() => setSubiendo(false));
    e.target.value = "";
  }

  function handleVerFirmado() {
    if (!path) return;
    obtenerUrlComprobante(path).then((url) => window.open(url, "_blank"));
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <a
        href={`/liquidaciones/${liquidacion.id_liquidacion}/comprobante`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent text-xs font-medium"
      >
        Ver comprobante
      </a>
      {path ? (
        <button onClick={handleVerFirmado} className="text-emerald-600 text-xs font-medium">
          ✓ Ver firmado
        </button>
      ) : (
        <label className="text-xs text-neutral-500 cursor-pointer">
          {subiendo ? "Subiendo..." : "+ Subir firmado"}
          <input type="file" accept="image/*,.pdf" onChange={handleArchivo} disabled={subiendo} className="hidden" />
        </label>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ResumenCampo({ etiqueta, valor, destacado }: { etiqueta: string; valor: number; destacado?: boolean }) {
  const negativo = valor < 0;
  return (
    <div>
      <p className="text-xs text-neutral-500">{etiqueta}</p>
      <p className={`font-semibold ${destacado ? "text-lg text-neutral-900" : negativo ? "text-red-600" : "text-neutral-900"}`}>
        {negativo ? "-" : ""}${formatearMonto(Math.abs(valor))}
      </p>
    </div>
  );
}

const ETIQUETA_TIPO_RETENCION: Record<string, string> = {
  SIRCREB: "SIRCREB",
  IMP_DEBITO_CREDITO: "Impuesto a los créditos/débitos",
  OTRO: "Otros",
};

const ETIQUETA_TIPO_MOVIMIENTO: Record<string, string> = {
  RETENCION: "Retención",
  COMPENSACION: "Compensación",
  DEVOLUCION: "Devolución",
  AJUSTE_POSITIVO: "Ajuste (+)",
  AJUSTE_NEGATIVO: "Ajuste (−)",
  ANULACION: "Anulación",
};

// Cuenta corriente de retenciones — vive en Finanzas (acá), no en la ficha
// de la marca (Catálogo es solo productos/subcategorías). Nunca es plata
// de WiiGo: es lo retenido preventivamente (hoy solo SIRCREB) pendiente de
// compensar o devolver. Saldo siempre derivado de movimientos, nunca un
// número suelto — mismo patrón que el saldo por marca de Profesionales.
function RetencionesMarca({ idMarca }: { idMarca: string }) {
  const [saldos, setSaldos] = useState<{ tipoRetencion: string; saldo: number }[]>([]);
  const [historial, setHistorial] = useState<
    { idMovimiento: string; tipoRetencion: string; tipoMovimiento: string; importe: number; saldoNuevo: number; usuario: string | null; observaciones: string | null; fecha: string }[]
  >([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarHistorial, setMostrarHistorial] = useState(false);

  useEffect(() => {
    setCargando(true);
    Promise.all([saldosRetencionMarcaAction(idMarca), historialRetencionMarcaAction(idMarca)])
      .then(([s, h]) => {
        setSaldos(s);
        setHistorial(h);
      })
      .finally(() => setCargando(false));
  }, [idMarca]);

  const totalPendiente = saldos.reduce((acc, s) => acc + s.saldo, 0);

  if (cargando) return null;
  if (saldos.length === 0 && historial.length === 0) return null;

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-neutral-900">🧾 Cuenta corriente de retenciones</h2>
        <span className="text-lg font-extrabold text-purple-700 tabular-nums">${formatearMonto(totalPendiente)}</span>
      </div>
      <p className="text-xs text-neutral-400 mb-3">
        Retenido preventivamente en liquidaciones (ej. SIRCREB) — no es ganancia de WiiGo, queda pendiente de compensar o devolver.
      </p>
      {saldos.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {saldos.map((s) => (
            <div key={s.tipoRetencion} className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
              <span className="text-sm font-medium text-purple-900">{ETIQUETA_TIPO_RETENCION[s.tipoRetencion] ?? s.tipoRetencion}</span>
              <span className="text-sm font-bold text-purple-700 tabular-nums">${formatearMonto(s.saldo)}</span>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => setMostrarHistorial((v) => !v)} className="text-xs font-semibold text-accent">
        {mostrarHistorial ? "▾" : "▸"} Historial de movimientos ({historial.length})
      </button>
      {mostrarHistorial && (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-400 border-b border-neutral-200">
                <th className="p-2">Fecha</th>
                <th className="p-2">Tipo</th>
                <th className="p-2">Movimiento</th>
                <th className="p-2 text-right">Importe</th>
                <th className="p-2 text-right">Saldo</th>
                <th className="p-2">Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((m) => (
                <tr key={m.idMovimiento} className="border-b border-neutral-100 last:border-0">
                  <td className="p-2 whitespace-nowrap text-neutral-500">
                    {new Date(m.fecha).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                  </td>
                  <td className="p-2">{ETIQUETA_TIPO_RETENCION[m.tipoRetencion] ?? m.tipoRetencion}</td>
                  <td className="p-2">{ETIQUETA_TIPO_MOVIMIENTO[m.tipoMovimiento] ?? m.tipoMovimiento}</td>
                  <td className={`p-2 text-right tabular-nums font-semibold ${m.importe >= 0 ? "text-purple-700" : "text-emerald-600"}`}>
                    {m.importe >= 0 ? "+" : ""}${formatearMonto(m.importe)}
                  </td>
                  <td className="p-2 text-right tabular-nums">${formatearMonto(m.saldoNuevo)}</td>
                  <td className="p-2 text-neutral-400">{m.observaciones ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
