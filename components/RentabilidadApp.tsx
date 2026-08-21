"use client";

import { useState } from "react";
import type { Marca } from "@/lib/supabase";
import { calcularRentabilidad, panelAuditoria, type LineaRentabilidad } from "@/app/(app)/rentabilidad/actions";

type Resumen = {
  facturacionNeta: number;
  cmv: number;
  gastosFinancieros: number;
  costoImpositivo: number;
  contribucionNeta: number;
};

type Auditoria = {
  totalMp: number;
  sircrebRetenido: number;
  totalPendienteTransferencia: number;
  proyeccionImpDebitos: number;
};

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearFecha(fechaISO: string) {
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

export default function RentabilidadApp({ marcas }: { marcas: Marca[] }) {
  const [idMarca, setIdMarca] = useState(marcas[0]?.id_marca ?? "");
  const [desde, setDesde] = useState(inicioDeMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ marca: string; lineas: LineaRentabilidad[]; resumen: Resumen } | null>(null);

  const [auditoria, setAuditoria] = useState<Auditoria | null>(null);
  const [cargandoAuditoria, setCargandoAuditoria] = useState(false);
  const [verAuditoria, setVerAuditoria] = useState(false);

  function handleCalcular() {
    setError(null);
    setCargando(true);
    calcularRentabilidad(idMarca, desde, hasta)
      .then((r) => setResultado(r))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo calcular la rentabilidad"))
      .finally(() => setCargando(false));
  }

  function handleVerAuditoria() {
    setVerAuditoria((v) => !v);
    if (!verAuditoria) {
      setCargandoAuditoria(true);
      panelAuditoria(desde, hasta)
        .then(setAuditoria)
        .finally(() => setCargandoAuditoria(false));
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Rentabilidad</h1>
      <p className="text-sm text-neutral-500 mb-4">
        Contribución marginal real de los productos de marca propia, y panel de auditoría interna.
      </p>

      {marcas.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-8 text-center mb-5">
          <p className="text-neutral-700 font-medium mb-1">Todavía no hay ninguna marca propia</p>
          <p className="text-sm text-neutral-500">
            Este reporte es para productos de marca propia (ej. WiiGo Dietética) — marcá una marca como "Marca Propia" en
            su ficha para que aparezca acá.
          </p>
        </div>
      ) : (
        <>
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
              {cargando ? "Calculando..." : "Calcular rentabilidad"}
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-600 mb-4" role="alert">
              {error}
            </p>
          )}

          {resultado && (
            <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden mb-6">
              {resultado.lineas.length === 0 ? (
                <p className="text-sm text-neutral-400 text-center py-12">
                  No hay ventas de {resultado.marca} en ese rango de fechas.
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
                          <th className="p-3 text-right">Facturación neta</th>
                          <th className="p-3 text-right">CMV</th>
                          <th className="p-3 text-right">Gastos financieros</th>
                          <th className="p-3 text-right">IIBB</th>
                          <th className="p-3 text-right">Contribución marginal</th>
                          <th className="p-3 text-right">%</th>
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
                            <td className="p-3 text-right tabular-nums">${formatearMonto(l.facturacionNeta)}</td>
                            <td className="p-3 text-right tabular-nums text-red-600">-${formatearMonto(l.cmv)}</td>
                            <td className="p-3 text-right tabular-nums text-red-600">
                              {l.gastosFinancieros > 0 ? `-$${formatearMonto(l.gastosFinancieros)}` : "—"}
                            </td>
                            <td className="p-3 text-right tabular-nums text-red-600">
                              {l.costoImpositivo > 0 ? `-$${formatearMonto(l.costoImpositivo)}` : "—"}
                            </td>
                            <td
                              className={`p-3 text-right tabular-nums font-semibold ${
                                l.contribucionNeta < 0 ? "text-red-600" : "text-neutral-900"
                              }`}
                            >
                              ${formatearMonto(l.contribucionNeta)}
                            </td>
                            <td
                              className={`p-3 text-right tabular-nums ${
                                l.contribucionPorcentaje < 0 ? "text-red-600" : "text-neutral-500"
                              }`}
                            >
                              {l.contribucionPorcentaje.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="border-t border-neutral-200 bg-neutral-50 p-5">
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm mb-4">
                      <ResumenCampo etiqueta="Facturación neta" valor={resultado.resumen.facturacionNeta} />
                      <ResumenCampo etiqueta="CMV" valor={-resultado.resumen.cmv} />
                      <ResumenCampo etiqueta="Gastos financieros" valor={-resultado.resumen.gastosFinancieros} />
                      <ResumenCampo etiqueta="IIBB" valor={-resultado.resumen.costoImpositivo} />
                      <ResumenCampo etiqueta="Contribución marginal" valor={resultado.resumen.contribucionNeta} destacado />
                    </div>
                    <div className="bg-white border-2 rounded-xl p-4" style={{ borderColor: "var(--color-accent)" }}>
                      <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-1">
                        📈 Contribución marginal del período
                      </p>
                      <p className="text-xl font-extrabold text-neutral-900">
                        ${formatearMonto(resultado.resumen.contribucionNeta)}
                        <span className="text-sm font-medium text-neutral-400 ml-2">
                          (
                          {resultado.resumen.facturacionNeta > 0
                            ? ((resultado.resumen.contribucionNeta / resultado.resumen.facturacionNeta) * 100).toFixed(1)
                            : "0.0"}
                          % de la facturación neta)
                        </span>
                      </p>
                      <p className="text-xs text-neutral-400 mt-1">
                        Ya sin IVA, sin el CMV, sin los costos financieros de cobro y sin IIBB (este último solo se
                        descuenta en las ventas por banco/Mercado Pago — en efectivo no corresponde).
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      <div className="border-t border-neutral-200 pt-5">
        <button onClick={handleVerAuditoria} className="text-sm text-accent font-medium mb-3">
          {verAuditoria ? "Ocultar panel de auditoría interna ▴" : "Ver panel de auditoría interna ▾"}
        </button>

        {verAuditoria && (
          <div className="bg-neutral-900 text-white rounded-xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-1">🔒 Solo interno WiiGo</p>
            <p className="text-sm text-neutral-300 mb-4">
              No se muestra a las marcas — sirve para el control de costos financieros propios de WiiGo, sobre el mismo
              rango de fechas elegido arriba ({desde} a {hasta}).
            </p>
            {cargandoAuditoria || !auditoria ? (
              <p className="text-sm text-neutral-400">Calculando...</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-neutral-800 rounded-lg p-4">
                  <p className="text-xs text-neutral-400 mb-1">SIRCREB retenido (Mercado Pago)</p>
                  <p className="text-xl font-bold">${formatearMonto(auditoria.sircrebRetenido)}</p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Sobre ${formatearMonto(auditoria.totalMp)} cobrados por Mercado Pago. Es informativo — es crédito
                    a favor de IIBB, no un costo real.
                  </p>
                </div>
                <div className="bg-neutral-800 rounded-lg p-4">
                  <p className="text-xs text-neutral-400 mb-1">Proyección Imp. a los Débitos</p>
                  <p className="text-xl font-bold">${formatearMonto(auditoria.proyeccionImpDebitos)}</p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Si hoy se transfiriera todo lo pendiente de rendir (${formatearMonto(auditoria.totalPendienteTransferencia)}
                    ) a las marcas en consignación, esto cobraría el banco.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
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
