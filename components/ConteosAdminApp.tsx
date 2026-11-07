"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolverDiferencia, type CausaDiferencia } from "@/app/(app)/stock/conteos/actions";

// Conteos del local, del lado de Gonzalo: las diferencias que quedan abiertas
// (con su historia: quién contó, cuánto, y si otra persona lo confirmó) y los
// conteos firmados con su firma.

export type DiferenciaVista = {
  id: string;
  producto: string;
  local: string | null;
  estado: "ABIERTA" | "CONFIRMADA";
  esperado: number;
  contado: number;
  diferencia: number;
  contadoPor: string;
  contadoEn: string;
  recuento: number | null;
  recontadoPor: string | null;
  recontadoEn: string | null;
};

export type ConteoFirmadoVista = {
  id: string;
  nombre: string;
  local: string | null;
  cuando: string;
  estado: "ABIERTO" | "FIRMADO";
  productos: number;
  contados: number;
  diferencias: number;
  firma: string | null;
};

const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const CAUSAS: { id: CausaDiferencia; texto: string }[] = [
  { id: "CONTARON_MAL", texto: "Contaron mal" },
  { id: "FALTANTE", texto: "Faltante: rotura, robo o vencido" },
  { id: "RECEPCION", texto: "La recepción se cargó mal" },
];

export default function ConteosAdminApp({
  kpis,
  diferencias,
  conteos,
}: {
  kpis: { contados: number; bien: number; porResolver: number; pctLocal: number };
  diferencias: DiferenciaVista[];
  conteos: ConteoFirmadoVista[];
}) {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Conteos de stock</h1>
          <p className="text-sm text-neutral-500 mt-1">Lo que contó el equipo en sus turnos, sin ver el número del sistema.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Kpi valor={kpis.contados} texto="Contados (7 días)" />
          <Kpi valor={kpis.bien} texto="Coincidieron" tono="ok" />
          <Kpi valor={kpis.porResolver} texto="Por resolver" tono={kpis.porResolver ? "mal" : undefined} />
          <Kpi valor={`${kpis.pctLocal}%`} texto="Local contado (30 días)" />
        </div>
      </div>

      <section className="mb-7">
        <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-3">Diferencias por resolver</h2>
        {diferencias.length === 0 ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 px-4 py-6 text-center text-sm font-medium">
            ✓ No hay diferencias abiertas.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {diferencias.map((d) => (
              <Diferencia key={d.id} d={d} />
            ))}
          </div>
        )}
        <p className="text-xs text-neutral-500 mt-3 leading-relaxed max-w-2xl">
          El stock ya quedó en lo que contaron, en el momento. El producto vuelve a salir en el próximo conteo, mejor para otra
          persona: si da lo mismo, aparece «Se confirmó». Si fue un error de conteo, corregí el número en Stock.
        </p>
      </section>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-3">Conteos de las últimas 2 semanas</h2>
        {conteos.length === 0 ? (
          <p className="text-sm text-neutral-500 py-6 text-center">Todavía no se hizo ningún conteo.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500">
                  <th className="px-4 py-2.5 font-semibold">Cuándo</th>
                  <th className="px-2 py-2.5 font-semibold">Quién</th>
                  <th className="px-2 py-2.5 font-semibold">Productos</th>
                  <th className="px-2 py-2.5 font-semibold">Resultado</th>
                  <th className="px-4 py-2.5 font-semibold">Firma</th>
                </tr>
              </thead>
              <tbody>
                {conteos.map((c) => (
                  <tr key={c.id} className="border-t border-neutral-100">
                    <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{cuando(c.cuando)}</td>
                    <td className="px-2 py-2.5">
                      {c.nombre}
                      {c.local && <span className="block text-xs text-neutral-400">{c.local}</span>}
                    </td>
                    <td className="px-2 py-2.5 tabular-nums">{c.estado === "FIRMADO" ? c.productos : `${c.contados} de ${c.productos}`}</td>
                    <td className="px-2 py-2.5">
                      {c.estado !== "FIRMADO" ? (
                        <Pill tono="gris">Sin terminar</Pill>
                      ) : c.diferencias ? (
                        <Pill tono="mal">
                          {c.diferencias} {c.diferencias === 1 ? "diferencia" : "diferencias"}
                        </Pill>
                      ) : (
                        <Pill tono="ok">Todo bien</Pill>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {c.firma ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.firma} alt={`Firma de ${c.nombre}`} className="h-8 w-auto rounded border border-neutral-200 bg-white" />
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({ valor, texto, tono }: { valor: number | string; texto: string; tono?: "ok" | "mal" }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2 min-w-[7rem]">
      <span className={`block text-xl font-semibold tabular-nums ${tono === "ok" ? "text-emerald-700" : tono === "mal" ? "text-red-700" : "text-neutral-900"}`}>
        {valor}
      </span>
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{texto}</span>
    </div>
  );
}

function Pill({ tono, children }: { tono: "ok" | "mal" | "ojo" | "gris"; children: React.ReactNode }) {
  const c = {
    ok: "bg-emerald-50 text-emerald-700",
    mal: "bg-red-50 text-red-700",
    ojo: "bg-amber-50 text-amber-800",
    gris: "bg-neutral-100 text-neutral-600",
  }[tono];
  return <span className={`inline-block text-[11px] font-bold rounded-full px-2.5 py-0.5 whitespace-nowrap ${c}`}>{children}</span>;
}

function Diferencia({ d }: { d: DiferenciaVista }) {
  const router = useRouter();
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();
  const faltan = d.diferencia < 0;
  const confirmada = d.estado === "CONFIRMADA";

  function resolver(causa: CausaDiferencia) {
    setError(null);
    startTransition(async () => {
      const r = await resolverDiferencia(d.id, causa, nota);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className={`rounded-xl border border-l-4 bg-white p-4 ${confirmada ? "border-amber-200 border-l-amber-500" : "border-red-200 border-l-red-500"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-neutral-900">{d.producto}</p>
          {d.local && <p className="text-xs text-neutral-400">{d.local}</p>}
        </div>
        <Pill tono={confirmada ? "ojo" : "mal"}>
          {confirmada ? "Se confirmó: " : ""}
          {faltan ? `faltan ${-d.diferencia}` : `sobran ${d.diferencia}`}
        </Pill>
      </div>

      <ol className="mt-3 space-y-2 text-sm">
        <li className="flex gap-2.5">
          <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" aria-hidden="true" />
          <span>
            <b>{d.contadoPor}</b> contó <b className="tabular-nums">{d.contado}</b>, el sistema decía{" "}
            <b className="tabular-nums">{d.esperado}</b>
            <span className="block text-xs text-neutral-500">{cuando(d.contadoEn)} · contó dos veces y firmó · el stock quedó en {d.contado}</span>
          </span>
        </li>
        {d.recuento != null ? (
          <li className="flex gap-2.5">
            <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${confirmada ? "bg-amber-500" : "bg-neutral-400"}`} aria-hidden="true" />
            <span>
              <b>{d.recontadoPor ?? "Otra persona"}</b> volvió a contar: <b className="tabular-nums">{d.recuento}</b>
              <span className="block text-xs text-neutral-500">
                {d.recontadoEn ? `${cuando(d.recontadoEn)} · ` : ""}
                {confirmada
                  ? d.recontadoPor && d.recontadoPor !== d.contadoPor
                    ? "Otra persona, mismo número: no fue un error de conteo."
                    : "Dio lo mismo (la misma persona)."
                  : "Dio otro número: puede que el primer conteo estuviera mal."}
              </span>
            </span>
          </li>
        ) : (
          <li className="flex gap-2.5 text-neutral-500">
            <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-neutral-300 shrink-0" aria-hidden="true" />
            <span>Vuelve a salir en el próximo conteo para confirmarlo.</span>
          </li>
        )}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Nota (opcional)"
          className="flex-1 min-w-[10rem] rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {CAUSAS.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={guardando}
            onClick={() => resolver(c.id)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-40"
          >
            {c.texto}
          </button>
        ))}
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
