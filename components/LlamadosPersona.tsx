"use client";

import { useCallback, useEffect, useState } from "react";
import { listarSancionesPersona, anularSancion, type Sancion } from "@/app/(app)/rrhh/sanciones-actions";

// Ficha → Llamados: los llamados de atención y apercibimientos de la
// persona, con su firma (o que se negó), el motivo que escribió y la opción
// de anularlos si administración justifica la tardanza.

const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const horaDe = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }) : "";

export default function LlamadosPersona({ idPersona }: { idPersona: string }) {
  const [datos, setDatos] = useState<{ sanciones: Sancion[]; faltaSql: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => {
    listarSancionesPersona(idPersona)
      .then(setDatos)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los llamados."));
  }, [idPersona]);
  useEffect(cargar, [cargar]);

  function confirmarAnulacion(id: string) {
    setGuardando(true);
    anularSancion(id, motivo)
      .then((res) => {
        if (res.error) setError(res.error);
        else {
          setAnulando(null);
          setMotivo("");
          cargar();
        }
      })
      .finally(() => setGuardando(false));
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!datos) return <p className="text-sm text-neutral-400 text-center py-8">Cargando…</p>;
  if (datos.faltaSql) {
    return (
      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        Para que se guarden los llamados de atención falta correr <b>sql/llamados-y-caja.sql</b> en Supabase.
      </p>
    );
  }

  const vigentes = datos.sanciones.filter((s) => s.estado === "VIGENTE");
  const mesActual = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
  const delMes = vigentes.filter((s) => s.fecha.startsWith(mesActual)).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Llamados", vigentes.filter((s) => s.tipo === "LLAMADO").length],
          ["Apercibimientos", vigentes.filter((s) => s.tipo === "APERCIBIMIENTO").length],
          ["Tarde este mes", delMes],
        ].map(([t, n]) => (
          <div key={t as string} className="bg-white border border-neutral-200 rounded-xl px-3 py-2.5">
            <span className="block text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">{t}</span>
            <b className="text-lg tabular-nums">{n}</b>
          </div>
        ))}
      </div>

      {datos.sanciones.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8 bg-white border border-neutral-200 rounded-xl">Sin llamados de atención. 👏</p>
      ) : (
        <div className="space-y-2">
          {datos.sanciones.map((s) => {
            const anulada = s.estado === "ANULADA";
            return (
              <div key={s.idSancion} className={`bg-white border rounded-xl px-4 py-3 ${anulada ? "border-neutral-200 opacity-70" : "border-neutral-200"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <b className={`text-sm ${anulada ? "line-through text-neutral-500" : "text-neutral-900"}`}>
                    {fechaCorta(s.fecha)} · {s.tipo === "APERCIBIMIENTO" ? "Apercibimiento" : "Llamado de atención"}
                  </b>
                  <span
                    className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${
                      anulada ? "bg-neutral-100 text-neutral-500" : s.tipo === "APERCIBIMIENTO" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {anulada ? "Anulado" : `${s.numeroEnMes}ª tardanza del mes`}
                  </span>
                  <a href={`/rrhh/sancion/${s.idSancion}`} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs font-semibold text-accent hover:underline">
                    Ver e imprimir
                  </a>
                </div>
                <p className="text-[12.5px] text-neutral-500 mt-1">
                  Entró {s.horaIngreso ?? "—"}
                  {s.minutosTarde !== null ? `, ${s.minutosTarde} min tarde` : ""} · {s.motivo ? `“${s.motivo}”` : "sin motivo"}
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  {s.firma ? (
                    <span className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.firma} alt="Firma" className="h-6 w-20 object-contain bg-white border border-neutral-200 rounded" />
                      Firmado {horaDe(s.firmadoEn)}
                    </span>
                  ) : s.seNego ? (
                    <span className="text-xs font-semibold text-red-700">Se negó a firmar · {horaDe(s.firmadoEn)}. Entregásela impresa delante de un testigo.</span>
                  ) : (
                    <span className="text-xs font-semibold text-amber-700">Todavía sin firmar</span>
                  )}
                  {!anulada && anulando !== s.idSancion && (
                    <button type="button" onClick={() => setAnulando(s.idSancion)} className="ml-auto text-xs font-semibold text-neutral-400 hover:text-neutral-700">
                      Justificar y anular
                    </button>
                  )}
                </div>
                {anulada && s.motivoAnulacion && (
                  <p className="text-xs text-neutral-500 mt-1.5">
                    Anulado por {s.anuladaPor ?? "administración"}: {s.motivoAnulacion}
                  </p>
                )}
                {anulando === s.idSancion && (
                  <div className="mt-2 bg-neutral-50 rounded-lg p-2.5 space-y-2">
                    <label className="block text-xs font-semibold text-neutral-600">¿Por qué se justifica? (la tardanza deja de contar)</label>
                    <input
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Por ejemplo: paro de colectivos"
                      className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setAnulando(null)} className="text-xs text-neutral-500 px-2 py-1">
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmarAnulacion(s.idSancion)}
                        disabled={!motivo.trim() || guardando}
                        className="text-xs font-bold text-white bg-neutral-800 disabled:opacity-40 rounded-lg px-3 py-1.5"
                      >
                        {guardando ? "Guardando..." : "Anular"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-neutral-400">
        El motivo lo escribe la persona al fichar y lo revisás vos: solo se anula si lo justificás acá. Desde qué llegada tarde del mes hay apercibimiento se
        cambia en Asistencia → Reglas.
      </p>
    </div>
  );
}
