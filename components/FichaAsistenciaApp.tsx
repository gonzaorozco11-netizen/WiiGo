"use client";

import { useEffect, useState } from "react";
import { obtenerEstadoFicha, fichar, type EstadoFicha, type ResultadoFichaje } from "@/app/(app)/ficha-asistencia/actions";

export default function FichaAsistenciaApp() {
  const [estado, setEstado] = useState<EstadoFicha | null>(null);
  const [cargando, setCargando] = useState(true);
  const [fichando, setFichando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoFichaje | null>(null);

  function recargar() {
    setCargando(true);
    obtenerEstadoFicha()
      .then(setEstado)
      .finally(() => setCargando(false));
  }

  useEffect(recargar, []);

  function handleFichar() {
    if (!estado) return;
    setConfirmando(false);
    setFichando(true);
    fichar(estado.siguienteTipo)
      .then((res) => {
        setResultado(res);
        if (!res.error) {
          setTimeout(
            () => {
              setResultado(null);
              recargar();
            },
            res.turnoAbiertoLocal ? 9000 : 5000
          );
        }
      })
      .finally(() => setFichando(false));
  }

  if (cargando) return <p className="text-sm text-neutral-400 text-center py-16">Cargando...</p>;

  if (estado?.sinPersonaVinculada) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <p className="text-sm text-neutral-500">
          Tu usuario no está vinculado a ninguna persona en Organización — avisale a administración para poder fichar.
        </p>
      </div>
    );
  }

  if (resultado && !resultado.error) {
    const tarde = resultado.estado === "TARDE";
    const anticipada = resultado.estado === "ANTICIPADA";
    const problema = tarde || anticipada;
    return (
      <div className={`max-w-md mx-auto text-center py-16 px-6 rounded-3xl ${problema ? "bg-amber-50" : "bg-emerald-50"}`}>
        <div className="text-5xl mb-4">{tarde ? "🕒" : anticipada ? "⏱️" : "🚀"}</div>
        <h1 className={`text-xl font-extrabold mb-2 ${problema ? "text-amber-700" : "text-emerald-700"}`}>
          {problema ? `¡Hola, ${resultado.nombre}!` : "¡A tiempo!"}
        </h1>
        <p className="text-sm text-neutral-700">
          {tarde && (
            <>
              Llegaste tarde <b>{resultado.minutos} min</b> 🕒. ¡A ponerse las pilas mañana!
            </>
          )}
          {anticipada && (
            <>
              Te fuiste <b>{resultado.minutos} min</b> antes de tu horario.
            </>
          )}
          {!problema && <>¡Muy bien, {resultado.nombre}! Qué carita feliz, seguí así 😊</>}
        </p>
        {resultado.turnoAbiertoLocal && (
          <p className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">
            ⚠️ Te queda la caja de <b>{resultado.turnoAbiertoLocal}</b> abierta — ¡cerrala antes de irte!
          </p>
        )}
        <p className="text-xs text-neutral-400 mt-6">Volviendo a la pantalla principal…</p>
      </div>
    );
  }

  const esEntrada = estado?.siguienteTipo === "ENTRADA";

  return (
    <div className="max-w-md mx-auto text-center py-16">
      {resultado?.error && <p className="text-sm text-red-600 mb-4">{resultado.error}</p>}
      <p className="text-sm text-neutral-400 mb-1 capitalize">
        {new Date().toLocaleString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
      </p>
      <h1 className="text-xl font-bold text-neutral-900 mb-8">Hola, {estado?.persona?.nombre} 👋</h1>

      {confirmando && (
        <p className={`text-sm font-semibold rounded-lg px-3 py-2 mb-4 ${esEntrada ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          ¿Fichar {esEntrada ? "entrada" : "salida"}? Tocá de nuevo para confirmar.
        </p>
      )}

      <button
        onClick={() => (confirmando ? handleFichar() : setConfirmando(true))}
        disabled={fichando}
        className={`w-44 h-44 rounded-full text-white font-bold text-sm mx-auto flex flex-col items-center justify-center gap-1.5 shadow-lg disabled:opacity-60 ${
          esEntrada ? "bg-gradient-to-br from-emerald-500 to-emerald-700" : "bg-gradient-to-br from-amber-500 to-amber-700"
        } ${confirmando ? "ring-4 ring-offset-2 " + (esEntrada ? "ring-emerald-300" : "ring-amber-300") : ""}`}
      >
        <span className="text-4xl">{esEntrada ? "🚪" : "🚶"}</span>
        {fichando ? "Fichando..." : confirmando ? "Confirmar" : esEntrada ? "Fichar entrada" : "Fichar salida"}
      </button>

      {confirmando && !fichando && (
        <button onClick={() => setConfirmando(false)} className="block mx-auto mt-4 text-xs font-semibold text-neutral-400 hover:text-neutral-600">
          Cancelar
        </button>
      )}

      {estado?.horario ? (
        <p className="text-xs text-neutral-400 mt-8 bg-neutral-50 border border-neutral-200 rounded-lg inline-block px-3 py-2">
          Tu horario: {estado.horario.hora_entrada.slice(0, 5)} (tolerancia {estado.horario.tolerancia_minutos} min)
        </p>
      ) : (
        <p className="text-xs text-neutral-400 mt-8">No tenés un horario asignado — se va a registrar igual, sin evaluar tardanza.</p>
      )}
    </div>
  );
}
