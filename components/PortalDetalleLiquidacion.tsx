"use client";

import { useEffect, useState } from "react";
import { detalleLiquidacionPortal, type DetalleLiquidacionPortal } from "@/app/portal/actions";
import { ETIQUETA_RETENCION, ETIQUETA_RETENCION_CORTA } from "@/lib/margenMarca";

// El detalle de una liquidación en el portal: lo que vendió, a dónde fue cada
// peso, cuánto le quedó según cómo le pagaron y venta por venta (Gonzalo,
// 2026-11-04; vista previa aprobada: https://claude.ai/artifact/Qn5ev2hjdp8wvHQsgV4YSk).
// «Descargar PDF» imprime solo esta ventana.

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const menos = (v: number) => (v > 0 ? `-${pesos(v)}` : "—");
const pct = (neto: number, bruto: number) => (bruto > 0 ? `${Math.round((neto / bruto) * 100)}%` : "—");

function fechaCorta(iso: string | null) {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}/${m}${a && a !== String(new Date().getFullYear()) ? `/${a}` : ""}` : iso;
}

function claseMedio(medio: string) {
  if (medio.startsWith("Efectivo")) return "ef";
  if (medio.startsWith("Posnet")) return "pn";
  return "qr";
}

export default function PortalDetalleLiquidacion({ idLiquidacion, onCerrar }: { idLiquidacion: string | null; onCerrar: () => void }) {
  const [detalle, setDetalle] = useState<DetalleLiquidacionPortal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    detalleLiquidacionPortal(idLiquidacion)
      .then((r) => {
        if (!vigente) return;
        if ("error" in r) setError(r.error);
        else setDetalle(r);
      })
      .catch(() => vigente && setError("No se pudo cargar el detalle."));
    return () => {
      vigente = false;
    };
  }, [idLiquidacion]);

  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [onCerrar]);

  const r = detalle?.resumen;
  const partes = r
    ? [
        { et: "Comisión WiiGo", v: r.comisionWiigo, c: "#bd8f3e" },
        { et: "IVA de la comisión", v: r.ivaComision, c: "#d9b878" },
        { et: ETIQUETA_RETENCION, v: r.retenciones, c: "#ab5348" },
        { et: "Costo de cobro (Mercado Pago y posnet)", v: r.costoCobro, c: "#0b79b5" },
        { et: "Impuesto a los créditos", v: r.impCreditos, c: "#8d9587" },
        { et: "Impuesto a los débitos", v: r.impDebitos, c: "#6f7a68" },
        { et: "Programa de profesionales", v: r.programaProfesionales, c: "#7b6aa8" },
      ].filter((p) => p.v > 0)
    : [];
  const conDebitos = (r?.impDebitos ?? 0) > 0;
  const conProfesionales = (r?.programaProfesionales ?? 0) > 0;
  const diferenciaTransferido = detalle && detalle.transferido != null && r ? Math.round(detalle.transferido - r.neto) : 0;

  return (
    <div className="modal-fondo liq-det-fondo" role="dialog" aria-modal="true" aria-labelledby="liq-det-titulo" onClick={onCerrar}>
      <div className="modal-caja liq-det" onClick={(e) => e.stopPropagation()}>
        <div className="liq-det-cab">
          <div>
            <p className="liq-det-rot">Detalle de la liquidación</p>
            <h3 id="liq-det-titulo">
              {detalle ? `${fechaCorta(detalle.periodo.split(" al ")[0])} al ${fechaCorta(detalle.periodo.split(" al ")[1])}` : "Cargando…"}
            </h3>
            {detalle && (
              <span className={`liq-det-estado ${detalle.estado === "PAGADA" ? "ok" : "pend"}`}>
                {detalle.estado === "PAGADA"
                  ? `● Pagada el ${fechaCorta(detalle.fechaPago)}`
                  : detalle.estado === "PENDIENTE"
                    ? "● Cerrada, pendiente de pago"
                    : "● Provisorio: cambia con cada venta hasta el cierre"}
              </span>
            )}
          </div>
          <div className="liq-det-acciones no-imprimir">
            {detalle && (
              <button type="button" className="boton-portal sec" onClick={() => window.print()}>
                ⬇ Descargar PDF
              </button>
            )}
            <button type="button" className="liq-det-cerrar" onClick={onCerrar} aria-label="Cerrar">
              ✕
            </button>
          </div>
        </div>

        {error && <p className="vacio">{error}</p>}
        {!detalle && !error && <p className="vacio">Cargando…</p>}

        {detalle && r && (
          <>
            {detalle.lineas.length === 0 ? (
              <p className="vacio">No hubo ventas tuyas en este período.</p>
            ) : (
              <>
                <div className="liq-det-tres">
                  <div>
                    <span>Vendiste</span>
                    <b className="mono">{pesos(r.bruto)}</b>
                  </div>
                  <div>
                    <span>Se descontó</span>
                    <b className="mono resta">-{pesos(r.bruto - r.neto)}</b>
                  </div>
                  <div className="queda">
                    <span>{detalle.estado === "EN_CURSO" ? "Te va quedando" : "Te queda por las ventas"}</span>
                    <b className="mono">{pesos(r.neto)}</b>
                  </div>
                </div>
                {detalle.transferido != null && Math.abs(diferenciaTransferido) >= 1 && (
                  <p className="liq-det-nota">
                    Te transferimos <b className="mono">{pesos(detalle.transferido)}</b>: la diferencia de {pesos(Math.abs(diferenciaTransferido))} son ajustes de
                    la liquidación (devoluciones o compensaciones).
                  </p>
                )}

                <div className="liq-det-dos">
                  <div className="liq-det-caja">
                    <h4>A dónde fue cada peso</h4>
                    <div className="liq-det-barra" aria-hidden="true">
                      <i style={{ width: `${(r.neto / r.bruto) * 100}%`, background: "#6d8058" }} />
                      {partes.map((p) => (
                        <i key={p.et} style={{ width: `${(p.v / r.bruto) * 100}%`, background: p.c }} />
                      ))}
                    </div>
                    <ul className="liq-det-renglones">
                      {partes.map((p) => (
                        <li key={p.et}>
                          <span>
                            <i style={{ background: p.c }} />
                            {p.et}
                          </span>
                          <span className="mono resta">{menos(p.v)}</span>
                        </li>
                      ))}
                      <li className="total">
                        <span>
                          <i style={{ background: "#6d8058" }} />
                          Te queda
                        </span>
                        <span className="mono">
                          {pesos(r.neto)} · {pct(r.neto, r.bruto)}
                        </span>
                      </li>
                    </ul>
                  </div>
                  <div className="liq-det-caja">
                    <h4>Según cómo te pagaron</h4>
                    <ul className="liq-det-renglones">
                      {detalle.porMedio.map((m) => (
                        <li key={m.medio}>
                          <span>
                            <span className={`liq-chip ${claseMedio(m.medio)}`}>{m.medio}</span>{" "}
                            <span className="mono liq-det-tenue">{pesos(m.bruto)}</span>
                          </span>
                          <span className="mono">te quedó {pct(m.neto, m.bruto)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="liq-det-tenue liq-det-chico">El costo de cobro es lo que cobra Mercado Pago o el posnet por esa venta, con IVA: WiiGo no le suma nada.</p>
                  </div>
                </div>

                <h4 className="liq-det-sub">Venta por venta</h4>
                <div className="tabla-scroll">
                  <table className="tabla-producto liq-det-tabla">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Producto</th>
                        <th>Cant.</th>
                        <th>Cómo pagó</th>
                        <th>Venta</th>
                        <th>Comisión WiiGo</th>
                        <th>IVA comisión</th>
                        <th>Costo de cobro</th>
                        <th>Imp. créd.</th>
                        <th>{ETIQUETA_RETENCION_CORTA}</th>
                        {conDebitos && <th>Imp. déb.</th>}
                        {conProfesionales && <th>Prog. prof.</th>}
                        <th>Te queda</th>
                        <th>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalle.lineas.map((l, i) => (
                        <tr key={i}>
                          <td className="mono">
                            {fechaCorta(l.fecha)} {l.hora}
                          </td>
                          <td>{l.producto}</td>
                          <td className="mono">{l.cantidad}</td>
                          <td>
                            <span className={`liq-chip ${claseMedio(l.medioPago)}`}>{l.medioPago}</span>
                          </td>
                          <td className="mono">{pesos(l.bruto)}</td>
                          <td className="mono resta">{menos(l.comisionWiigo)}</td>
                          <td className="mono resta">{menos(l.ivaComision)}</td>
                          <td className="mono resta">{menos(l.comisionMp)}</td>
                          <td className="mono resta">{menos(l.impCreditos)}</td>
                          <td className="mono resta">{menos(l.sircreb)}</td>
                          {conDebitos && <td className="mono resta">{menos(l.impDebitos)}</td>}
                          {conProfesionales && <td className="mono resta">{menos(l.programaProfesionales)}</td>}
                          <td className="mono">
                            <b>{pesos(l.neto)}</b>
                          </td>
                          <td>
                            <span className="pct">{pct(l.neto, l.bruto)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4}>Total</td>
                        <td className="mono">{pesos(r.bruto)}</td>
                        <td className="mono resta">{menos(r.comisionWiigo)}</td>
                        <td className="mono resta">{menos(r.ivaComision)}</td>
                        <td className="mono resta">{menos(r.costoCobro)}</td>
                        <td className="mono resta">{menos(r.impCreditos)}</td>
                        <td className="mono resta">{menos(r.retenciones)}</td>
                        {conDebitos && <td className="mono resta">{menos(r.impDebitos)}</td>}
                        {conProfesionales && <td className="mono resta">{menos(r.programaProfesionales)}</td>}
                        <td className="mono">
                          <b>{pesos(r.neto)}</b>
                        </td>
                        <td>
                          <span className="pct">{pct(r.neto, r.bruto)}</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
