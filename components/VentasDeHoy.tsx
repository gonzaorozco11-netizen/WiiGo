"use client";

import { Fragment, useState } from "react";
import type { VentasDelDia, FilaVentaDia } from "@/lib/ventasDelDia";

// «Ventas de hoy» abajo del Inicio del Dueño (Gonzalo, 18/11, maqueta
// aprobada «todo en una fila»): cada venta en una fila con todos sus
// descuentos en columnas; tocás la fila y se abren sus productos.
// Los números salen de lib/ventasDelDia.ts (mismas cuentas que Liquidaciones y Rentabilidad).

const plata = (n: number) => `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const redondo = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

function Menos({ v }: { v: number }) {
  return v > 0.004 ? <td className="px-2.5 py-2.5 text-right tabular-nums text-red-700">−{plata(v)}</td> : <td className="px-2.5 py-2.5 text-right text-neutral-300">—</td>;
}

const DATO: Record<FilaVentaDia["dato"], { t: string; c: string; titulo: string }> = {
  REAL: { t: "Real", c: "bg-emerald-50 text-emerald-700", titulo: "Lo que descontó Mercado Pago, al centavo" },
  ESTIMADO: { t: "Estimado", c: "bg-amber-50 text-amber-800", titulo: "Mercado Pago todavía no lo informó: mañana a las 6:40 pasa a Real solo" },
  SIN_COSTO: { t: "Sin costo", c: "bg-neutral-100 text-neutral-500", titulo: "Efectivo: sin costo de cobro ni impuestos" },
};

export default function VentasDeHoy({ datos }: { datos: VentasDelDia }) {
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const t = datos.total;
  const conRet = datos.filas.some((f) => f.retenciones > 0.004);
  const columnas = conRet ? 13 : 12;
  const alternar = (id: string) =>
    setAbiertas((a) => {
      const n = new Set(a);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const pct = t.vendido > 0 ? Math.round((t.queda / t.vendido) * 1000) / 10 : 0;

  return (
    <section id="ventas-de-hoy" className="scroll-mt-4 space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-neutral-900">Ventas de hoy</h2>
        <p className="text-sm text-neutral-500">
          {datos.filas.length} {datos.filas.length === 1 ? "venta" : "ventas"} · te queda{" "}
          <b className="tabular-nums text-emerald-700">{redondo(t.queda)}</b>
          {t.vendido > 0 && <> ({pct.toLocaleString("es-AR")} % de lo vendido)</>}
        </p>
      </div>

      {datos.filas.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">Todavía no hay ventas hoy.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[1000px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-neutral-200 text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                <th className="px-2.5 py-2.5 text-left">Venta</th>
                <th className="px-2.5 py-2.5 text-left">Dónde</th>
                <th className="px-2.5 py-2.5 text-left">Cómo pagó</th>
                <th className="px-2.5 py-2.5 text-left">Dato</th>
                <th className="px-2.5 py-2.5 text-right">Vendido</th>
                <th className="px-2.5 py-2.5 text-right">Mercadería</th>
                <th className="px-2.5 py-2.5 text-right">Para la marca</th>
                <th className="px-2.5 py-2.5 text-right">IVA</th>
                <th className="px-2.5 py-2.5 text-right">IIBB</th>
                <th className="px-2.5 py-2.5 text-right">Cobro</th>
                <th className="px-2.5 py-2.5 text-right">Créditos</th>
                {conRet && <th className="px-2.5 py-2.5 text-right">Retenciones</th>}
                <th className="px-2.5 py-2.5 text-right">Te queda</th>
              </tr>
            </thead>
            <tbody>
              {datos.filas.map((f) => {
                const abierta = abiertas.has(f.id);
                const d = DATO[f.dato];
                return (
                  <Fragment key={f.id}>
                    <tr
                      tabIndex={0}
                      aria-expanded={abierta}
                      onClick={() => alternar(f.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          alternar(f.id);
                        }
                      }}
                      className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900"
                    >
                      <td className="whitespace-nowrap px-2.5 py-2.5 font-semibold text-neutral-900">
                        <span className={`mr-1.5 inline-block text-neutral-400 transition-transform ${abierta ? "rotate-90" : ""}`}>▸</span>#{f.numero} · {f.hora}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-2.5 text-neutral-700">{f.donde}</td>
                      <td className="whitespace-nowrap px-2.5 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${f.dato === "SIN_COSTO" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{f.pago}</span>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-2.5">
                        <span title={d.titulo} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${d.c}`}>
                          {d.t}
                        </span>
                      </td>
                      <td className="px-2.5 py-2.5 text-right tabular-nums text-neutral-900">{plata(f.vendido)}</td>
                      <Menos v={f.mercaderia} />
                      <Menos v={f.paraMarcas} />
                      <Menos v={f.iva} />
                      <Menos v={f.iibb} />
                      <Menos v={f.cobro} />
                      <Menos v={f.creditos} />
                      {conRet && <Menos v={f.retenciones} />}
                      <td className="px-2.5 py-2.5 text-right font-bold tabular-nums text-emerald-700">{plata(f.queda)}</td>
                    </tr>
                    {abierta && (
                      <tr className="border-b border-neutral-100 bg-neutral-50">
                        <td colSpan={columnas} className="px-2.5 py-2 pl-8 text-[13px] text-neutral-700">
                          <span className="flex flex-wrap gap-x-5 gap-y-1">
                            {f.productos.map((p, i) => (
                              <span key={i}>
                                {p.cantidad} × {p.nombre}
                                {p.marca && <span className="text-neutral-400"> · {p.marca}</span>} — <span className="tabular-nums">{redondo(p.subtotal)}</span>
                              </span>
                            ))}
                            {f.pagoCon != null && <span className="text-neutral-500">Pagó con {redondo(f.pagoCon)}, vuelto {redondo(f.pagoCon - f.vendido)}</span>}
                            {f.paraMarcas > 0 && <span className="text-neutral-500">De lo de la marca te queda tu comisión; el cobro y los créditos se le descuentan en la liquidación.</span>}
                          </span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              <tr className="bg-neutral-100 font-bold">
                <td colSpan={4} className="px-2.5 py-2.5 text-neutral-900">
                  Total del día
                </td>
                <td className="px-2.5 py-2.5 text-right tabular-nums">{plata(t.vendido)}</td>
                <Menos v={t.mercaderia} />
                <Menos v={t.paraMarcas} />
                <Menos v={t.iva} />
                <Menos v={t.iibb} />
                <Menos v={t.cobro} />
                <Menos v={t.creditos} />
                {conRet && <Menos v={t.retenciones} />}
                <td className="px-2.5 py-2.5 text-right tabular-nums text-emerald-700">{plata(t.queda)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11.5px] text-neutral-400">
        <b>Estimado:</b> Mercado Pago todavía no informó el descuento (mañana a las 6:40 pasa a Real solo). <b>Sin costo:</b> efectivo. Tocá una venta para ver sus productos.
      </p>
    </section>
  );
}
