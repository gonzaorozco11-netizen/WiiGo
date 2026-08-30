"use client";

import { useEffect, useState } from "react";
import { obtenerEstadoFicha, fichar, type EstadoFicha, type ResultadoFichaje } from "@/app/(app)/ficha-asistencia/actions";

export default function FichaAsistenciaApp() {
  const [estado, setEstado] = useState<EstadoFicha | null>(null);
  const [cargando, setCargando] = useState(true);
  const [fichando, setFichando] = useState(false);
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
    setFichando(true);
    fichar(estado.siguienteTipo)
      .then((res) => {
        setResultado(res);
        if (!res.error) {
          setTimeout(() => {
            setResultado(null);
            recargar();
          }, 5000);
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
        <p className="text-xs text-neutral-400 mt-6">Volviendo a la pantalla principal…</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto text-center py-16">
      {resultado?.error && <p className="text-sm text-red-600 mb-4">{resultado.error}</p>}
      <p className="text-sm text-neutral-400 mb-1 capitalize">
        {new Date().toLocaleString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
      </p>
      <h1 className="text-xl font-bold text-neutral-900 mb-8">Hola, {estado?.persona?.nombre} 👋</h1>
      <button
        onClick={handleFichar}
        disabled={fichando}
        className="w-44 h-44 rounded-full bg-gradient-to-br from-accent to-accent-dark text-white font-bold text-sm mx-auto flex flex-col items-center justify-center gap-1.5 shadow-lg disabled:opacity-60"
      >
        <span className="text-4xl">🕐</span>
        {fichando ? "Fichando..." : estado?.siguienteTipo === "ENTRADA" ? "Fichar entrada" : "Fichar salida"}
      </button>
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
