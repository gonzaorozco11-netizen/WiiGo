"use client";

import { Fragment, useMemo, useState } from "react";
import type { Marca } from "@/lib/supabase";
import { etiquetaPago } from "@/lib/formasPago";
import { calcularRentabilidad, panelAuditoria, type LineaRentabilidad } from "@/app/(app)/rentabilidad/actions";

type Resumen = {
  facturacionNeta: number;
  iva: number;
  cmv: number;
  impuestoCreditos: number;
  comisionMp: number;
  gastosFinancieros: number;
  costoImpositivo: number;
  contribucionNeta: number;
  /** Mercadería propia perdida en el período. Ya viene restada de la contribución. */
  merma: number;
};

type Auditoria = {
  totalMp: number;
  sircrebRetenido: number;
  totalPendienteTransferencia: number;
  proyeccionImpDebitos: number;
};

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatearFecha(fechaISO: string) {
  const fecha = fechaISO.includes("T") ? new Date(fechaISO) : new Date(`${fechaISO}T00:00:00`);
  return fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// "Efectivo", "QR · Débito", "Posnet · Crédito" (lib/formasPago.ts).
const formatearMedioPago = (medioPago: string | null, formaPagoMp: string | null) => etiquetaPago(medioPago, formaPagoMp);

function inicioDeMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Una venta entera: la suma de sus renglones (pedido de Gonzalo, 2026-11-12). */
type VentaAgrupada = {
  idVenta: string;
  numeroVenta: number;
  fecha: string;
  medioPago: string | null;
  formaPagoMp: string | null;
  totalVenta: number;
  ventaBruta: number;
  facturacionNeta: number;
  iva: number;
  cmv: number;
  impuestoCreditos: number;
  comisionMp: number;
  costoImpositivo: number;
  contribucionNeta: number;
  lineas: LineaRentabilidad[];
};

function agruparPorVenta(lineas: LineaRentabilidad[]): VentaAgrupada[] {
  const porVenta = new Map<string, VentaAgrupada>();
  for (const l of lineas) {
    const v =
      porVenta.get(l.idVenta) ??
      ({
        idVenta: l.idVenta,
        numeroVenta: l.numeroVenta,
        fecha: l.fecha,
        medioPago: l.medioPago,
        formaPagoMp: l.formaPagoMp,
        totalVenta: l.totalVenta,
        ventaBruta: 0,
        facturacionNeta: 0,
        iva: 0,
        cmv: 0,
        impuestoCreditos: 0,
        comisionMp: 0,
        costoImpositivo: 0,
        contribucionNeta: 0,
        lineas: [],
      } satisfies VentaAgrupada);
    v.ventaBruta += l.ventaBruta;
    v.facturacionNeta += l.facturacionNeta;
    v.iva += l.iva;
    v.cmv += l.cmv;
    v.impuestoCreditos += l.impuestoCreditos;
    v.comisionMp += l.comisionMp;
    v.costoImpositivo += l.costoImpositivo;
    v.contribucionNeta += l.contribucionNeta;
    v.lineas.push(l);
    porVenta.set(l.idVenta, v);
  }
  // Las líneas ya vienen de la más nueva a la más vieja: el Map respeta ese orden.
  return [...porVenta.values()];
}

type Plata = Pick<VentaAgrupada, "ventaBruta" | "iva" | "facturacionNeta" | "cmv" | "impuestoCreditos" | "comisionMp" | "costoImpositivo" | "contribucionNeta">;

/** Las columnas de plata, iguales para una venta y para un producto. */
function CeldasPlata({ f, fuerte }: { f: Plata; fuerte?: boolean }) {
  const pct = f.facturacionNeta > 0 ? (f.contribucionNeta / f.facturacionNeta) * 100 : 0;
  const resta = (v: number) => (v > 0 ? `-$${formatearMonto(v)}` : "—");
  return (
    <>
      <td className={`p-3 text-right tabular-nums ${fuerte ? "font-semibold text-neutral-900" : ""}`}>${formatearMonto(f.ventaBruta)}</td>
      <td className="p-3 text-right tabular-nums text-red-600">{resta(f.iva)}</td>
      <td className="p-3 text-right tabular-nums">${formatearMonto(f.facturacionNeta)}</td>
      <td className="p-3 text-right tabular-nums text-red-600">-${formatearMonto(f.cmv)}</td>
      <td className="p-3 text-right tabular-nums text-red-600">{resta(f.impuestoCreditos)}</td>
      <td className="p-3 text-right tabular-nums text-red-600">{resta(f.comisionMp)}</td>
      <td className="p-3 text-right tabular-nums text-red-600">{resta(f.costoImpositivo)}</td>
      <td className={`p-3 text-right tabular-nums font-semibold ${f.contribucionNeta < 0 ? "text-red-600" : "text-neutral-900"}`}>
        ${formatearMonto(f.contribucionNeta)}
      </td>
      <td className={`p-3 text-right tabular-nums ${pct < 0 ? "text-red-600" : "text-neutral-500"}`}>{pct.toFixed(1)}%</td>
    </>
  );
}

// En el orden de la cuenta: cobrado − IVA = facturación neta, y de ahí se
// restan los costos hasta llegar a la contribución.
const ENCABEZADOS_PLATA = ["Cobrado", "IVA", "Facturación neta", "CMV", "Imp. Créditos", "Comisión MP", "IIBB", "Contribución", "%"];

function EncabezadosPlata() {
  return (
    <>
      {ENCABEZADOS_PLATA.map((t) => (
        <th key={t} className="p-3 text-right whitespace-nowrap">
          {t}
        </th>
      ))}
    </>
  );
}

function LinkVenta({ idVenta, numero }: { idVenta: string; numero: number }) {
  return (
    <a href={`/ventas?venta=${idVenta}`} className="text-accent hover:underline font-medium" title="Abrir la venta en Ventas">
      #{String(numero).padStart(4, "0")}
    </a>
  );
}

export default function RentabilidadApp({ marcas }: { marcas: Marca[] }) {
  const [idMarca, setIdMarca] = useState(marcas[0]?.id_marca ?? "");
  const [desde, setDesde] = useState(inicioDeMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ marca: string; lineas: LineaRentabilidad[]; resumen: Resumen } | null>(null);
  // Por venta: cada venta entera con todo su desglose, y sus productos al
  // abrirla (Gonzalo, 2026-11-12). Por producto: un renglón por producto.
  const [vista, setVista] = useState<"venta" | "producto">("venta");
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const ventasAgrupadas = useMemo(() => (resultado ? agruparPorVenta(resultado.lineas) : []), [resultado]);
  const alternarVenta = (id: string) =>
    setAbiertas((previas) => {
      const nuevas = new Set(previas);
      if (nuevas.has(id)) nuevas.delete(id);
      else nuevas.add(id);
      return nuevas;
    });

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
                  <div className="flex flex-wrap items-center gap-3 px-4 pt-4">
                    <div className="inline-flex rounded-lg bg-neutral-100 p-1 text-sm" role="tablist" aria-label="Cómo ver las ventas">
                      {(
                        [
                          ["venta", `Por venta (${ventasAgrupadas.length})`],
                          ["producto", `Por producto (${resultado.lineas.length})`],
                        ] as const
                      ).map(([clave, texto]) => (
                        <button
                          key={clave}
                          type="button"
                          role="tab"
                          aria-selected={vista === clave}
                          onClick={() => setVista(clave)}
                          className={`rounded-md px-3 py-1.5 font-medium ${vista === clave ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"}`}
                        >
                          {texto}
                        </button>
                      ))}
                    </div>
                    {vista === "venta" && (
                      <p className="text-xs text-neutral-500">Tocá una venta para ver sus productos. El número la abre en Ventas.</p>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    {vista === "venta" ? (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                            <th className="p-3">Fecha / Venta</th>
                            <th className="p-3">Productos</th>
                            <th className="p-3">Pago</th>
                            <EncabezadosPlata />
                          </tr>
                        </thead>
                        <tbody>
                          {ventasAgrupadas.map((v) => {
                            const abierta = abiertas.has(v.idVenta);
                            const unidades = v.lineas.reduce((a, l) => a + l.cantidad, 0);
                            // Si la venta tuvo productos de otras marcas, acá solo entra lo de esta.
                            const otrasMarcas = v.totalVenta - v.ventaBruta > 1;
                            return (
                              <Fragment key={v.idVenta}>
                                <tr
                                  className={`border-b border-neutral-100 cursor-pointer hover:bg-neutral-50 ${abierta ? "bg-neutral-50" : ""}`}
                                  onClick={() => alternarVenta(v.idVenta)}
                                >
                                  <td className="p-3 whitespace-nowrap text-neutral-500">
                                    {formatearFecha(v.fecha)} · <LinkVenta idVenta={v.idVenta} numero={v.numeroVenta} />
                                  </td>
                                  <td className="p-3 whitespace-nowrap">
                                    <button
                                      type="button"
                                      aria-expanded={abierta}
                                      className="text-neutral-700 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                                    >
                                      {abierta ? "▾" : "▸"} {unidades} {unidades === 1 ? "producto" : "productos"}
                                    </button>
                                    {otrasMarcas && (
                                      <span className="block text-[11px] text-amber-700">
                                        La venta fue de ${formatearMonto(v.totalVenta)}: acá solo lo de {resultado.marca}
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3 text-neutral-500 whitespace-nowrap">{formatearMedioPago(v.medioPago, v.formaPagoMp)}</td>
                                  <CeldasPlata f={v} fuerte />
                                </tr>
                                {abierta &&
                                  v.lineas.map((l) => (
                                    <tr key={l.idDetalle} className="border-b border-neutral-100 bg-neutral-50/60 text-neutral-600">
                                      <td className="p-3" />
                                      <td className="p-3 pl-7" colSpan={2}>
                                        {l.cantidad} × {l.producto}
                                      </td>
                                      <CeldasPlata f={l} />
                                    </tr>
                                  ))}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                            <th className="p-3">Fecha / Venta</th>
                            <th className="p-3">Producto</th>
                            <th className="p-3">Cant.</th>
                            <th className="p-3">Pago</th>
                            <EncabezadosPlata />
                          </tr>
                        </thead>
                        <tbody>
                          {resultado.lineas.map((l) => (
                            <tr key={l.idDetalle} className="border-b border-neutral-100 last:border-0">
                              <td className="p-3 whitespace-nowrap text-neutral-500">
                                {formatearFecha(l.fecha)} · <LinkVenta idVenta={l.idVenta} numero={l.numeroVenta} />
                              </td>
                              <td className="p-3">{l.producto}</td>
                              <td className="p-3">{l.cantidad}</td>
                              <td className="p-3 text-neutral-500 whitespace-nowrap">{formatearMedioPago(l.medioPago, l.formaPagoMp)}</td>
                              <CeldasPlata f={l} />
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="border-t border-neutral-200 bg-neutral-50 p-5">
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-sm mb-4">
                      <ResumenCampo etiqueta="Facturación neta" valor={resultado.resumen.facturacionNeta} />
                      <ResumenCampo etiqueta="IVA" valor={-resultado.resumen.iva} />
                      <ResumenCampo etiqueta="CMV" valor={-resultado.resumen.cmv} />
                      <ResumenCampo etiqueta="Imp. Créditos" valor={-resultado.resumen.impuestoCreditos} />
                      <ResumenCampo etiqueta="Comisión MP" valor={-resultado.resumen.comisionMp} />
                      <ResumenCampo etiqueta="IIBB" valor={-resultado.resumen.costoImpositivo} />
                      {/* La merma no sale de ninguna línea —no hubo venta—
                          pero se comió margen igual. Sin este renglón la
                          contribución se lee mejor de lo que fue. */}
                      <ResumenCampo etiqueta="Merma" valor={-resultado.resumen.merma} />
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
