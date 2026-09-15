"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Local } from "@/lib/supabase";
import type { MermaListada, ResumenMerma, DuenioMerma } from "@/lib/mermas";

// La merma del período, con los tres tipos de proveedor mezclados.
//
// La decisión de diseño que manda: arriba van TRES números, no uno. "Perdiste
// $50.000" junta plata que se comporta distinto — una parte se le paga a
// Alifrut, otra salió de tu bolsillo hace rato, y otra no te costó nada
// porque la mercadería era de la marca. Un solo total escondería justo eso.

const MOTIVO_LABEL: Record<string, string> = {
  ROTURA: "Rotura",
  VENCIMIENTO: "Vencimiento",
  ROBO: "Robo",
  OTRO: "Otro",
};

const DUENIO: Record<DuenioMerma, { etiqueta: string; clase: string }> = {
  LIQUIDACION: { etiqueta: "Se le paga", clase: "bg-amber-50 text-amber-700 border-amber-200" },
  PROPIA: { etiqueta: "Pérdida tuya", clase: "bg-red-50 text-red-700 border-red-200" },
  CONSIGNACION: { etiqueta: "De la marca", clase: "bg-neutral-100 text-neutral-500 border-neutral-200" },
};

function monto(v: number) {
  return v.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function fechaCorta(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

export default function MermasApp({
  mermas,
  resumen,
  locales,
  desde,
  hasta,
  idLocal,
}: {
  mermas: MermaListada[];
  resumen: ResumenMerma;
  locales: Local[];
  desde: string;
  hasta: string;
  idLocal: string;
}) {
  const router = useRouter();
  const [filtroDuenio, setFiltroDuenio] = useState<DuenioMerma | "TODOS">("TODOS");

  function cambiarFiltro(campo: string, valor: string) {
    const p = new URLSearchParams({ desde, hasta, local: idLocal });
    p.set(campo, valor);
    router.push(`/stock/merma?${p.toString()}`);
  }

  const visibles = useMemo(
    () => (filtroDuenio === "TODOS" ? mermas : mermas.filter((m) => m.duenio === filtroDuenio)),
    [mermas, filtroDuenio]
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <h1 className="text-xl font-semibold text-neutral-900">Merma</h1>
        <Link href="/stock" className="text-sm font-semibold text-accent hover:underline">
          ← Volver a Stock
        </Link>
      </div>
      <p className="text-sm text-neutral-500 mb-5">
        Mercadería que salió de la góndola sin pasar por la caja. Se carga desde Stock, en cada producto.
      </p>

      {/* Tres números y no uno: la misma bolsa rota cuesta cosas distintas
          según de quién era. */}
      <div className="grid sm:grid-cols-3 gap-2.5 mb-4">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-red-700">Salió de tu bolsillo</p>
          <p className="text-2xl font-extrabold text-red-700 tabular-nums">${monto(resumen.perdidaPropia)}</p>
          <p className="text-xs text-red-700/70">Mercadería que ya habías pagado</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-amber-700">Se le paga al proveedor</p>
          <p className="text-2xl font-extrabold text-amber-700 tabular-nums">${monto(resumen.seLePaga)}</p>
          <p className="text-xs text-amber-700/70">Entra en la próxima liquidación</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-neutral-500">La absorbe la marca</p>
          <p className="text-2xl font-extrabold text-neutral-600 tabular-nums">${monto(resumen.deLaMarca)}</p>
          <p className="text-xs text-neutral-400">No te cuesta plata, sí góndola vacía</p>
        </div>
      </div>

      {/* ---------- Filtros ---------- */}
      <div className="flex gap-2 flex-wrap items-center mb-4">
        <input
          type="date"
          value={desde}
          onChange={(e) => cambiarFiltro("desde", e.target.value)}
          className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm bg-white"
        />
        <span className="text-sm text-neutral-400">al</span>
        <input
          type="date"
          value={hasta}
          onChange={(e) => cambiarFiltro("hasta", e.target.value)}
          className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm bg-white"
        />
        <select
          value={idLocal}
          onChange={(e) => cambiarFiltro("local", e.target.value)}
          className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm bg-white"
        >
          <option value="">Todos los locales</option>
          {locales.map((l) => (
            <option key={l.id_local} value={l.id_local}>
              {l.nombre}
            </option>
          ))}
        </select>

        <div className="flex gap-1.5 ml-auto flex-wrap">
          {(["TODOS", "PROPIA", "LIQUIDACION", "CONSIGNACION"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFiltroDuenio(f)}
              className={`text-xs font-semibold rounded-full px-3 py-1.5 border ${
                filtroDuenio === f
                  ? "bg-accent border-accent text-white"
                  : "bg-white border-neutral-300 text-neutral-600 hover:border-neutral-400"
              }`}
            >
              {f === "TODOS" ? "Todas" : DUENIO[f].etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- La lista ---------- */}
      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        {visibles.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-14">
            {mermas.length === 0
              ? "No se registró ninguna merma en este período. Es la mejor noticia posible."
              : "No hay merma de ese tipo en este período."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-neutral-400 bg-neutral-50 border-b border-neutral-200">
                  <th className="px-4 py-2.5 font-bold">Fecha</th>
                  <th className="px-4 py-2.5 font-bold">Producto</th>
                  <th className="px-4 py-2.5 font-bold">Qué pasó</th>
                  <th className="px-4 py-2.5 font-bold text-right">Un.</th>
                  <th className="px-4 py-2.5 font-bold text-right">Costo</th>
                  <th className="px-4 py-2.5 font-bold">Quién lo absorbe</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((m) => (
                  <tr key={m.idMerma} className="border-b border-neutral-100 last:border-0 align-top">
                    <td className="px-4 py-3 text-neutral-500 tabular-nums whitespace-nowrap">
                      {fechaCorta(m.fecha)}
                      <span className="block text-[11px] text-neutral-400">{m.local}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/producto/${m.idVariante}`} className="font-medium text-neutral-900 hover:text-accent">
                        {m.producto}
                      </Link>
                      <span className="block text-[11px] text-neutral-400">{m.deQuien}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-neutral-700">{MOTIVO_LABEL[m.motivo] ?? m.motivo}</span>
                      {m.detalle && <span className="block text-[11px] text-neutral-400">{m.detalle}</span>}
                      {m.usuario && <span className="block text-[11px] text-neutral-300">{m.usuario}</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-600">{m.cantidad}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-neutral-900 whitespace-nowrap">
                      {m.costoTotal == null ? (
                        <span className="text-neutral-300 font-normal">sin costo</span>
                      ) : (
                        `$${monto(m.costoTotal)}`
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5 ${
                          DUENIO[m.duenio].clase
                        }`}
                      >
                        {DUENIO[m.duenio].etiqueta}
                      </span>
                      {/* Si ya se liquidó, esa plata ya salió: no es algo que
                          todavía se pueda discutir con el proveedor. */}
                      {m.duenio === "LIQUIDACION" && (
                        <span className="block text-[10px] text-neutral-400 mt-1">
                          {m.liquidada ? "ya liquidada" : "pendiente de liquidar"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {visibles.length > 0 && (
        <p className="text-xs text-neutral-400 mt-3">
          {resumen.unidades} unidades perdidas en el período · ${monto(resumen.total)} de mercadería.
        </p>
      )}
    </div>
  );
}
