"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { aprobarCambioProfesional, pedirCorreccionProfesional, type CambioParaAprobar } from "@/app/(app)/profesionales/actions";

// Lo que las profesionales mandaron desde su espacio, en la bandeja de
// Aprobaciones. Recién al aprobarlo sale en la pantalla del local.
export default function AprobacionesProfesionales({ cambios, esAdmin }: { cambios: CambioParaAprobar[]; esAdmin: boolean }) {
  if (cambios.length === 0) return null;
  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-extrabold text-neutral-900">
          Profesionales <span className="ml-1 text-sm font-bold text-white bg-red-600 rounded-full px-2 py-0.5 tabular-nums">{cambios.length}</span>
        </h2>
        <p className="text-xs text-neutral-500">Lo que cambiaron en su ficha. Sale en la pantalla del local cuando lo aprobás.</p>
      </div>
      {!esAdmin && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
          Los cambios de las profesionales los aprueba el Dueño.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {cambios.map((c) => (
          <TarjetaCambio key={c.idCambio} cambio={c} esAdmin={esAdmin} />
        ))}
      </div>
    </section>
  );
}

function TarjetaCambio({ cambio, esAdmin }: { cambio: CambioParaAprobar; esAdmin: boolean }) {
  const router = useRouter();
  const [nota, setNota] = useState("");
  const [pidiendo, setPidiendo] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  function correr(accion: () => Promise<{ error: string | null }>, mensaje: string) {
    setError(null);
    setTrabajando(true);
    accion()
      .then((r) => {
        if (r.error) return setError(r.error);
        setHecho(mensaje);
        router.refresh();
      })
      .finally(() => setTrabajando(false));
  }

  const esLista = cambio.filas.length > 0 && cambio.filas.every((f) => f.antes === "");

  return (
    <article className={`bg-white border border-neutral-200 rounded-2xl overflow-hidden ${hecho ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {cambio.profesional.foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cambio.profesional.foto} alt="" className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <span className="w-10 h-10 rounded-full bg-neutral-100 grid place-items-center font-bold text-neutral-500">{cambio.profesional.nombre.charAt(0)}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-neutral-900">
            {cambio.profesional.nombre} · <span className="font-semibold text-neutral-700">{cambio.que.toLowerCase()}</span>
          </p>
          <p className="text-xs text-neutral-500">{new Date(cambio.fecha).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      </div>

      {cambio.fotoNueva && (
        <div className="flex gap-4 items-center px-4 py-3 border-t border-neutral-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cambio.fotoNueva} alt="Foto nueva" className="w-28 h-36 object-cover rounded-xl" />
          <p className="text-sm text-neutral-600">Mirá que se la vea bien y que no aparezca la cara de un paciente sin su permiso.</p>
        </div>
      )}

      {cambio.filas.length > 0 &&
        (esLista ? (
          <ul className="px-4 py-3 border-t border-neutral-100 flex flex-col gap-1 text-sm text-neutral-800">
            {cambio.filas.map((f, i) => (
              <li key={i}>
                · {f.ahora}
                {f.nuevo && <span className="ml-1.5 text-[11px] font-bold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">Nuevo</span>}
              </li>
            ))}
            <li className="text-xs text-neutral-500 mt-1">Esta lista reemplaza a la que tiene hoy.</li>
          </ul>
        ) : (
          <div className="border-t border-neutral-100 divide-y divide-neutral-100">
            {cambio.filas.map((f, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[140px_1fr_1fr] gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <span className="text-xs font-bold text-neutral-500 uppercase tracking-wide">{f.campo}</span>
                <span className="text-neutral-400 line-through decoration-neutral-300 whitespace-pre-line">{f.antes}</span>
                <span className="text-neutral-900 bg-emerald-50 rounded-lg px-2 py-1 whitespace-pre-line">{f.ahora}</span>
              </div>
            ))}
          </div>
        ))}

      {cambio.aviso && <p className="mx-4 mb-3 text-[13px] leading-snug text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{cambio.aviso}</p>}

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-neutral-100 bg-neutral-50">
        {hecho ? (
          <span className="text-sm font-semibold text-emerald-700">{hecho}</span>
        ) : (
          <>
            <button
              type="button"
              disabled={!esAdmin || trabajando}
              onClick={() => correr(() => aprobarCambioProfesional(cambio.idCambio), "Aprobado: ya sale en la pantalla.")}
              className="bg-accent text-white text-sm font-bold rounded-lg px-4 py-1.5 disabled:opacity-40"
            >
              Aprobar
            </button>
            {!pidiendo ? (
              <button
                type="button"
                disabled={!esAdmin || trabajando}
                onClick={() => setPidiendo(true)}
                className="text-sm font-semibold border border-neutral-300 rounded-lg px-3 py-1.5 bg-white disabled:opacity-40"
              >
                Pedir que lo cambie
              </button>
            ) : (
              <div className="flex flex-wrap gap-2 items-center w-full">
                <input
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  placeholder="Ej: Sacá lo de «bajá 5 kilos en un mes», no podemos prometer resultados."
                  className="flex-1 min-w-[220px] border border-neutral-300 rounded-lg px-3 py-1.5 text-sm bg-white"
                />
                <button
                  type="button"
                  disabled={trabajando}
                  onClick={() => correr(() => pedirCorreccionProfesional(cambio.idCambio, nota), "Le mandaste la nota. Cuando lo corrija vuelve acá.")}
                  className="text-sm font-bold bg-neutral-800 text-white rounded-lg px-3 py-1.5 disabled:opacity-40"
                >
                  Mandarle la nota
                </button>
                <button type="button" onClick={() => setPidiendo(false)} className="text-sm text-neutral-500">
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
