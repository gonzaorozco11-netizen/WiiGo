"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resolverOpinionPaciente, type OpinionParaAprobar } from "@/app/(app)/profesionales/actions";

// Lo que escribieron los pacientes con el link de su profesional
// (app/opinion). Solo sale en la pantalla del local si se aprueba acá.
export default function AprobacionesOpinionesPacientes({ opiniones, esAdmin }: { opiniones: OpinionParaAprobar[]; esAdmin: boolean }) {
  if (opiniones.length === 0) return null;
  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-lg font-extrabold text-neutral-900">
          Opiniones de pacientes{" "}
          <span className="ml-1 text-sm font-bold text-white bg-red-600 rounded-full px-2 py-0.5 tabular-nums">{opiniones.length}</span>
        </h2>
        <p className="text-xs text-neutral-500">Las escribió el paciente con su link. La profesional ya las ve en su espacio.</p>
      </div>
      {!esAdmin && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">Las opiniones las aprueba el Dueño.</p>}
      <div className="flex flex-col gap-3">
        {opiniones.map((o) => (
          <TarjetaOpinion key={o.idOpinion} opinion={o} esAdmin={esAdmin} />
        ))}
      </div>
    </section>
  );
}

function TarjetaOpinion({ opinion: o, esAdmin }: { opinion: OpinionParaAprobar; esAdmin: boolean }) {
  const router = useRouter();
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  function correr(aprobar: boolean) {
    setError(null);
    setTrabajando(true);
    resolverOpinionPaciente(o.idOpinion, aprobar)
      .then((r) => {
        if (r.error) return setError(r.error);
        setHecho(aprobar ? "Aprobada: ya sale en la pantalla del local." : "No se publica. Ella ve que WiiGo no la publicó.");
        router.refresh();
      })
      .finally(() => setTrabajando(false));
  }

  return (
    <article className={`bg-white border border-neutral-200 rounded-2xl overflow-hidden ${hecho ? "opacity-60" : ""}`}>
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm font-bold text-neutral-900">
            {o.profesional.nombre} · <span className="font-semibold text-neutral-600">opinión nueva</span>
          </p>
          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-0.5">✓ Escrita por su paciente</span>
        </div>
        <p className="text-[15px] text-neutral-800 leading-relaxed break-words">«{o.texto}»</p>
        <p className="text-xs font-bold text-neutral-500">
          {o.firma} · {new Date(o.fecha).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </p>
        <p className="text-xs text-neutral-500">Fijate que no tenga datos de salud (diagnósticos, medicamentos) ni prometa resultados, como «me curó».</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-neutral-100 bg-neutral-50">
        {hecho ? (
          <span className="text-sm font-semibold text-emerald-700">{hecho}</span>
        ) : (
          <>
            <button
              type="button"
              disabled={!esAdmin || trabajando}
              onClick={() => correr(true)}
              className="bg-emerald-600 text-white text-sm font-bold rounded-lg px-4 py-1.5 disabled:opacity-40"
            >
              ✓ Aprobar
            </button>
            <button
              type="button"
              disabled={!esAdmin || trabajando}
              onClick={() => correr(false)}
              className="text-sm font-semibold border border-red-200 text-red-700 rounded-lg px-3 py-1.5 bg-white disabled:opacity-40"
            >
              ✗ No va
            </button>
          </>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </article>
  );
}
