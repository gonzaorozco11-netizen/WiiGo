"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { actualizarCobros, cargarCobros } from "@/app/(app)/cobros-digitales/actions";
import type { Cobro } from "@/lib/cobrosDigitales";

// Cobros digitales (Gonzalo, 17/11). Maqueta aprobada:
// https://claude.ai/artifact/4oXz2wGBDT5rsCKfWTVMj9
// Arriba: lo que pagaron, lo que sacó el medio de pago y lo que entró, y de quién
// es. Abajo: cada pago, con su cuenta real línea por línea y el reparto por marca.

type Periodo = "HOY" | "AYER" | "SEMANA" | "MES";

const pesos = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(Math.round(v)).toLocaleString("es-AR")}`;

/** Medianoche de Argentina (UTC−3) de hace `dias` días, en ISO. */
function medianocheAr(dias: number) {
  const ahoraAr = new Date(Date.now() - 3 * 3600e3);
  return new Date(Date.UTC(ahoraAr.getUTCFullYear(), ahoraAr.getUTCMonth(), ahoraAr.getUTCDate() - dias, 3)).toISOString();
}
function inicioMesAr() {
  const ahoraAr = new Date(Date.now() - 3 * 3600e3);
  return new Date(Date.UTC(ahoraAr.getUTCFullYear(), ahoraAr.getUTCMonth(), 1, 3)).toISOString();
}
function rango(p: Periodo) {
  if (p === "HOY") return { desde: medianocheAr(0), hasta: medianocheAr(-1) };
  if (p === "AYER") return { desde: medianocheAr(1), hasta: medianocheAr(0) };
  if (p === "SEMANA") return { desde: medianocheAr(6), hasta: medianocheAr(-1) };
  return { desde: inicioMesAr(), hasta: medianocheAr(-1) };
}
const horaAr = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const diaAr = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

export default function CobrosDigitalesApp() {
  const [periodo, setPeriodo] = useState<Periodo>("HOY");
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [sinCobro, setSinCobro] = useState<{ idVenta: string; numero: number; total: number; fecha: string }[]>([]);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState(false);
  const [mostrar, setMostrar] = useState(30);

  const cargar = useCallback(() => {
    const { desde, hasta } = rango(periodo);
    setCargando(true);
    cargarCobros(desde, hasta)
      .then((r) => {
        setError(r.error);
        setCobros(r.cobros);
        setSinCobro(r.ventasSinCobro);
        setUltimo(r.ultimoReporte);
      })
      .finally(() => setCargando(false));
  }, [periodo]);

  useEffect(() => {
    setMostrar(30);
    cargar();
  }, [cargar]);

  async function actualizar() {
    setActualizando(true);
    setMensaje(null);
    const dias = periodo === "MES" ? 31 : periodo === "SEMANA" ? 8 : 3;
    const r = await actualizarCobros(dias);
    setActualizando(false);
    if (r.error) setError(r.error);
    else setMensaje(r.mensaje);
    cargar();
  }

  const t = useMemo(() => {
    const s = { pagaron: 0, saco: 0, entro: 0, vos: 0, marcas: 0, porLinea: new Map<string, number>() };
    const porMarca = new Map<string, { marca: string; propia: boolean; vendido: number; parteMedio: number; comision: number; leToca: number; paraVos: number }>();
    for (const c of cobros) {
      s.pagaron += c.pagoCliente;
      s.saco += c.sacoMedio;
      s.entro += c.entro;
      s.vos += c.paraVos;
      s.marcas += c.deMarcas;
      for (const l of c.lineas) if (l.monto < 0) s.porLinea.set(l.nombre, (s.porLinea.get(l.nombre) ?? 0) - l.monto);
      for (const q of c.reparto) {
        const a = porMarca.get(q.marca) ?? { marca: q.marca, propia: q.propia, vendido: 0, parteMedio: 0, comision: 0, leToca: 0, paraVos: 0 };
        a.vendido += q.vendido;
        a.parteMedio += q.parteMedio;
        a.comision += q.comisionWiigo;
        a.leToca += q.leToca;
        a.paraVos += q.paraVos;
        porMarca.set(q.marca, a);
      }
    }
    return { ...s, porMarca: [...porMarca.values()].sort((a, b) => b.vendido - a.vendido) };
  }, [cobros]);

  const sinVenta = cobros.filter((c) => !c.idVenta);
  const titulo = { HOY: "Lo que entró hoy", AYER: "Lo que entró ayer", SEMANA: "Lo que entró en los últimos 7 días", MES: "Lo que entró este mes" }[periodo];
  const pctVos = t.entro > 0 ? Math.max(0, Math.min(100, (t.vos / t.entro) * 100)) : 0;

  return (
    <div className="max-w-6xl">
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Cobros digitales</h1>
      <p className="text-sm text-neutral-500 mb-4 max-w-3xl">
        Cada pago que entró sin efectivo (QR de la caja y del tótem, tienda online, transferencias y MODO) con lo que Mercado Pago descontó de verdad,
        y cuánto es tuyo y cuánto de cada marca. Los números salen del reporte de Mercado Pago, no de una estimación. Nave (el posnet) se suma más adelante.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex gap-1 bg-white border border-neutral-200 rounded-lg p-1">
          {(
            [
              ["HOY", "Hoy"],
              ["AYER", "Ayer"],
              ["SEMANA", "Últimos 7 días"],
              ["MES", "Este mes"],
            ] as [Periodo, string][]
          ).map(([v, e]) => (
            <button
              key={v}
              onClick={() => setPeriodo(v)}
              className={`text-xs font-bold px-3 py-1.5 rounded-md ${periodo === v ? "bg-accent text-white" : "text-neutral-500 hover:text-neutral-800"}`}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span>
            {ultimo
              ? `Último reporte leído: ${new Date(ultimo).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" })}`
              : "Todavía no se leyó ningún reporte"}
          </span>
          <button
            onClick={actualizar}
            disabled={actualizando}
            className="bg-white border border-neutral-200 rounded-lg px-3 py-1.5 font-bold text-neutral-800 disabled:opacity-50"
          >
            {actualizando ? "Pidiendo a Mercado Pago…" : "Actualizar ahora"}
          </button>
        </div>
      </div>

      {mensaje && <p className="text-sm bg-accent-tint text-neutral-700 rounded-lg px-3 py-2 mb-4">{mensaje}</p>}
      {error && <p className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2 mb-4">{error}</p>}

      {cargando ? (
        <p className="text-sm text-neutral-400 text-center py-12">Cargando...</p>
      ) : (
        <>
          <section className="bg-white border border-neutral-200 rounded-xl p-5 mb-4">
            <h2 className="text-[15px] font-extrabold">{titulo}</h2>
            <p className="text-xs text-neutral-400 mb-4">
              {cobros.length} pago{cobros.length === 1 ? "" : "s"} sin efectivo
              {t.pagaron > 0 ? `. De cada $1.000 que pagaron los clientes, el medio de pago se quedó con ${pesos((t.saco / t.pagaron) * 1000)}.` : "."}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-3 items-stretch">
              <Caja lab="Pagaron los clientes" val={pesos(t.pagaron)} det={`${cobros.length} pagos`} />
              <span className="hidden md:block self-center text-2xl font-extrabold text-neutral-300">−</span>
              <Caja
                lab="Sacó el medio de pago"
                val={pesos(t.saco)}
                det={[...t.porLinea.entries()].sort((a, b) => b[1] - a[1]).map(([n, m]) => `${n} ${pesos(m)}`).join(" · ") || "—"}
                rojo
              />
              <span className="hidden md:block self-center text-2xl font-extrabold text-neutral-300">=</span>
              <Caja lab="Entró de verdad" val={pesos(t.entro)} det="lo que llegó a tu cuenta" azul />
            </div>

            {t.porMarca.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-5 mt-5">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500 mb-2">De quién es lo que entró</p>
                  <div className="flex h-3.5 rounded overflow-hidden gap-0.5 mb-3" aria-hidden>
                    <i className="block h-full bg-accent" style={{ width: `${pctVos}%` }} />
                    <i className="block h-full bg-teal-700" style={{ width: `${100 - pctVos}%` }} />
                  </div>
                  <Ley color="bg-accent" titulo="Es tuyo" sub="lo de WiiGo Dietética más las comisiones que cobrás a las marcas" monto={t.vos} />
                  <Ley color="bg-teal-700" titulo="Es de las marcas" sub="lo que les toca en la liquidación" monto={t.marcas} />
                  {cobros.some((c) => !c.idVenta) && (
                    <p className="text-xs text-neutral-400 mt-2">Los pagos sin venta en el sistema cuentan como tuyos hasta que se aclaren.</p>
                  )}
                </div>
                <TablaReparto filas={t.porMarca} total={{ vendido: t.porMarca.reduce((s, q) => s + q.vendido, 0), parteMedio: t.porMarca.reduce((s, q) => s + q.parteMedio, 0), leToca: t.marcas, paraVos: t.porMarca.reduce((s, q) => s + q.paraVos, 0) }} />
              </div>
            )}
          </section>

          {(sinVenta.length > 0 || sinCobro.length > 0) && (
            <section className="bg-white border border-neutral-200 rounded-xl p-5 mb-4">
              <h2 className="text-[15px] font-extrabold mb-2">Para revisar</h2>
              <div className="flex flex-col gap-2 text-sm">
                {sinVenta.map((c) => (
                  <div key={c.idExterno} className="rounded-lg bg-red-50 px-3 py-2">
                    <b>Cobro de {pesos(c.pagoCliente)} sin venta en el sistema</b> · {diaAr(c.fecha)} {horaAr(c.fecha)} · {c.medio}
                    <span className="text-neutral-500"> · puede ser algo cobrado desde la app de Mercado Pago, fuera de la caja (Mercado Pago n.º {c.idExterno})</span>
                  </div>
                ))}
                {sinCobro.map((v) => (
                  <div key={v.idVenta} className="rounded-lg bg-red-50 px-3 py-2">
                    <b>Venta #{v.numero} cobrada por Mercado Pago, pero su cobro no está en los reportes</b> · {pesos(v.total)} · {diaAr(v.fecha)}
                    <span className="text-neutral-500"> · revisar si se anuló o si se cobró por otro lado</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="bg-white border border-neutral-200 rounded-xl p-5">
            <h2 className="text-[15px] font-extrabold">Cada pago</h2>
            <p className="text-xs text-neutral-400 mb-3">Tocá un pago para ver qué le sacó el medio de pago y cómo se reparte entre vos y las marcas.</p>
            {cobros.length === 0 ? (
              <p className="text-sm text-neutral-500 py-8 text-center">
                No hay pagos en este período{ultimo ? "." : ". Tocá «Actualizar ahora» para pedirle a Mercado Pago el primer reporte."}
                <br />
                <span className="text-neutral-400">Mercado Pago informa cada pago recién cuando lo libera: el débito, a los 2 días.</span>
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {cobros.slice(0, mostrar).map((c, i) => {
                  const nuevoDia = i === 0 || diaAr(cobros[i - 1].fecha) !== diaAr(c.fecha);
                  return (
                    <div key={`${c.proveedor}-${c.idExterno}`}>
                      {nuevoDia && <p className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-400 mt-3 mb-1">{diaAr(c.fecha)}</p>}
                      <FilaCobro c={c} />
                    </div>
                  );
                })}
                {cobros.length > mostrar && (
                  <button onClick={() => setMostrar((m) => m + 30)} className="self-center mt-2 bg-white border border-neutral-200 rounded-lg px-3 py-1.5 text-xs font-bold">
                    Ver más (quedan {cobros.length - mostrar})
                  </button>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Caja({ lab, val, det, rojo, azul }: { lab: string; val: string; det: string; rojo?: boolean; azul?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 min-w-0 ${azul ? "border-accent bg-accent-tint" : "border-neutral-200"}`}>
      <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">{lab}</p>
      <p className={`text-2xl font-extrabold tabular-nums ${rojo ? "text-red-700" : ""}`}>{val}</p>
      <p className="text-xs text-neutral-500">{det}</p>
    </div>
  );
}

function Ley({ color, titulo, sub, monto }: { color: string; titulo: string; sub: string; monto: number }) {
  return (
    <div className="grid grid-cols-[12px_1fr_auto] gap-2 items-baseline mb-2">
      <span className={`w-3 h-3 rounded-sm self-center ${color}`} />
      <span className="text-sm">
        {titulo}
        <small className="block text-xs text-neutral-400">{sub}</small>
      </span>
      <b className="text-lg tabular-nums">{pesos(monto)}</b>
    </div>
  );
}

type FilaReparto = { marca: string; propia: boolean; vendido: number; parteMedio: number; comision?: number; comisionWiigo?: number; comisionTexto?: string; leToca: number; paraVos: number };

function TablaReparto({ filas, total }: { filas: FilaReparto[]; total: { vendido: number; parteMedio: number; leToca: number; paraVos: number } }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] min-w-[560px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-wider text-neutral-400">
            <th className="text-left font-bold py-1.5 px-2">Marca</th>
            <th className="text-right font-bold py-1.5 px-2">Vendió</th>
            <th className="text-right font-bold py-1.5 px-2">Su parte del medio de pago</th>
            <th className="text-right font-bold py-1.5 px-2">Comisión WiiGo</th>
            <th className="text-right font-bold py-1.5 px-2">Le toca</th>
            <th className="text-right font-bold py-1.5 px-2">Para vos</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {filas.map((q) => {
            const com = q.comisionWiigo ?? q.comision ?? 0;
            return (
              <tr key={q.marca} className="border-t border-neutral-100">
                <td className="py-1.5 px-2">
                  {q.marca}
                  {q.comisionTexto ? <span className="text-neutral-400 text-xs"> ({q.comisionTexto})</span> : null}
                </td>
                <td className="py-1.5 px-2 text-right">{q.vendido ? pesos(q.vendido) : "—"}</td>
                <td className="py-1.5 px-2 text-right text-red-700">{q.parteMedio ? pesos(-q.parteMedio) : "—"}</td>
                <td className="py-1.5 px-2 text-right">{q.propia ? "—" : pesos(-com)}</td>
                <td className="py-1.5 px-2 text-right font-bold">{q.propia ? "—" : pesos(q.leToca)}</td>
                <td className="py-1.5 px-2 text-right font-bold">{pesos(q.paraVos)}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-neutral-900 font-extrabold">
            <td className="py-1.5 px-2">Total</td>
            <td className="py-1.5 px-2 text-right">{pesos(total.vendido)}</td>
            <td className="py-1.5 px-2 text-right text-red-700">{pesos(-total.parteMedio)}</td>
            <td />
            <td className="py-1.5 px-2 text-right">{pesos(total.leToca)}</td>
            <td className="py-1.5 px-2 text-right">{pesos(total.paraVos)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FilaCobro({ c }: { c: Cobro }) {
  const [abierto, setAbierto] = useState(false);
  const [verCrudo, setVerCrudo] = useState(false);
  const marcas = c.reparto.filter((q) => q.vendido > 0).map((q) => q.marca).join(", ");
  return (
    <div className="border border-neutral-200 rounded-xl">
      <button
        onClick={() => setAbierto((a) => !a)}
        className={`w-full text-left grid grid-cols-[48px_1fr_auto_16px] md:grid-cols-[52px_1.4fr_repeat(3,minmax(90px,.7fr))_16px] gap-3 items-center px-4 py-2.5 rounded-xl hover:bg-accent-tint ${abierto ? "rounded-b-none border-b border-neutral-200" : ""}`}
      >
        <span className="font-extrabold tabular-nums">{horaAr(c.fecha)}</span>
        <span className="min-w-0">
          <b className="block text-[13.5px]">
            {c.numeroVenta ? `Venta #${c.numeroVenta}` : "Sin venta en el sistema"}
            {c.avisos.length > 0 && <span className="ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">revisar</span>}
          </b>
          <span className="text-xs text-neutral-400">
            {c.medio}
            {c.billetera ? ` · ${c.billetera}` : ""}
            {marcas ? ` · ${marcas}` : ""}
          </span>
        </span>
        <span className="hidden md:block text-right">
          <small className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">Pagó</small>
          <span className="font-bold tabular-nums">{pesos(c.pagoCliente)}</span>
        </span>
        <span className="hidden md:block text-right">
          <small className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">Sacó el medio</small>
          <span className="font-bold tabular-nums text-red-700">{pesos(-c.sacoMedio)}</span>
        </span>
        <span className="text-right">
          <small className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">Entró</small>
          <span className="font-bold tabular-nums">{pesos(c.entro)}</span>
        </span>
        <span className={`text-neutral-400 transition-transform ${abierto ? "rotate-90" : ""}`}>›</span>
      </button>
      {abierto && (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-[.9fr_1.6fr] gap-5">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500 mb-1.5">1 · Qué sacó Mercado Pago</p>
            <Linea a="Pagó el cliente" b={pesos(c.pagoCliente)} />
            {c.lineas.map((l, i) => (
              <Linea key={i} a={l.nombre} nota={l.nota} b={pesos(l.monto)} rojo={l.monto < 0} />
            ))}
            <div className="flex justify-between border-t-2 border-neutral-900 mt-1 pt-2 font-extrabold text-sm">
              <span>Entró a tu cuenta</span>
              <span className="tabular-nums">{pesos(c.entro)}</span>
            </div>
            {c.avisos.map((a) => (
              <p key={a} className="text-xs text-amber-700 mt-2">{a}</p>
            ))}
            <p className="text-xs text-neutral-400 mt-2">
              Acreditado el {new Date(c.acreditado).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" })} · Mercado Pago n.º {c.idExterno}
            </p>
            <button onClick={() => setVerCrudo((v) => !v)} className="text-xs font-bold text-accent mt-1">
              {verCrudo ? "Ocultar" : "Ver"} lo que informó Mercado Pago
            </button>
            {verCrudo && (
              <pre className="mt-2 text-[11px] bg-neutral-50 border border-neutral-200 rounded-lg p-2 overflow-x-auto max-h-64">{JSON.stringify(c.crudo, null, 1)}</pre>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500 mb-1.5">2 · De quién es lo que entró</p>
            {c.reparto.length === 0 ? (
              <p className="text-sm text-neutral-500">Sin venta en el sistema: no se puede repartir. Cuenta como tuyo hasta que se aclare.</p>
            ) : (
              <TablaReparto
                filas={c.reparto}
                total={{ vendido: c.reparto.reduce((s, q) => s + q.vendido, 0), parteMedio: c.reparto.reduce((s, q) => s + q.parteMedio, 0), leToca: c.deMarcas, paraVos: c.paraVos }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Linea({ a, b, nota, rojo }: { a: string; b: string; nota?: string; rojo?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-dashed border-neutral-200 text-[13px]">
      <span>
        {a}
        {nota ? <small className="text-neutral-400"> {nota}</small> : null}
      </span>
      <span className={`tabular-nums ${rojo ? "text-red-700" : ""}`}>{b}</span>
    </div>
  );
}
