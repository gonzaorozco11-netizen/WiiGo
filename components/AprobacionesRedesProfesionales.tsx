"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { verificarPublicacion, type PublicacionParaVerificar } from "@/app/(app)/profesionales/actions";

// Las historias y reels que avisaron las profesionales desde su espacio
// ("Ya lo subí"). Solo cuenta lo que se verifica acá (lib/puntosProfesionales.ts).
export default function AprobacionesRedesProfesionales({ publicaciones, esAdmin }: { publicaciones: PublicacionParaVerificar[]; esAdmin: boolean }) {
  if (publicaciones.length === 0) return null;
  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-lg font-extrabold text-neutral-900">
          Redes de profesionales{" "}
          <span className="ml-1 text-sm font-bold text-white bg-red-600 rounded-full px-2 py-0.5 tabular-nums">{publicaciones.length}</span>
        </h2>
        <p className="text-xs text-neutral-500">Solo suma lo que verificás. Si te mencionaron, también lo ves en el Instagram de WiiGo.</p>
      </div>
      {!esAdmin && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">Las publicaciones las verifica el Dueño.</p>
      )}
      <div className="flex flex-col gap-3">
        {publicaciones.map((p) => (
          <TarjetaPublicacion key={p.idPublicacion} publicacion={p} esAdmin={esAdmin} />
        ))}
      </div>
    </section>
  );
}

function TarjetaPublicacion({ publicacion: p, esAdmin }: { publicacion: PublicacionParaVerificar; esAdmin: boolean }) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [rechazando, setRechazando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  function correr(cumple: boolean) {
    setError(null);
    setTrabajando(true);
    verificarPublicacion(p.idPublicacion, cumple, motivo)
      .then((r) => {
        if (r.error) return setError(r.error);
        setHecho(cumple ? `Verificado: suma ${p.puntos} puntos.` : "Le llegó el motivo para que lo corrija.");
        router.refresh();
      })
      .finally(() => setTrabajando(false));
  }

  const esReel = p.tipo === "REEL";
  return (
    <article className={`bg-white border border-neutral-200 rounded-2xl overflow-hidden ${hecho ? "opacity-60" : ""}`}>
      <div className="flex gap-4 p-4 flex-wrap sm:flex-nowrap">
        {p.captura ? (
          <a href={p.captura} target="_blank" rel="noopener noreferrer" className="shrink-0" title="Ver la captura grande">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.captura} alt="Captura de la historia" className="w-24 h-40 object-cover rounded-xl border border-neutral-200" />
          </a>
        ) : (
          <span className="shrink-0 w-24 h-40 rounded-xl bg-neutral-800 text-white grid place-items-center text-2xl">▶</span>
        )}
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <p className="text-sm font-bold text-neutral-900">
            {p.profesional.nombre} · <span className="font-semibold text-neutral-700">{esReel ? "Reel" : "Historia"}</span>
          </p>
          <p className="text-xs text-neutral-500">
            Avisó el {new Date(p.fecha).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · dice que mencionó a @wiigo.arg
          </p>
          {p.link && (
            <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent hover:underline break-all">
              Abrir el reel ↗
            </a>
          )}
          <p className="text-xs font-bold text-amber-700 mt-1">+{p.puntos} puntos si lo verificás</p>
          <p className="text-xs text-neutral-500">Fijate que se vea la mención y que no aparezca la cara o los datos de un paciente.</p>
        </div>
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
              ✓ Verificado
            </button>
            {!rechazando ? (
              <button
                type="button"
                disabled={!esAdmin || trabajando}
                onClick={() => setRechazando(true)}
                className="text-sm font-semibold border border-red-200 text-red-700 rounded-lg px-3 py-1.5 bg-white disabled:opacity-40"
              >
                ✗ No cumple
              </button>
            ) : (
              <div className="flex flex-wrap gap-2 items-center w-full">
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej: no se ve la mención a @wiigo.arg"
                  className="flex-1 min-w-[220px] border border-neutral-300 rounded-lg px-3 py-1.5 text-sm bg-white"
                />
                <button
                  type="button"
                  disabled={trabajando}
                  onClick={() => correr(false)}
                  className="text-sm font-bold bg-neutral-800 text-white rounded-lg px-3 py-1.5 disabled:opacity-40"
                >
                  Mandarle el motivo
                </button>
                <button type="button" onClick={() => setRechazando(false)} className="text-sm text-neutral-500">
                  Cancelar
                </button>
              </div>
            )}
          </>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </article>
  );
}
