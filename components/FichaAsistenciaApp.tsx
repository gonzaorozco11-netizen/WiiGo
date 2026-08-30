"use client";

import { useEffect, useState } from "react";
import { obtenerEstadoFicha, fichar, guardarMotivoTardanza, type EstadoFicha, type ResultadoFichaje } from "@/app/(app)/ficha-asistencia/actions";

export default function FichaAsistenciaApp() {
  const [estado, setEstado] = useState<EstadoFicha | null>(null);
  const [cargando, setCargando] = useState(true);
  const [fichando, setFichando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoFichaje | null>(null);
  const [idHorarioSeleccionado, setIdHorarioSeleccionado] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [guardandoMotivo, setGuardandoMotivo] = useState(false);
  const [motivoGuardado, setMotivoGuardado] = useState(false);

  function recargar() {
    setCargando(true);
    obtenerEstadoFicha()
      .then((res) => {
        setEstado(res);
        setIdHorarioSeleccionado(res.idHorarioSugerido);
      })
      .finally(() => setCargando(false));
  }

  useEffect(recargar, []);

  function handleFichar() {
    if (!estado) return;
    setConfirmando(false);
    setFichando(true);
    setMotivo("");
    setMotivoGuardado(false);
    fichar(estado.siguienteTipo, estado.siguienteTipo === "ENTRADA" ? idHorarioSeleccionado : null)
      .then((res) => {
        setResultado(res);
        // Si llegó tarde, se le deja tiempo para escribir el motivo — no
        // vuelve sola. El resto de los casos sí vuelve sola.
        if (!res.error && res.estado !== "TARDE") {
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

  function handleGuardarMotivo() {
    if (!resultado?.idFichaje) return;
    setGuardandoMotivo(true);
    guardarMotivoTardanza(resultado.idFichaje, motivo)
      .then((res) => {
        if (!res.error) setMotivoGuardado(true);
      })
      .finally(() => setGuardandoMotivo(false));
  }

  function handleContinuar() {
    setResultado(null);
    recargar();
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
    const sinEvaluar = resultado.estado === "SIN_HORARIO";
    const problema = tarde || anticipada;
    return (
      <div className={`max-w-md mx-auto text-center py-16 px-6 rounded-3xl ${problema ? "bg-amber-50" : sinEvaluar ? "bg-neutral-50" : "bg-emerald-50"}`}>
        <div className="text-5xl mb-4">{tarde ? "🕒" : anticipada ? "⏱️" : sinEvaluar ? "📝" : "🚀"}</div>
        <h1 className={`text-xl font-extrabold mb-2 ${problema ? "text-amber-700" : sinEvaluar ? "text-neutral-700" : "text-emerald-700"}`}>
          {problema ? `¡Hola, ${resultado.nombre}!` : sinEvaluar ? "Fichaje registrado" : "¡A tiempo!"}
        </h1>
        <p className="text-sm text-neutral-700">
          {tarde && (
            <>
              Llegaste tarde <b>{resultado.minutos} min</b> 🕒.
            </>
          )}
          {anticipada && (
            <>
              Te fuiste <b>{resultado.minutos} min</b> antes de tu horario.
            </>
          )}
          {sinEvaluar && <>Se guardó la hora, sin evaluar tardanza (no elegiste un turno para hoy).</>}
          {!problema && !sinEvaluar && <>¡Muy bien, {resultado.nombre}! Qué carita feliz, seguí así 😊</>}
        </p>

        {tarde && (
          <div className="mt-4 text-left">
            {motivoGuardado ? (
              <p className="text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">Motivo guardado. ¡Gracias!</p>
            ) : (
              <>
                <label className="block text-xs font-semibold text-amber-800 mb-1">Motivo de la tardanza (opcional)</label>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={2}
                  placeholder="Ej: se cortó el colectivo..."
                  className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm mb-2"
                />
                <button
                  onClick={handleGuardarMotivo}
                  disabled={!motivo.trim() || guardandoMotivo}
                  className="text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 px-3 py-1.5 rounded-lg"
                >
                  {guardandoMotivo ? "Guardando..." : "Guardar motivo"}
                </button>
              </>
            )}
          </div>
        )}

        {resultado.turnoAbiertoLocal && (
          <p className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">
            ⚠️ Te queda la caja de <b>{resultado.turnoAbiertoLocal}</b> abierta — ¡cerrala antes de irte!
          </p>
        )}

        {tarde ? (
          <button onClick={handleContinuar} className="mt-6 text-sm font-bold text-white bg-neutral-800 hover:bg-neutral-900 px-5 py-2 rounded-lg">
            Continuar
          </button>
        ) : (
          <p className="text-xs text-neutral-400 mt-6">Volviendo a la pantalla principal…</p>
        )}
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
      <h1 className="text-xl font-bold text-neutral-900 mb-6">Hola, {estado?.persona?.nombre} 👋</h1>

      {esEntrada && estado && estado.horarios.length > 0 && (
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3 mb-6 text-left">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-neutral-400 mb-2">Tu turno hoy</p>
          {idHorarioSeleccionado === null && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">
              Hoy no es tu día habitual — elegí qué turno te corresponde si viniste igual (o dejalo así si fue algo excepcional).
            </p>
          )}
          <div className="space-y-1.5">
            {estado.horarios.map((h) => (
              <label
                key={h.id_horario}
                className={`flex items-center justify-between gap-2 border rounded-lg px-2.5 py-1.5 text-xs cursor-pointer ${
                  idHorarioSeleccionado === h.id_horario ? "border-accent bg-accent-tint text-accent-dark font-semibold" : "border-neutral-200"
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="horario"
                    checked={idHorarioSeleccionado === h.id_horario}
                    onChange={() => setIdHorarioSeleccionado(h.id_horario)}
                  />
                  {h.nombre}
                </span>
                <span className="text-neutral-400">{h.hora_entrada.slice(0, 5)}</span>
              </label>
            ))}
            <button
              type="button"
              onClick={() => setIdHorarioSeleccionado(null)}
              className={`w-full text-left text-xs px-2.5 py-1 ${idHorarioSeleccionado === null ? "text-accent font-semibold" : "text-neutral-400"}`}
            >
              {idHorarioSeleccionado === null ? "✓ " : ""}No evaluar hoy (día excepcional)
            </button>
          </div>
        </div>
      )}

      {!esEntrada && estado?.horarioDeHoy && (
        <p className="text-xs text-neutral-400 mb-6 bg-neutral-50 border border-neutral-200 rounded-lg inline-block px-3 py-2">
          Turno de hoy: {estado.horarioDeHoy.nombre} — salida {estado.horarioDeHoy.hora_salida?.slice(0, 5) ?? "—"}
        </p>
      )}

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
    </div>
  );
}
