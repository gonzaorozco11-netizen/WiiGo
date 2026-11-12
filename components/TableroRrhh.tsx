"use client";

import Link from "next/link";
import type { DashboardRrhh } from "@/app/(app)/rrhh/actions";
import PantallazoRrhh from "@/components/PantallazoRrhh";

// El tablero de RR.HH., la versión simple (Gonzalo, 2026-11-12: «más
// práctico, no tan complejo»). De arriba a abajo:
//   1. Quién está trabajando ahora.
//   2. El mes de cada uno: horas, lo que lleva ganado, presentismo, planilla.
//   3. Lo que cuesta el equipo: lo que llevás gastado, lo que vas a gastar en
//      el mes según el cálculo y cuánto representa de lo que gana WiiGo.
//   4. Lo que hay que hacer.
// Lo de antes (semáforo del 35%, rinde de cada turno) queda cerrado abajo, en
// «Ver los números del negocio» (PantallazoRrhh): no se pierde nada.

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const horasTxt = (h: number) => `${h.toLocaleString("es-AR", { maximumFractionDigits: 1 })} h`;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const TONO = {
  bien: "bg-emerald-50 text-emerald-700",
  ojo: "bg-amber-50 text-amber-700",
  mal: "bg-red-50 text-red-700",
  gris: "bg-neutral-100 text-neutral-500",
} as const;
// Los mismos cortes que el semáforo de PantallazoRrhh: sano hasta 35%, para mirar hasta 45%.
const SANO = 35;
const ALERTA = 45;

function moverMes(periodo: string, delta: number) {
  const [a, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const tarjeta = "bg-white border border-neutral-200 rounded-xl";

export default function TableroRrhh({ d, periodo, setPeriodo }: { d: DashboardRrhh; periodo: string; setPeriodo: (p: string) => void }) {
  const [anio, mes] = periodo.split("-").map(Number);
  const nombreMes = MESES[mes - 1];
  const avisos = d.avisos.filter((a) => a.n > 0);
  const totalHoras = d.mesDeCadaUno.reduce((a, p) => a + (p.horas ?? 0), 0);
  const totalLleva = d.mesDeCadaUno.reduce((a, p) => a + p.lleva, 0);
  const pct = d.porcentajeIngresos;
  const estado =
    pct === null ? null : pct <= SANO ? { texto: "Sano", tono: TONO.bien } : pct <= ALERTA ? { texto: "Para mirar", tono: TONO.ojo } : { texto: "Alto", tono: TONO.mal };
  const honorarios = d.grupos.find((g) => g.clave === "TERCERIZADOS")?.gente ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-1">
        <button type="button" onClick={() => setPeriodo(moverMes(periodo, -1))} className="w-8 h-8 rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50" aria-label="Mes anterior">
          ‹
        </button>
        <span className="px-3 text-sm font-semibold text-neutral-800 min-w-[130px] text-center">
          {nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)} {anio}
        </span>
        <button
          type="button"
          onClick={() => setPeriodo(moverMes(periodo, 1))}
          disabled={d.esMesActual}
          className="w-8 h-8 rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"
          aria-label="Mes siguiente"
        >
          ›
        </button>
      </div>

      {/* 1. Ahora */}
      {d.ahora && (
        <section className={`${tarjeta} p-5`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-neutral-900">Ahora en el local</h2>
            <Link href={`/rrhh/asistencia?mes=${periodo}`} className="text-sm font-semibold text-accent hover:underline">
              Ver la asistencia del mes →
            </Link>
          </div>
          {d.ahora.personas.length === 0 ? (
            <p className="text-sm text-neutral-500 mt-2">Hoy todavía no fichó nadie.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {d.ahora.personas.map((p) => (
                <li key={p.idPersona} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-neutral-50 px-3 py-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${p.adentro ? "bg-emerald-600 ring-4 ring-emerald-100" : "bg-neutral-300"}`} aria-hidden="true" />
                  <span className="font-semibold text-neutral-900">{p.nombre}</span>
                  <span className={`text-[11px] font-bold rounded-full px-2 py-px ${p.adentro ? TONO.bien : TONO.gris}`}>{p.adentro ? "Trabajando" : "Se fue"}</span>
                  <span className="ml-auto tabular-nums font-bold text-neutral-900">{horasTxt(p.horas)} hoy</span>
                  <span className="basis-full text-xs text-neutral-500 pl-[22px]">
                    {p.turno} · entró {p.entro}
                    {p.adentro && p.arrancaA && ` · le cuenta desde las ${p.arrancaA}`}
                    {p.tarde && ` · llegó ${p.minutosTarde} min tarde`}
                    {p.salio && ` · se fue ${p.salio}`}
                    {p.adentro && (p.cajaAbierta ? " · caja abierta" : " · sin caja")}
                    {p.minutosDeMas > 0 && ` · ${p.minutosDeMas} min de más`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 2. El mes de cada uno */}
      <section className={`${tarjeta} p-5`}>
        <h2 className="font-semibold text-neutral-900">El mes de cada uno</h2>
        <p className="text-xs text-neutral-500">Lo que llevan ganado sale de las horas fichadas por el valor de la hora, con el presentismo que vienen ganando.</p>
        {d.mesDeCadaUno.length === 0 ? (
          <p className="text-sm text-neutral-400 mt-3">No hay empleados con sueldo cargado.</p>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
                  <th className="text-left pb-2 pr-3">Persona</th>
                  <th className="text-right pb-2 px-2">Horas</th>
                  <th className="text-right pb-2 px-2">Lleva ganado</th>
                  <th className="text-left pb-2 px-2">Presentismo</th>
                  <th className="text-right pb-2 px-2">Tarde</th>
                  <th className="text-right pb-2 px-2">Faltas</th>
                  <th className="text-right pb-2 px-2">Adelantos</th>
                  <th className="pb-2 pl-2" />
                </tr>
              </thead>
              <tbody>
                {d.mesDeCadaUno.map((p) => (
                  <tr key={p.idPersona} className="border-b border-neutral-100 last:border-0 align-top">
                    <td className="py-2.5 pr-3">
                      <span className="block font-semibold text-neutral-900">{p.nombre}</span>
                      <span className="block text-xs text-neutral-400">{p.detalle}</span>
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">
                      {p.horas === null ? "—" : horasTxt(p.horas)}
                      {p.horasEnCurso > 0 && <span className="block text-[11px] text-sky-700">{horasTxt(p.horasEnCurso)} en curso</span>}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">
                      <b className="text-neutral-900">{pesos(p.lleva)}</b>
                      {p.presentismoMonto > 0 && <span className="block text-[11px] text-neutral-400">con {pesos(p.presentismoMonto)} de presentismo</span>}
                    </td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[11px] font-bold rounded-full px-2 py-px ${TONO[p.presentismo.tono]}`}>{p.presentismo.texto}</span>
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{p.tardanzas ?? "—"}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{p.faltas ?? "—"}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{p.adelantos > 0 ? pesos(p.adelantos) : "—"}</td>
                    <td className="py-2.5 pl-2 text-right">
                      {p.conPlanilla && (
                        <a href={`/rrhh/asistencia/planilla?mes=${periodo}&persona=${p.idPersona}`} className="text-accent font-semibold hover:underline">
                          Planilla
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {d.mesDeCadaUno.length > 1 && (
                <tfoot>
                  <tr className="border-t border-neutral-900 font-bold">
                    <td className="pt-2 pr-3">{d.esMesActual ? "Si cerraras el mes hoy" : "Total del mes"}</td>
                    <td className="pt-2 px-2 text-right tabular-nums">{horasTxt(totalHoras)}</td>
                    <td className="pt-2 px-2 text-right tabular-nums">{pesos(totalLleva)}</td>
                    <td colSpan={5} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        {/* 3. Lo que cuesta */}
        <section className={`${tarjeta} p-5 min-w-0`}>
          <h2 className="font-semibold text-neutral-900">Lo que cuesta el equipo en {nombreMes}</h2>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="rounded-lg bg-neutral-50 px-3 py-3">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">Llevás gastado</p>
              <p className="tipo-titulo text-2xl font-bold tabular-nums text-neutral-900 mt-1">{pesos(d.llevasGastado.total)}</p>
              <p className="text-xs text-neutral-500 mt-1">
                Sueldos {pesos(d.llevasGastado.sueldos)}
                <br />
                Honorarios pagados {pesos(d.llevasGastado.honorarios)}
              </p>
            </div>
            <div className="rounded-lg bg-accent-tint px-3 py-3">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-accent">{d.esMesActual ? "Vas a gastar en el mes" : "Gastaste en el mes"}</p>
              <p className="tipo-titulo text-2xl font-bold tabular-nums text-neutral-900 mt-1">{pesos(d.costoTotal)}</p>
              <p className="text-xs text-neutral-500 mt-1">
                Sueldos {pesos(d.alCierre.sueldos)}
                <br />
                Honorarios {pesos(d.alCierre.honorarios)}
              </p>
            </div>
          </div>
          {d.esMesActual && (
            <p className="text-[11.5px] text-neutral-400 mt-2">
              El cálculo: lo que llevan, más las horas de su turno en los días que les tocan hasta fin de mes. Los honorarios sin pagar van con su monto.
            </p>
          )}

          {/* Cuánto representa */}
          <div className="mt-4 rounded-lg border border-neutral-200 px-3.5 py-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">Cuánto representa</p>
            {pct === null ? (
              <p className="text-sm text-neutral-500 mt-1">Todavía no hay ingresos en {nombreMes} para comparar.</p>
            ) : (
              <>
                <p className="text-sm text-neutral-800 mt-1">
                  {pct <= 100 ? (
                    <>
                      De cada $100 que gana WiiGo, <b className="tabular-nums">{pesos(pct)}</b> van al equipo.
                    </>
                  ) : (
                    <>
                      El equipo cuesta <b className="tabular-nums">{(pct / 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} veces</b> lo que lleva ganado WiiGo en{" "}
                      {nombreMes} ({pesos(d.ingresos.total)}).
                    </>
                  )}{" "}
                  {estado && <span className={`text-[11px] font-bold rounded-full px-2 py-px ${estado.tono}`}>{estado.texto}</span>}
                </p>
                <p className="text-[11.5px] text-neutral-400 mt-1">
                  Lo sano es que el equipo sea hasta el {SANO}% de lo que gana WiiGo (la comisión de las marcas y la venta propia, sin IVA).
                </p>
              </>
            )}
          </div>

          {honorarios.length > 0 && (
            <ul className="mt-4 space-y-1.5 text-[13px]">
              {honorarios.map((h, i) => (
                <li key={`${h.nombre}-${i}`} className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-neutral-700">{h.nombre}</span>
                  <span className={`text-[10.5px] font-bold rounded-full px-1.5 py-px shrink-0 ${TONO[h.estado.tono]}`}>{h.estado.texto}</span>
                  <span className="ml-auto tabular-nums font-semibold text-neutral-900">{h.monto > 0 ? pesos(h.monto) : "—"}</span>
                </li>
              ))}
            </ul>
          )}
          {d.aguinaldoPorMes > 0 && (
            <p className="text-[13px] text-neutral-600 mt-3">
              💡 Apartá <b className="tabular-nums">{pesos(d.aguinaldoPorMes)}</b> por mes para el aguinaldo.
            </p>
          )}
        </section>

        {/* 4. Para hacer */}
        <section className={`${tarjeta} p-5 min-w-0`}>
          <h2 className="font-semibold text-neutral-900">Para hacer</h2>
          {avisos.length === 0 ? (
            <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2.5 mt-3">Todo en orden.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {avisos.map((a) => (
                <li key={a.clave}>
                  <Link href={a.href} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 hover:border-amber-300">
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-semibold text-amber-900">{a.titulo}</span>
                      <span className="block text-xs text-amber-800/80">{a.detalle}</span>
                    </span>
                    <span className="ml-auto text-lg font-bold tabular-nums text-amber-700">{a.n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <details className="rounded-xl border border-dashed border-neutral-300 bg-white px-5 py-3 group">
        <summary className="cursor-pointer text-sm font-semibold text-neutral-600">
          Ver los números del negocio: rinde de cada turno y de dónde sale lo que gana WiiGo
        </summary>
        <div className="mt-4">
          <PantallazoRrhh d={d} periodo={periodo} setPeriodo={setPeriodo} embebido />
        </div>
      </details>
    </div>
  );
}
