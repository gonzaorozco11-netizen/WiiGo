"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HistorialProveedor, PedidoHistorial } from "@/lib/historialProveedor";
import { registrarPagoProveedor } from "@/app/(app)/proveedores/actions";

// Historial de pedidos y cuenta corriente (Gonzalo, 19/11, maqueta aprobada):
// arriba lo que le debés hoy, lo que sigue sin vender y lo pagado; dos botones,
// «Historial de pedidos» (una fila por pedido, se abre) y «Cuenta corriente»
// (liquidaciones y pagos con el saldo, y de qué pedido es cada uno).

const plata = (n: number) => `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const redondo = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "numeric" });

const ESTADO: Record<PedidoHistorial["estado"], { t: string; c: string }> = {
  ARMADO: { t: "Armado · falta pedirlo", c: "bg-amber-50 text-amber-800" },
  PEDIDO: { t: "Pedido · falta recibirlo", c: "bg-blue-50 text-blue-700" },
  RECIBIDO: { t: "Recibido", c: "bg-emerald-50 text-emerald-700" },
};
const MEDIO: Record<string, string> = { TRANSFERENCIA: "Transferencia", EFECTIVO_ADMIN: "Efectivo (Caja Administración)", EFECTIVO_TURNO: "Efectivo del turno" };

export default function HistorialProveedorApp({ datos, vista, puedePagar }: { datos: HistorialProveedor; vista: "historial" | "cuenta" | "costos"; puedePagar: boolean }) {
  const [ver, setVer] = useState<"historial" | "cuenta" | "costos">(vista);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const t = datos.totales;
  const conIva = (n: number) => n * (1 + datos.ivaPorcentaje / 100);
  const boton = (v: typeof ver) =>
    `rounded-xl border px-3.5 py-2 text-sm font-bold ${ver === v ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"}`;

  return (
    <div className="max-w-5xl mx-auto pb-16 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Pedidos a {datos.proveedor.nombre}</h1>
          <p className="text-sm text-neutral-500">Lo que pediste, lo que ya se vendió y lo que le debés</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/compras/pedir" className="rounded-xl border border-emerald-600 bg-white px-3.5 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50">
            + Armar pedido nuevo
          </Link>
          <button type="button" className={boton("historial")} aria-pressed={ver === "historial"} onClick={() => setVer("historial")}>
            Historial de pedidos
          </button>
          <button type="button" className={boton("cuenta")} aria-pressed={ver === "cuenta"} onClick={() => setVer("cuenta")}>
            Cuenta corriente
          </button>
          <button type="button" className={boton("costos")} aria-pressed={ver === "costos"} onClick={() => setVer("costos")}>
            Variaciones de costo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi titulo="Le debés hoy" valor={redondo(t.debeHoy)} pie={`lo ya vendido, sin pagar · con IVA ${redondo(conIva(t.debeHoy))}`} tono="rojo" />
        <Kpi titulo="Sin vender en el local" valor={redondo(t.sinVender)} pie="se paga recién cuando se vende" />
        <Kpi titulo="Ya le pagaste" valor={redondo(t.pagado)} pie={t.pagado > 0 ? "en total" : "todavía no hubo pagos"} tono="verde" />
        <Kpi titulo="Total pedido" valor={redondo(t.totalPedido)} pie={`${datos.pedidos.filter((p) => p.estado === "RECIBIDO").length} recibidos · sin IVA`} />
      </div>

      {ver === "historial" ? (
        <section aria-label="Historial de pedidos" className="space-y-2">
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full min-w-[900px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-neutral-200 text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                  <th className="px-3 py-2.5 text-left">Pedido</th>
                  <th className="px-3 py-2.5 text-left">Estado</th>
                  <th className="px-3 py-2.5 text-right">Total sin IVA</th>
                  <th className="px-3 py-2.5 text-right">Con IVA</th>
                  <th className="px-3 py-2.5 text-right">Vendido</th>
                  <th className="px-3 py-2.5 text-right">Pagado</th>
                  <th className="px-3 py-2.5 text-right">Le debés</th>
                  <th className="px-3 py-2.5 text-right">Sin vender</th>
                  <th className="px-3 py-2.5 text-left">Avance</th>
                </tr>
              </thead>
              <tbody>
                {datos.pedidos.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-neutral-500">
                      Todavía no hay pedidos.
                    </td>
                  </tr>
                )}
                {datos.pedidos.map((p) => {
                  const abierto = abiertos.has(p.idOrden);
                  const vendido = p.liquidado + p.vendidoSinLiquidar;
                  const avance = p.total > 0 ? Math.min(100, (vendido / p.total) * 100) : 0;
                  const alternar = () =>
                    setAbiertos((a) => {
                      const n = new Set(a);
                      if (n.has(p.idOrden)) n.delete(p.idOrden);
                      else n.add(p.idOrden);
                      return n;
                    });
                  return (
                    <Fragment key={p.idOrden}>
                      <tr
                        tabIndex={0}
                        aria-expanded={abierto}
                        onClick={alternar}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            alternar();
                          }
                        }}
                        className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50"
                      >
                        <td className="whitespace-nowrap px-3 py-3 font-semibold text-neutral-900">
                          #{p.numero} · {fecha(p.fecha)}
                          <span className="block text-[11.5px] font-normal text-neutral-500">{p.unidades} productos</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTADO[p.estado].c}`}>{ESTADO[p.estado].t}</span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {plata(p.total)}
                          {p.estimado && <span className="block text-[11px] text-neutral-400">estimado, a costo de hoy</span>}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-neutral-600">{plata(conIva(p.total))}</td>
                        <Monto v={vendido} rojo />
                        <Monto v={p.pagado} verde />
                        <Monto v={p.debe} rojo negrita />
                        <Monto v={p.sinVender} />
                        <td className="px-3 py-3">
                          {p.estado === "RECIBIDO" ? (
                            <>
                              <div className="h-2 w-28 overflow-hidden rounded bg-neutral-100">
                                <div className="h-full bg-red-600" style={{ width: `${avance}%` }} />
                              </div>
                              <span className="text-[11.5px] text-neutral-500">{avance.toLocaleString("es-AR", { maximumFractionDigits: 1 })} % vendido</span>
                            </>
                          ) : (
                            <span className="text-[11.5px] text-neutral-500">{p.estado === "ARMADO" ? "Cargalo en la web" : "Recibilo en Recepción"}</span>
                          )}
                        </td>
                      </tr>
                      {abierto && (
                        <tr className="border-b border-neutral-100 bg-neutral-50">
                          <td colSpan={9} className="px-3 py-2.5 text-[13px] text-neutral-700">
                            <span className="flex flex-wrap gap-x-5 gap-y-1">
                              <span>Ya liquidado: <b className="tabular-nums">{plata(p.liquidado)}</b></span>
                              <span>Vendido sin liquidar: <b className="tabular-nums">{plata(p.vendidoSinLiquidar)}</b></span>
                              {p.nota && <span className="text-neutral-500">{p.nota}</span>}
                              <Link href={p.estado === "RECIBIDO" ? "/compras/recepcion" : `/compras/pedir/${p.idOrden}`} className="font-semibold text-neutral-900 underline">
                                {p.estado === "RECIBIDO" ? "Ver la recepción" : "Ver y cargar en la web"}
                              </Link>
                            </span>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-neutral-500">
            <b>Le debés</b> = lo vendido de ese pedido que todavía no le pagaste, al costo del día en que se vendió cada cosa. <b>Sin vender</b> = lo que sigue en el
            local o el depósito, al costo de hoy: se paga recién cuando se vende, con el costo de ese día. Lo vendido sale primero del pedido más viejo. Con IVA al{" "}
            {datos.ivaPorcentaje} %.
          </p>
        </section>
      ) : ver === "cuenta" ? (
        <Cuenta datos={datos} puedePagar={puedePagar} />
      ) : (
        <Variaciones datos={datos} />
      )}
    </div>
  );
}

/** Cada cambio del costo de la lista (19/11): lo vendido antes queda con su costo; desde ese día, el nuevo. */
function Variaciones({ datos }: { datos: HistorialProveedor }) {
  const [buscar, setBuscar] = useState("");
  if (datos.variaciones === null)
    return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Falta correr sql/historial-costos.sql en Supabase para guardar las variaciones de costo.</p>;
  const plano = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const lista = datos.variaciones.filter((v) => !buscar || plano(v.nombre).includes(plano(buscar)));
  const unidad = (u: string | null) => (u === "BULTO" ? "la bolsa" : u === "CAJA" ? "la caja" : u === "UNIDAD" ? "la unidad" : "el kilo");
  return (
    <section aria-label="Variaciones de costo" className="space-y-2">
      <input
        value={buscar}
        onChange={(e) => setBuscar(e.target.value)}
        placeholder="Buscar un producto"
        className="w-full max-w-sm rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm"
      />
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-neutral-200 text-[11px] font-bold uppercase tracking-wide text-neutral-400">
              <th className="px-3 py-2.5 text-left">Fecha</th>
              <th className="px-3 py-2.5 text-left">Producto de la lista</th>
              <th className="px-3 py-2.5 text-right">Antes</th>
              <th className="px-3 py-2.5 text-right">Ahora</th>
              <th className="px-3 py-2.5 text-right">Cambio</th>
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">
                  {datos.variaciones.length === 0 ? "Todavía no hubo cambios de costo desde que se empezó a guardar el historial." : "No hay cambios de ese producto."}
                </td>
              </tr>
            )}
            {lista.map((v, i) => {
              const pct = v.anterior ? ((v.nuevo - v.anterior) / v.anterior) * 100 : null;
              return (
                <tr key={i} className="border-b border-neutral-100">
                  <td className="whitespace-nowrap px-3 py-2.5 text-neutral-700">
                    {fecha(v.fecha)}
                    {v.quien && <span className="block text-[11px] text-neutral-400">{v.quien}</span>}
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-neutral-900">
                    {v.nombre}
                    <span className="block text-[11px] font-normal text-neutral-400">por {unidad(v.unidad)}, sin IVA</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{v.anterior == null ? "—" : plata(v.anterior)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{plata(v.nuevo)}</td>
                  <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${pct == null ? "text-neutral-400" : pct > 0 ? "text-red-700" : "text-emerald-700"}`}>
                    {pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-neutral-500">
        Lo que se vendió antes de cada cambio se le paga a {datos.proveedor.nombre} con el costo de ese día; lo que se vende desde el cambio, con el costo nuevo.
      </p>
    </section>
  );
}

function Cuenta({ datos, puedePagar }: { datos: HistorialProveedor; puedePagar: boolean }) {
  const router = useRouter();
  const [pagar, setPagar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();

  function enviar(form: HTMLFormElement) {
    setError(null);
    const fd = new FormData(form);
    startTransition(async () => {
      const r = await registrarPagoProveedor(datos.proveedor.id, fd);
      if (r.error) setError(r.error);
      else {
        setPagar(false);
        router.refresh();
      }
    });
  }

  return (
    <section aria-label="Cuenta corriente" className="space-y-2">
      {puedePagar && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setPagar(!pagar)} className="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-bold text-white">
            + Registrar un pago a {datos.proveedor.nombre}
          </button>
        </div>
      )}
      {pagar && (
        <form
          className="grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            enviar(e.currentTarget);
          }}
        >
          <label className="grid gap-1 text-sm font-semibold">
            Cuánto le pagaste
            <input name="monto" type="number" min="1" step="0.01" required placeholder={String(Math.round(datos.totales.debeHoy))} className="rounded-lg border border-neutral-300 px-3 py-2 font-normal" />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Cómo
            <select name="medio_pago" defaultValue="TRANSFERENCIA" className="rounded-lg border border-neutral-300 px-3 py-2 font-normal">
              <option value="TRANSFERENCIA">Transferencia</option>
              <option value="EFECTIVO_ADMIN">Efectivo (Caja Administración)</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
            Nota (opcional)
            <input name="descripcion" placeholder="Ej.: pago del pedido #1" className="rounded-lg border border-neutral-300 px-3 py-2 font-normal" />
          </label>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
            Comprobante (opcional)
            <input name="comprobante" type="file" accept="image/*,application/pdf" className="text-sm font-normal" />
          </label>
          {error && <p className="text-sm text-red-700 sm:col-span-2">{error}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={() => setPagar(false)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
              {guardando ? "Guardando…" : "Guardar el pago"}
            </button>
          </div>
        </form>
      )}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-neutral-200 text-[11px] font-bold uppercase tracking-wide text-neutral-400">
              <th className="px-3 py-2.5 text-left">Fecha</th>
              <th className="px-3 py-2.5 text-left">Qué pasó</th>
              <th className="px-3 py-2.5 text-left">De qué pedido</th>
              <th className="px-3 py-2.5 text-right">Debe (le debés)</th>
              <th className="px-3 py-2.5 text-right">Haber (pagaste)</th>
              <th className="px-3 py-2.5 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {datos.movimientos.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                  Todavía no hay movimientos.
                </td>
              </tr>
            )}
            {datos.movimientos.map((m, i) => (
              <tr key={i} className={`border-b border-neutral-100 ${m.tipo === "SIN_LIQUIDAR" ? "bg-amber-50/50" : ""}`}>
                <td className="whitespace-nowrap px-3 py-3 text-neutral-700">{m.tipo === "SIN_LIQUIDAR" ? "Hasta hoy" : fecha(m.fecha)}</td>
                <td className="px-3 py-3 font-semibold text-neutral-900">
                  {m.tipo === "PAGO" ? `Pago${m.medio ? ` · ${MEDIO[m.medio] ?? m.medio}` : ""}` : m.detalle}
                  {m.tipo === "PAGO" && m.detalle && m.detalle !== "Pago manual" && <span className="block text-[11.5px] font-normal text-neutral-500">{m.detalle}</span>}
                </td>
                <td className="px-3 py-3 text-neutral-700">{m.pedidos.length ? m.pedidos.map((n) => `#${n}`).join(", ") : "—"}</td>
                <Monto v={m.debe} rojo />
                <Monto v={m.haber} verde />
                <td className={`px-3 py-3 text-right font-bold tabular-nums ${m.saldo > 0.5 ? "text-red-700" : "text-neutral-900"}`}>{plata(m.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-neutral-500">
        Cada liquidación suma lo vendido (al costo de cada pedido) y cada pago lo resta. La primera fila suma lo vendido que todavía no entró en una liquidación. El{" "}
        <b>saldo</b> es lo que le debés hoy. Lo que sigue sin vender <b>no entra</b>: todavía no es deuda. Los pagos también se ven en Proveedores.
      </p>
    </section>
  );
}

function Monto({ v, rojo, verde, negrita }: { v: number; rojo?: boolean; verde?: boolean; negrita?: boolean }) {
  if (!(v > 0.004)) return <td className="px-3 py-3 text-right text-neutral-300">—</td>;
  return <td className={`px-3 py-3 text-right tabular-nums ${negrita ? "font-bold" : ""} ${rojo ? "text-red-700" : verde ? "text-emerald-700" : "text-neutral-900"}`}>{plata(v)}</td>;
}

function Kpi({ titulo, valor, pie, tono }: { titulo: string; valor: string; pie: string; tono?: "rojo" | "verde" }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3.5">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">{titulo}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${tono === "rojo" ? "text-red-700" : tono === "verde" ? "text-emerald-700" : "text-neutral-900"}`}>{valor}</p>
      <p className="text-[11.5px] text-neutral-400">{pie}</p>
    </div>
  );
}
