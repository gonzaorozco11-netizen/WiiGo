"use client";

import Link from "next/link";
import type { PanelProveedores } from "@/lib/panelProveedores";

// El panel de Marcas y Proveedores.
//
// Todo lo que muestra existe en otras pantallas; lo que agrega es poder verlo
// junto y en una dirección: qué plata sale, qué entra, qué vence y qué está
// trabado. Cada bloque lleva el link a la pantalla donde se resuelve — un
// panel que solo informa se mira dos veces y después no.

function monto(v: number) {
  return v.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function cuando(dias: number) {
  if (dias < 0) return `venció hace ${-dias} ${-dias === 1 ? "día" : "días"}`;
  if (dias === 0) return "vence hoy";
  if (dias === 1) return "vence mañana";
  return `en ${dias} días`;
}

export default function PanelProveedoresApp({ panel }: { panel: PanelProveedores }) {
  const { sale, entra, trabas } = panel;
  const totalVence = panel.vencido + panel.estaSemana + panel.masAdelante;
  const ancho = (v: number) => (totalVence > 0 ? `${(v / totalVence) * 100}%` : "0%");

  const maxCompra = Math.max(...panel.compras.map((c) => c.costo), 1);
  const maxMarca = Math.max(...panel.marcas.map((m) => m.teQueda), 1);

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">Panel</h1>
      <p className="text-sm text-neutral-500 mb-5">
        {new Date(`${panel.desde}T12:00:00`).toLocaleDateString("es-AR", { month: "long", year: "numeric" })} · al{" "}
        {new Date(`${panel.hasta}T12:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
      </p>

      {/* ---------- Las dos direcciones ----------
          Abiertas por quién y no solo el total: "$57.475" no dice nada,
          "Coca Cola $24.200" dice a quién llamar. */}
      <div className="grid sm:grid-cols-2 gap-2.5 mb-2.5">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-red-700">
            Sale — le debés a proveedores
          </p>
          <p className="text-3xl font-extrabold text-red-700 tabular-nums leading-tight">${monto(sale.total)}</p>
          {sale.detalle.length > 0 && (
            <div className="mt-2 pt-2 border-t border-red-200 space-y-0.5">
              {sale.detalle.slice(0, 4).map((d) => (
                <div key={d.nombre} className="flex justify-between gap-3 text-xs text-red-700/85 tabular-nums">
                  <span className="truncate">
                    {d.nombre} <span className="opacity-60">· {d.nota}</span>
                  </span>
                  <span className="font-semibold whitespace-nowrap">${monto(d.monto)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-emerald-700">
            Entra — te deben las marcas
          </p>
          <p className="text-3xl font-extrabold text-emerald-700 tabular-nums leading-tight">${monto(entra.total)}</p>
          {entra.detalle.length > 0 ? (
            <div className="mt-2 pt-2 border-t border-emerald-200 space-y-0.5">
              {entra.detalle.slice(0, 4).map((d) => (
                <div key={d.nombre} className="flex justify-between gap-3 text-xs text-emerald-700/85 tabular-nums">
                  <span className="truncate">
                    {d.nombre} <span className="opacity-60">· {d.nota}</span>
                  </span>
                  <span className="font-semibold whitespace-nowrap">${monto(d.monto)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-emerald-700/70 mt-1">Ninguna marca con saldo a cobrar</p>
          )}
        </div>
      </div>

      {/* ---------- Vencimientos ----------
          El único bloque que no se puede ver hoy en ninguna pantalla: la
          fecha está en cada factura desde que se carga y nunca se mostró. */}
      <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden mb-2.5">
        <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between gap-3">
          <p className="text-[12.5px] font-semibold text-neutral-900">Cuándo hay que pagar</p>
          <span className="text-xs text-neutral-400">
            {panel.vencimientos.length === 0
              ? "sin facturas abiertas"
              : `${panel.vencimientos.length} ${panel.vencimientos.length === 1 ? "factura abierta" : "facturas abiertas"}`}
          </span>
        </div>

        {panel.vencimientos.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">
            No hay facturas pendientes de pago. Nada por vencer.
          </p>
        ) : (
          <>
            {/* Todo el bloque en un vistazo: si la barra está toda gris, no
                hace falta leer ninguna fila. */}
            <div className="flex h-2">
              <span className="bg-red-600" style={{ width: ancho(panel.vencido) }} />
              <span className="bg-amber-500" style={{ width: ancho(panel.estaSemana) }} />
              <span className="bg-neutral-300" style={{ width: ancho(panel.masAdelante) }} />
            </div>
            <div>
              {panel.vencimientos.slice(0, 8).map((v) => {
                const tono = v.dias < 0 ? "text-red-600" : v.dias <= 7 ? "text-amber-600" : "text-neutral-400";
                const punto = v.dias < 0 ? "bg-red-600" : v.dias <= 7 ? "bg-amber-500" : "bg-neutral-300";
                return (
                  <div
                    key={v.idFactura}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-neutral-100 last:border-0 flex-wrap"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${punto}`} />
                    <span className="flex-1 min-w-[140px] text-[13.5px] font-semibold text-neutral-900">
                      {v.proveedor}
                      {v.numero && (
                        <span className="font-normal text-xs text-neutral-400">
                          {" "}
                          · {v.tipoComprobante ?? ""} #{v.numero}
                        </span>
                      )}
                    </span>
                    <span className={`text-[11.5px] font-semibold ${tono}`}>{cuando(v.dias)}</span>
                    <span className={`text-sm font-bold tabular-nums whitespace-nowrap ${tono === "text-neutral-400" ? "text-neutral-700" : tono}`}>
                      ${monto(v.monto)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ---------- Lo trabado ----------
          Lo que está en cero se ve apagado, no se esconde: que diga "0" es
          la confirmación de que el sistema lo miró. */}
      <div className="grid sm:grid-cols-2 gap-2.5 mb-2.5">
        <Traba
          icono="📄"
          titulo="Entregas sin costear"
          detalle={
            trabas.sinCostear === 0
              ? "Todo lo que llegó tiene su costo"
              : `La más vieja hace ${trabas.sinCostearDiasMax} ${trabas.sinCostearDiasMax === 1 ? "día" : "días"}`
          }
          valor={trabas.sinCostear}
          href="/compras/costeo"
          urge={trabas.sinCostear > 0}
        />
        <Traba
          icono="🧾"
          titulo="Liquidaciones sin factura"
          detalle={
            trabas.liqSinFactura === 0
              ? "Todas facturadas"
              : `$${monto(trabas.liqSinFacturaIva)} de IVA sin computar`
          }
          valor={trabas.liqSinFactura}
          href="/proveedores"
          urge={trabas.liqSinFactura > 0}
        />
        <Traba
          icono="↩️"
          titulo="Reclamos abiertos"
          detalle={
            trabas.reclamos === 0 ? "Nada que reclamar" : `$${monto(trabas.reclamosMonto)} a recuperar`
          }
          valor={trabas.reclamos}
          href="/compras/reclamos"
          urge={trabas.reclamos > 0}
        />
        <Traba
          icono={trabas.solicitudes === 0 ? "✓" : "📥"}
          titulo="Solicitudes de marcas"
          detalle={trabas.solicitudes === 0 ? "Nada esperando respuesta" : "Esperando que las respondas"}
          valor={trabas.solicitudes}
          href="/aprobaciones"
          urge={trabas.solicitudes > 0}
        />
      </div>

      {/* ---------- Los dos rankings ---------- */}
      <div className="grid md:grid-cols-2 gap-2.5">
        <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 flex justify-between gap-3">
            <p className="text-[12.5px] font-semibold text-neutral-900">A quién le comprás</p>
            <span className="text-[11.5px] text-neutral-400">costeado en el mes</span>
          </div>
          {panel.compras.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-8">No entró mercadería este mes.</p>
          ) : (
            panel.compras.slice(0, 5).map((c) => (
              <div key={c.idProveedor} className="px-4 py-2.5 border-b border-neutral-100 last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/proveedor/${c.idProveedor}`} className="text-[13.5px] font-semibold text-neutral-900 hover:text-accent">
                    {c.nombre}
                  </Link>
                  <span className="text-sm font-bold tabular-nums whitespace-nowrap">${monto(c.costo)}</span>
                </div>
                <div className="flex justify-between gap-3 text-[11px] text-neutral-400 mt-0.5">
                  <span>
                    {c.unidades} unidades · {c.entregas} {c.entregas === 1 ? "entrega" : "entregas"}
                  </span>
                  {/* La merma al lado del costo: si un proveedor te concentra
                      las compras Y lo que se rompe, se ve de una. */}
                  <span className={c.merma > 0 ? "text-amber-700 font-semibold" : ""}>
                    merma ${monto(c.merma)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-neutral-100 mt-1.5 overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${(c.costo / maxCompra) * 100}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 flex justify-between gap-3">
            <p className="text-[12.5px] font-semibold text-neutral-900">Qué te deja cada marca</p>
            <span className="text-[11.5px] text-neutral-400">royalty del mes</span>
          </div>
          {panel.marcas.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-8">Todavía no hay marcas en consignación.</p>
          ) : (
            panel.marcas.slice(0, 5).map((m) => (
              <div
                key={m.idMarca}
                className={`px-4 py-2.5 border-b border-neutral-100 last:border-0 ${m.teQueda === 0 ? "opacity-60" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/marcas/${m.idMarca}`} className="text-[13.5px] font-semibold text-neutral-900 hover:text-accent">
                    {m.nombre}
                  </Link>
                  <span className="text-sm font-bold tabular-nums whitespace-nowrap">${monto(m.teQueda)}</span>
                </div>
                <div className="flex justify-between gap-3 text-[11px] text-neutral-400 mt-0.5">
                  <span>
                    royalty {m.royalty}% · plan {m.plan.charAt(0) + m.plan.slice(1).toLowerCase()}
                  </span>
                  {/* La venta bruta al lado: una marca en $0 con ventas en $0
                      no es lo mismo que una que recién arranca. */}
                  <span>{m.ventaBruta > 0 ? `$${monto(m.ventaBruta)} vendido` : "sin ventas este mes"}</span>
                </div>
                <div className="h-1.5 rounded-full bg-neutral-100 mt-1.5 overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-violet-500"
                    style={{ width: `${(m.teQueda / maxMarca) * 100}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Traba({
  icono,
  titulo,
  detalle,
  valor,
  href,
  urge,
}: {
  icono: string;
  titulo: string;
  detalle: string;
  valor: number;
  href: string;
  urge: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex gap-3 items-start border rounded-xl px-4 py-3 ${
        urge
          ? "bg-amber-50 border-amber-200 hover:border-amber-300"
          : "bg-white border-neutral-200 opacity-60 hover:opacity-100"
      }`}
    >
      <span
        className={`shrink-0 w-[30px] h-[30px] rounded-lg flex items-center justify-center text-sm ${
          urge ? "bg-amber-100 text-amber-700" : "bg-neutral-100 text-neutral-400"
        }`}
      >
        {icono}
      </span>
      <span className="min-w-0">
        <span className={`block text-[13.5px] font-semibold ${urge ? "text-amber-800" : "text-neutral-700"}`}>
          {titulo}
        </span>
        <span className={`block text-[11.5px] ${urge ? "text-amber-700/80" : "text-neutral-400"}`}>{detalle}</span>
      </span>
      <span
        className={`ml-auto text-xl font-bold tabular-nums leading-tight ${
          urge ? "text-amber-700" : "text-neutral-300"
        }`}
      >
        {valor}
      </span>
    </Link>
  );
}
