"use client";

import Link from "next/link";
import type { DashboardRrhh } from "@/app/(app)/rrhh/actions";

// El pantallazo del mes de RR.HH.: lo que cuesta el equipo, qué parte de las
// ventas se lleva, cómo se reparte entre el local, la administración y los
// tercerizados, lo que rinde cada turno, quién está hoy y lo trabado.
// Maqueta aprobada por Gonzalo antes de codear.

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const pct = (v: number) => `${v.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const COLOR_GRUPO: Record<DashboardRrhh["grupos"][number]["clave"], string> = {
  LOCAL: "#2563eb",
  ADMINISTRACION: "#6d3fc0",
  TERCERIZADOS: "#9aa0ab",
};
const TONO_CHIP = {
  bien: "bg-emerald-50 text-emerald-700",
  ojo: "bg-amber-50 text-amber-700",
  mal: "bg-red-50 text-red-700",
  gris: "bg-neutral-100 text-neutral-500",
} as const;
const TIPO_LIC: Record<string, string> = {
  VACACIONES: "de vacaciones",
  MATERNIDAD: "de licencia por maternidad",
  EXAMEN: "de licencia por examen",
  PARTICULAR: "de licencia",
  ENFERMEDAD: "de licencia por enfermedad",
  OTRO: "de licencia",
};

// El indicador es el costo del equipo sobre los ingresos netos de WiiGo
// (comisión + venta propia sin IVA + fees), no sobre lo facturado: casi toda
// la venta es de las marcas. Para un negocio que vive de comisiones lo sano
// es hasta el 35%; entre 35% y 45%, para mirar; arriba, el equipo se come la
// ganancia. Sin aflojar: es el número que dice si el negocio aguanta el equipo.
const SANO = 35;
const ALERTA = 45;
const TOPE_REGLA = 70;

function moverMes(periodo: string, delta: number) {
  const [a, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const tarjeta = "bg-white border border-neutral-200 rounded-xl";
const eyebrow = "text-[10.5px] font-bold uppercase tracking-wider text-neutral-400";

export default function PantallazoRrhh({
  d,
  periodo,
  setPeriodo,
}: {
  d: DashboardRrhh;
  periodo: string;
  setPeriodo: (p: string) => void;
}) {
  const [anio, mes] = periodo.split("-").map(Number);
  const nombreMes = MESES[mes - 1];
  const estado =
    d.porcentajeIngresos === null
      ? null
      : d.porcentajeIngresos <= SANO
        ? { texto: "Sano", clase: "bg-emerald-50 text-emerald-700" }
        : d.porcentajeIngresos <= ALERTA
          ? { texto: "Para mirar", clase: "bg-amber-50 text-amber-700" }
          : { texto: "Alto", clase: "bg-red-50 text-red-700" };
  const enRegla = (v: number) => `${(v / TOPE_REGLA) * 100}%`;
  const turnosConRinde = d.turnos.filter((t) => t.rinde !== null);
  const flojo = turnosConRinde.length >= 2 ? turnosConRinde.reduce((a, t) => ((t.rinde ?? 0) < (a.rinde ?? 0) ? t : a)) : null;
  const maxRinde = Math.max(...turnosConRinde.map((t) => t.rinde ?? 0), 1);
  const avisosActivos = d.avisos.filter((a) => a.n > 0);
  // El aviso de "incluye lo que falta" solo si de verdad hay algo estimado, y
  // diciendo qué: horas proyectadas, honorarios estimados, o las dos cosas.
  const hayHorasProyectadas = d.grupos.some((g) => g.clave !== "TERCERIZADOS" && g.gente.some((p) => p.proyectado));
  const hayHonorariosEstimados = d.grupos.some((g) => g.clave === "TERCERIZADOS" && g.gente.some((p) => p.proyectado));
  const avisoProyeccion = [
    hayHorasProyectadas ? "las horas de los que cobran por hora están llevadas a fin de mes con el ritmo que tienen hasta hoy" : null,
    hayHonorariosEstimados ? "los honorarios que todavía no cargaste van con su monto estimado" : null,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      {/* Mes */}
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => setPeriodo(moverMes(periodo, -1))}
          className="w-8 h-8 rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
          aria-label="Mes anterior"
        >
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

      {/* La respuesta */}
      <section className={`${tarjeta} grid md:grid-cols-2 overflow-hidden`}>
        <div className="p-5">
          <p className={eyebrow}>Lo que cuesta el equipo en {nombreMes}</p>
          <p className="tipo-titulo text-4xl font-bold tabular-nums leading-none mt-2.5 mb-2 text-neutral-900">{pesos(d.costoTotal)}</p>
          <p className="text-sm text-neutral-500">Empleados y servicios tercerizados, todo junto</p>
          {d.costoTotal > 0 && (
            <>
              <div className="flex h-2.5 rounded-full overflow-hidden mt-4 bg-neutral-100">
                {d.grupos.map((g) => (
                  <span key={g.clave} style={{ width: `${(g.total / d.costoTotal) * 100}%`, background: COLOR_GRUPO[g.clave] }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-neutral-500">
                {d.grupos.map((g) => (
                  <span key={g.clave} className="flex items-center gap-1.5">
                    <i className="inline-block w-2.5 h-2.5 rounded-[3px]" style={{ background: COLOR_GRUPO[g.clave] }} />
                    {g.nombre} <b className="text-neutral-800 tabular-nums">{pesos(g.total)}</b>
                  </span>
                ))}
              </div>
            </>
          )}
          {avisoProyeccion.length > 0 && (
            <p className="text-[11.5px] text-neutral-400 mt-3">
              Es lo que va a costar el mes completo: {avisoProyeccion.join(", y ")}.
            </p>
          )}
        </div>
        <div className="p-5 border-t md:border-t-0 md:border-l border-neutral-200">
          <p className={eyebrow}>Qué parte de lo que gana WiiGo se lleva</p>
          {d.porcentajeIngresos === null ? (
            <p className="text-sm text-neutral-500 mt-3">Todavía no hay ingresos en {nombreMes}.</p>
          ) : (
            <>
              <div className="flex items-baseline gap-2.5 mt-2.5 mb-2">
                <p className="tipo-titulo text-4xl font-bold tabular-nums leading-none text-neutral-900">{pct(d.porcentajeIngresos)}</p>
                {estado && <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${estado.clase}`}>{estado.texto}</span>}
              </div>
              <p className="text-sm text-neutral-500">
                De cada $100 que gana WiiGo, <b className="text-neutral-900">{pesos(Math.min(d.porcentajeIngresos, 999))}</b> van al equipo
              </p>
              <div
                className="relative h-3 rounded-full mt-4"
                style={{
                  background: `linear-gradient(90deg, #0f7a4a 0 ${enRegla(SANO)}, #d08a1c ${enRegla(SANO)} ${enRegla(ALERTA)}, #c2341d ${enRegla(ALERTA)} 100%)`,
                }}
              >
                <span
                  className="absolute -top-1.5 w-1 h-6 rounded bg-neutral-900 ring-2 ring-white"
                  style={{ left: `calc(${Math.min(d.porcentajeIngresos / TOPE_REGLA, 1) * 100}% - 2px)` }}
                />
              </div>
              <div className="relative h-4 text-[11px] text-neutral-400 mt-1">
                <span className="absolute left-0">0%</span>
                <span className="absolute -translate-x-1/2" style={{ left: enRegla(SANO) }}>{SANO}%</span>
                <span className="absolute -translate-x-1/2" style={{ left: enRegla(ALERTA) }}>{ALERTA}%</span>
                <span className="absolute right-0">{TOPE_REGLA}%+</span>
              </div>
              {/* De dónde sale lo que gana WiiGo. */}
              <div className="mt-3 space-y-1 text-[13px]">
                <div className="flex justify-between text-neutral-500">
                  <span>Comisión de las marcas</span>
                  <span className="tabular-nums text-neutral-800">{pesos(d.ingresos.comision)}</span>
                </div>
                <div className="flex justify-between text-neutral-500">
                  <span>{d.ingresos.ventaPropiaConIva > 0 ? "Venta de la marca propia" : "Venta de la marca propia, sin IVA"}</span>
                  <span className="tabular-nums text-neutral-800">{pesos(d.ingresos.ventaPropia)}</span>
                </div>
                {d.ingresos.ventaPropiaConIva > 0 && (
                  <p className="text-[11.5px] text-amber-700">
                    {pesos(d.ingresos.ventaPropiaConIva)} son ventas en efectivo sin factura, y van con IVA: así está configurado en
                    Configuración → Rentabilidad. Si esas ventas se facturan, activá ahí descontar el IVA en efectivo.
                  </p>
                )}
                {d.ingresos.fees > 0 && (
                  <div className="flex justify-between text-neutral-500">
                    <span>Fees de las marcas</span>
                    <span className="tabular-nums text-neutral-800">{pesos(d.ingresos.fees)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-neutral-900 border-t border-neutral-200 pt-1">
                  <span>Lo que gana WiiGo</span>
                  <span className="tabular-nums">{pesos(d.ingresos.total)}</span>
                </div>
              </div>
              <p className="text-[13px] text-neutral-500 bg-neutral-50 rounded-lg px-3 py-2.5 mt-3">
                Para que el equipo sea el {SANO}% de lo que ganás, necesitás ingresar{" "}
                <b className="text-neutral-900 tabular-nums">{pesos(d.ingresoParaMeta)}</b> por mes
                {d.facturadoParaMeta !== null && (
                  <>
                    , unos <b className="text-neutral-900 tabular-nums">{pesos(d.facturadoParaMeta)}</b> de facturación con la mezcla de
                    este mes
                  </>
                )}
                .
              </p>
              {d.porcentajeFacturado !== null && (
                <p className="text-[11.5px] text-neutral-400 mt-2">
                  Sobre lo facturado ({pesos(d.facturado)}, con IVA y la parte de las marcas) sería {pct(d.porcentajeFacturado)}. No
                  sirve para medir: esa plata es casi toda de las marcas.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {/* Los tres grupos */}
      <section className="grid md:grid-cols-3 gap-3">
        {d.grupos.map((g) => (
          <div key={g.clave} className={`${tarjeta} p-4 flex flex-col min-w-0`}>
            <p className={`${eyebrow} flex items-center gap-2`}>
              <i className="inline-block w-2.5 h-2.5 rounded-[3px]" style={{ background: COLOR_GRUPO[g.clave] }} />
              {g.nombre}
            </p>
            <p className="tipo-titulo text-2xl font-bold tabular-nums mt-2 text-neutral-900">{pesos(g.total)}</p>
            <p className="text-xs text-neutral-500">
              {g.detalle}
              {d.ingresos.total > 0 && g.total > 0 && ` · ${pct((g.total / d.ingresos.total) * 100)} de lo que gana WiiGo`}
            </p>
            <ul className="mt-3 pt-3 border-t border-neutral-100 space-y-2.5">
              {g.gente.length === 0 && <li className="text-xs text-neutral-400">Nadie cargado en este grupo.</li>}
              {g.gente.map((p, i) => (
                <li key={`${p.nombre}-${i}`} className="text-[13.5px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-neutral-900 truncate">{p.nombre}</span>
                    <span className="tabular-nums text-neutral-900 shrink-0">
                      {p.monto > 0 ? pesos(p.monto) : "—"}
                    </span>
                  </div>
                  {/* Por hora y mes en curso: lo real hasta hoy, y el monto de
                      arriba es al cierre del mes. */}
                  {p.hastaHoy && (
                    <div className="flex items-baseline justify-between gap-2 text-xs mt-0.5">
                      <span className="text-neutral-600">
                        Lleva <b className="tabular-nums">{pesos(p.hastaHoy.monto)}</b>
                        {p.hastaHoy.horas !== null && <span className="tabular-nums"> · {p.hastaHoy.horas} h</span>}
                      </span>
                      <span className="text-neutral-400 shrink-0">al cierre</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-400 mt-0.5">
                    <span>{p.detalle}</span>
                    <span className={`font-bold rounded-full px-1.5 py-px text-[11px] ${TONO_CHIP[p.estado.tono]}`}>{p.estado.texto}</span>
                    {p.proyectado && !p.hastaHoy && <span className="text-[11px]">· estimado</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* Los turnos */}
      {d.turnos.length > 0 && (
        <section className={`${tarjeta} p-5`}>
          <h2 className="font-semibold text-neutral-900">Los turnos del local</h2>
          <p className="text-xs text-neutral-500">
            Cuánto cuesta cada turno y cuánto le deja a WiiGo de lo que vende: la comisión de las marcas más la venta propia sin
            IVA. Si por cada $1 de sueldo queda menos de $1, el turno no paga su propio sueldo. Los turnos salen de los horarios de
            trabajo de Organización.
            {hayHorasProyectadas && " El costo es el del mes completo; las horas, las fichadas hasta hoy."}
          </p>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
                  <th className="text-left pb-2 pr-3">Turno</th>
                  <th className="text-left pb-2 px-2">Quién</th>
                  <th className="text-right pb-2 px-2">Horas</th>
                  <th className="text-right pb-2 px-2">Cuesta</th>
                  <th className="text-right pb-2 px-2">Vende</th>
                  <th className="text-right pb-2 px-2 whitespace-nowrap">Le queda a WiiGo</th>
                  <th className="text-right pb-2 pl-2 whitespace-nowrap">Por cada $1 de sueldo</th>
                </tr>
              </thead>
              <tbody>
                {d.turnos.map((t) => {
                  const esFlojo = flojo && t.nombre === flojo.nombre;
                  return (
                    <tr key={t.nombre} className="border-b border-neutral-100 last:border-0">
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span className="block font-semibold text-neutral-900">{t.nombre}</span>
                        <span className="text-xs text-neutral-400">{t.horario}</span>
                      </td>
                      <td className="py-2.5 px-2 text-neutral-700">{t.quien.length ? t.quien.join(", ") : <span className="text-neutral-400">Nadie asignado</span>}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums whitespace-nowrap">
                        {t.horasHastaHoy === null ? "—" : `${t.horasHastaHoy} h`}
                        {t.horas !== null && t.horasHastaHoy !== null && t.horas !== t.horasHastaHoy && (
                          <span className="block text-[11px] text-neutral-400">{t.horas} h al cierre</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{t.cuesta > 0 ? pesos(t.cuesta) : "—"}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-neutral-500">{pesos(t.vende)}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{pesos(t.ingreso)}</td>
                      <td className="py-2.5 pl-2">
                        {t.rinde === null ? (
                          <span className="block text-right text-neutral-400">—</span>
                        ) : (
                          <span className="flex items-center justify-end gap-2">
                            <span className="w-20 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                              <span
                                className="block h-full rounded-full"
                                style={{
                                  width: `${(t.rinde / maxRinde) * 100}%`,
                                  background: t.rinde < 1 ? "#c2341d" : esFlojo ? "#d08a1c" : "#0f7a4a",
                                }}
                              />
                            </span>
                            <b className="tabular-nums text-neutral-900">{pesos(t.rinde)}</b>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {d.ventasFueraDeTurno > 0 && (
            <p className="text-xs text-neutral-400 mt-2">
              {pesos(d.ventasFueraDeTurno)} se vendieron fuera de los horarios de los turnos.
            </p>
          )}
          {flojo && flojo.rinde !== null && (
            <p className="text-[13.5px] text-neutral-800 bg-amber-50 rounded-lg px-3.5 py-3 mt-3">
              El turno de <b className="text-amber-700">{flojo.horario}</b> es el que menos rinde: por cada $1 de sueldo le deja a
              WiiGo {pesos(flojo.rinde)}
              {flojo.rinde < 1 ? ", así que no paga su propio sueldo" : ""}. Si lo sacás, ahorrás{" "}
              <b className="text-amber-700">{pesos(flojo.cuesta)}</b> por mes, pero alguien tiene que cubrir esas horas: los cobros en
              efectivo de los totems los confirma una persona.
            </p>
          )}
        </section>
      )}

      {/* Hoy y aguinaldo */}
      <section className="grid md:grid-cols-2 gap-4">
        {d.hoy && (
          <div className={`${tarjeta} p-5`}>
            <h2 className="font-semibold text-neutral-900">Hoy en el local</h2>
            <p className="text-xs text-neutral-500">{d.hoy.turnoActual ?? "Fuera de los horarios de turno"}</p>
            <ul className="mt-3 space-y-2 text-[13.5px]">
              {d.hoy.trabajando.map((t) => (
                <li key={`t-${t.nombre}`} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-600" />
                  {t.nombre}
                  <span className="ml-auto text-xs text-neutral-400">desde {t.desde}</span>
                </li>
              ))}
              {d.hoy.deLicencia.map((l) => (
                <li key={`l-${l.nombre}`} className="flex items-center gap-2 text-neutral-500">
                  <span className="w-2 h-2 rounded-full bg-neutral-300" />
                  {l.nombre}
                  <span className="ml-auto text-xs text-neutral-400">{TIPO_LIC[l.tipo] ?? "de licencia"}</span>
                </li>
              ))}
              {d.hoy.sinFichar.map((n) => (
                <li key={`s-${n}`} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  {n}
                  <span className="ml-auto text-xs text-amber-700">no fichó hoy</span>
                </li>
              ))}
              {d.hoy.trabajando.length + d.hoy.deLicencia.length + d.hoy.sinFichar.length === 0 && (
                <li className="text-neutral-400">Todavía no hay empleados cargados.</li>
              )}
            </ul>
          </div>
        )}
        {d.aguinaldoPorMes > 0 && (
          <div className={`${tarjeta} p-5 flex gap-3`}>
            <span aria-hidden="true" className="text-lg">💡</span>
            <div>
              <p className="font-semibold text-neutral-900">Apartá {pesos(d.aguinaldoPorMes)} por mes para el aguinaldo</p>
              <p className="text-[13.5px] text-neutral-500 mt-1">
                En junio y en diciembre se paga medio sueldo más a cada empleado, unos {pesos(d.aguinaldoPorMes * 6)} con el
                equipo de hoy. Separando un poco cada mes no te agarra de golpe. Los tercerizados no cobran aguinaldo.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Lo trabado */}
      <section>
        <p className={`${eyebrow} mb-2`}>Lo que está trabado</p>
        {avisosActivos.length === 0 ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            Todo en orden: no hay fichajes abiertos, sueldos sin cerrar ni honorarios sin pagar.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {avisosActivos.map((a) => (
              <Link
                key={a.clave}
                href={a.href}
                className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:border-amber-300"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-amber-900">{a.titulo}</span>
                  <span className="block text-[11.5px] text-amber-800/80">{a.detalle}</span>
                </span>
                <span className="ml-auto text-xl font-bold tabular-nums text-amber-700">{a.n}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
