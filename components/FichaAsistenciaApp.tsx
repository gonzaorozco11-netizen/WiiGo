"use client";

import { useEffect, useRef, useState } from "react";
import {
  obtenerEstadoFicha,
  fichar,
  guardarMotivoTardanza,
  firmarSancion,
  type EstadoFicha,
  type ResultadoFichaje,
  type CajaFicha,
} from "@/app/(app)/ficha-asistencia/actions";
import { abrirTurno } from "@/app/(app)/turnos/actions";
import PadFirma from "@/components/PadFirma";
import ArqueoCaja from "@/components/ArqueoCaja";

// Ficha Asistencia: fichar la entrada y la salida, en la tablet del local.
//
// Al entrar: un mensaje según cómo llegó (verde si llegó 5 minutos antes o
// más, con la racha; amarillo si llegó justo; rojo si llegó tarde, con el
// llamado de atención para leer y firmar) y, si la caja del local está
// cerrada, abrirla ahí mismo con el sobre de cambio.
// Al irse: si tiene la caja abierta, primero el arqueo (conteo, sobres, foto
// y firma); la firma del arqueo es también la de la salida.

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

export default function FichaAsistenciaApp() {
  const [estado, setEstado] = useState<EstadoFicha | null>(null);
  const [cargando, setCargando] = useState(true);
  const [fichando, setFichando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [arqueando, setArqueando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoFichaje | null>(null);
  const [idHorarioSeleccionado, setIdHorarioSeleccionado] = useState<string | null>(null);
  const [firma, setFirma] = useState<string | null>(null);
  // Lo que queda por hacer en la pantalla de resultado.
  const [sancionHecha, setSancionHecha] = useState(false);
  const [cajaHecha, setCajaHecha] = useState(false);
  const [cajaOmitida, setCajaOmitida] = useState(false);
  const volverRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  useEffect(() => () => {
    if (volverRef.current) clearTimeout(volverRef.current);
  }, []);

  function volverAlInicio() {
    if (volverRef.current) clearTimeout(volverRef.current);
    setResultado(null);
    setSancionHecha(false);
    setCajaHecha(false);
    setCajaOmitida(false);
    recargar();
  }

  function mostrarResultado(res: ResultadoFichaje) {
    setResultado(res);
    setFirma(null);
    setSancionHecha(false);
    setCajaHecha(false);
    setCajaOmitida(false);
    if (res.error) return;
    // Vuelve sola solo si no queda nada por hacer (firmar el llamado o abrir la caja).
    const quedaAlgo = Boolean(res.sancion) || res.estado === "TARDE" || (res.tipo === "ENTRADA" && res.caja && !res.caja.abierta);
    if (!quedaAlgo) volverRef.current = setTimeout(volverAlInicio, res.turnoAbiertoLocal ? 9000 : 6000);
  }

  function handleFichar(firmaUsada: string | null = firma) {
    if (!estado) return;
    setConfirmando(false);
    setFichando(true);
    fichar(estado.siguienteTipo, estado.siguienteTipo === "ENTRADA" ? idHorarioSeleccionado : null, estado.pideFirma ? firmaUsada : null)
      .then((res) => {
        if (res.cajaPendiente) {
          setArqueando(true);
          return;
        }
        mostrarResultado(res);
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

  // ---------- Al irse con la caja abierta: primero el arqueo ----------
  if (arqueando && estado?.caja?.abierta) {
    return (
      <div className="max-w-md mx-auto py-8">
        <h1 className="text-xl font-extrabold text-neutral-900 text-center mb-1">Antes de irte, cerrá tu caja</h1>
        <p className="text-sm text-neutral-500 text-center mb-4">Contá la plata, separá los sobres, sacá la foto y firmá. Con eso queda fichada tu salida.</p>
        <ArqueoCaja
          idTurno={estado.caja.abierta.idTurno}
          fondo={estado.caja.fondo}
          exigirFotoYFirma
          textoBoton="Cerrar caja y fichar salida"
          onCerrado={(firmaArqueo) => {
            setArqueando(false);
            handleFichar(firmaArqueo);
          }}
          onCancelar={() => setArqueando(false)}
        />
      </div>
    );
  }

  // ---------- Resultado ----------
  if (resultado && !resultado.error) {
    const nombre = resultado.nombre ?? "";
    const llegada = resultado.llegada;
    const esEntrada = resultado.tipo === "ENTRADA";
    const sancionPendiente = Boolean(resultado.sancion) && !sancionHecha;
    const cajaParaAbrir = esEntrada && resultado.caja && !resultado.caja.abierta && !cajaHecha && !cajaOmitida ? resultado.caja : null;
    const quedaAlgo = sancionPendiente || Boolean(cajaParaAbrir) || (resultado.estado === "TARDE" && !resultado.sancion && !sancionHecha);

    return (
      <div className="max-w-md mx-auto py-10 space-y-4">
        {esEntrada && llegada ? (
          <AvisoLlegada llegada={llegada} nombre={nombre} minutosTarde={resultado.minutos ?? 0} />
        ) : (
          <AvisoSimple resultado={resultado} />
        )}

        {resultado.sancion && !sancionHecha && <FirmarSancion sancion={resultado.sancion} onListo={() => setSancionHecha(true)} />}
        {resultado.sancion && sancionHecha && (
          <p className="text-sm text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-center">
            Listo, quedó registrado en tu legajo.
          </p>
        )}

        {/* Sin la tabla de llamados (falta el SQL) queda el motivo de siempre. */}
        {resultado.estado === "TARDE" && !resultado.sancion && !sancionHecha && resultado.idFichaje && (
          <MotivoSimple idFichaje={resultado.idFichaje} onListo={() => setSancionHecha(true)} />
        )}

        {!sancionPendiente && cajaParaAbrir && <AbrirCaja caja={cajaParaAbrir} onListo={() => setCajaHecha(true)} onOmitir={() => setCajaOmitida(true)} />}
        {cajaOmitida && <p className="text-xs text-amber-700 text-center">Acordate de abrir la caja desde Turnos antes de cobrar.</p>}
        {esEntrada && resultado.caja?.abierta && !resultado.caja.abierta.esMia && (
          <p className="text-sm text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
            La caja del local la tiene abierta <b>{resultado.caja.abierta.abiertaPor}</b>. Cuando la cierre, abrís la tuya desde acá o desde Turnos.
          </p>
        )}
        {cajaHecha && <p className="text-sm font-semibold text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 text-center">Caja abierta ✓ ¡Buen turno!</p>}

        {resultado.turnoAbiertoLocal && (
          <p className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ⚠️ Te queda la caja de <b>{resultado.turnoAbiertoLocal}</b> abierta — ¡cerrala antes de irte!
          </p>
        )}

        {quedaAlgo ? null : (sancionHecha || cajaHecha || cajaOmitida || resultado.estado === "TARDE") ? (
          <button onClick={volverAlInicio} className="block mx-auto text-sm font-bold text-white bg-neutral-800 hover:bg-neutral-900 px-5 py-2 rounded-lg">
            Listo
          </button>
        ) : (
          <p className="text-xs text-neutral-400 text-center">Volviendo a la pantalla principal…</p>
        )}
      </div>
    );
  }

  // ---------- Inicio ----------
  const esEntrada = estado?.siguienteTipo === "ENTRADA";
  const pideFirma = Boolean(estado?.pideFirma);
  const cajaMiaAbierta = !esEntrada && Boolean(estado?.caja?.abierta?.esMia);

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
              No hay un turno tuyo a esta hora. Si viniste a cubrir uno, elegilo; si fue algo excepcional, dejalo así.
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
                  <input type="radio" name="horario" checked={idHorarioSeleccionado === h.id_horario} onChange={() => setIdHorarioSeleccionado(h.id_horario)} />
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

      {cajaMiaAbierta && (
        <p className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5">
          Tenés la caja abierta: al fichar la salida primero hacés el arqueo.
        </p>
      )}

      {confirmando && (
        <p className={`text-sm font-semibold rounded-lg px-3 py-2 mb-4 ${esEntrada ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {pideFirma
            ? `Firmá para fichar la ${esEntrada ? "entrada" : "salida"} y tocá Confirmar.`
            : `¿Fichar ${esEntrada ? "entrada" : "salida"}? Tocá de nuevo para confirmar.`}
        </p>
      )}

      {/* La firma: queda pegada a este fichaje y sale en la planilla de
          asistencia del mes, al lado de la hora. */}
      {confirmando && pideFirma && (
        <div className="mb-5 text-left">
          <PadFirma onCambio={setFirma} />
        </div>
      )}

      <button
        onClick={() => {
          if (cajaMiaAbierta) setArqueando(true);
          else if (confirmando) handleFichar();
          else setConfirmando(true);
        }}
        disabled={fichando || (confirmando && pideFirma && !firma)}
        className={`w-44 h-44 rounded-full text-white font-bold text-sm mx-auto flex flex-col items-center justify-center gap-1.5 shadow-lg disabled:opacity-60 ${
          esEntrada ? "bg-gradient-to-br from-emerald-500 to-emerald-700" : "bg-gradient-to-br from-amber-500 to-amber-700"
        } ${confirmando ? "ring-4 ring-offset-2 " + (esEntrada ? "ring-emerald-300" : "ring-amber-300") : ""}`}
      >
        <span className="text-4xl">{esEntrada ? "🚪" : "🚶"}</span>
        {fichando ? "Fichando..." : confirmando ? "Confirmar" : esEntrada ? "Fichar entrada" : cajaMiaAbierta ? "Cerrar caja y salir" : "Fichar salida"}
      </button>

      {confirmando && !fichando && (
        <button
          onClick={() => {
            setConfirmando(false);
            setFirma(null);
          }}
          className="block mx-auto mt-4 text-xs font-semibold text-neutral-400 hover:text-neutral-600"
        >
          Cancelar
        </button>
      )}
    </div>
  );
}

// ---------- Piezas ----------

/** Verde: llegó 5 minutos antes o más. Amarillo: justo. Rojo: tarde. */
function AvisoLlegada({ llegada, nombre, minutosTarde }: { llegada: NonNullable<ResultadoFichaje["llegada"]>; nombre: string; minutosTarde: number }) {
  if (llegada.tono === "verde") {
    return (
      <div className="rounded-3xl bg-emerald-50 text-emerald-800 text-center px-6 py-10">
        <div className="text-5xl mb-3">🏆</div>
        <h1 className="text-2xl font-extrabold mb-1">¡Muy bien, {nombre}!</h1>
        <p className="text-sm">
          Llegaste {llegada.minutosAntes} minutos antes ({llegada.hora}).
        </p>
        <p className="text-base font-bold mt-3">
          {llegada.racha <= 1 ? "Arrancás una racha invicta 🔥" : `Venís invicta hace ${llegada.racha} días 🔥`}
        </p>
        {llegada.racha > 1 && (
          <div className="flex justify-center gap-1 mt-2" aria-hidden="true">
            {Array.from({ length: Math.min(llegada.racha, 10) }).map((_, i) => (
              <span key={i} className="w-5 h-1.5 rounded-full bg-emerald-500" />
            ))}
          </div>
        )}
      </div>
    );
  }
  if (llegada.tono === "amarillo") {
    return (
      <div className="rounded-3xl bg-amber-50 text-amber-800 text-center px-6 py-10">
        <div className="text-5xl mb-3">⏰</div>
        <h1 className="text-2xl font-extrabold mb-1">¡Justo a tiempo, {nombre}!</h1>
        <p className="text-sm">Entraste a las {llegada.hora}.</p>
        <p className="text-sm font-semibold mt-3">Ojo para la próxima: la idea es estar 5 minutos antes.</p>
      </div>
    );
  }
  return (
    <div className="rounded-3xl bg-red-50 text-red-700 text-center px-6 py-8">
      <div className="text-5xl mb-3">🕒</div>
      <h1 className="text-2xl font-extrabold mb-1">Llegaste tarde: {minutosTarde} {minutosTarde === 1 ? "minuto" : "minutos"}</h1>
      <p className="text-sm">Tu entrada quedó registrada a las {llegada.hora}.</p>
    </div>
  );
}

/** Salida, o entrada sin horario para evaluar. */
function AvisoSimple({ resultado }: { resultado: ResultadoFichaje }) {
  const anticipada = resultado.estado === "ANTICIPADA";
  const sinEvaluar = resultado.estado === "SIN_HORARIO";
  return (
    <div className={`rounded-3xl text-center px-6 py-10 ${anticipada ? "bg-amber-50" : sinEvaluar ? "bg-neutral-50" : "bg-emerald-50"}`}>
      <div className="text-5xl mb-3">{anticipada ? "⏱️" : sinEvaluar ? "📝" : resultado.tipo === "SALIDA" ? "👋" : "🚀"}</div>
      <h1 className={`text-xl font-extrabold mb-2 ${anticipada ? "text-amber-700" : sinEvaluar ? "text-neutral-700" : "text-emerald-700"}`}>
        {resultado.tipo === "SALIDA" ? `¡Hasta mañana, ${resultado.nombre}!` : sinEvaluar ? "Fichaje registrado" : "¡A tiempo!"}
      </h1>
      <p className="text-sm text-neutral-700">
        {anticipada && (
          <>
            Te fuiste <b>{resultado.minutos} min</b> antes de tu horario.
          </>
        )}
        {sinEvaluar && resultado.tipo === "ENTRADA" && <>Se guardó la hora, sin evaluar tardanza (no elegiste un turno para hoy).</>}
        {!anticipada && !sinEvaluar && resultado.tipo === "SALIDA" && <>Tu salida quedó registrada. ¡Gracias por el día!</>}
        {sinEvaluar && resultado.tipo === "SALIDA" && <>Tu salida quedó registrada.</>}
      </p>
    </div>
  );
}

/** El llamado de atención o apercibimiento: leer, contar el motivo si quiere, y firmar (o negarse). */
function FirmarSancion({ sancion, onListo }: { sancion: NonNullable<ResultadoFichaje["sancion"]>; onListo: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [firma, setFirma] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmarNegativa, setConfirmarNegativa] = useState(false);
  const apercibimiento = sancion.tipo === "APERCIBIMIENTO";

  function enviar(seNiega: boolean) {
    setGuardando(true);
    setError(null);
    firmarSancion(sancion.idSancion, { firma, seNiega, motivo })
      .then((res) => {
        if (res.error) setError(res.error);
        else onListo();
      })
      .finally(() => setGuardando(false));
  }

  const parrafos = sancion.texto.split("\n\n");
  return (
    <div className="space-y-3">
      <div className="bg-white border border-neutral-200 rounded-xl px-4 py-3 max-h-80 overflow-y-auto font-serif text-[14px] leading-relaxed text-neutral-800">
        {parrafos.map((p, i) =>
          i === 1 ? (
            <p key={i} className={`font-sans text-xs font-bold tracking-widest text-center my-2 ${apercibimiento ? "text-red-700" : "text-neutral-700"}`}>
              {p}
            </p>
          ) : i === 0 ? (
            <p key={i} className="text-right text-xs text-neutral-500">
              {p}
            </p>
          ) : (
            <p key={i} className="mb-2 whitespace-pre-line">
              {p}
            </p>
          )
        )}
      </div>
      <div>
        <label htmlFor="motivo-tarde" className="block text-xs font-semibold text-neutral-500 mb-1">
          Si querés, contá por qué llegaste tarde (lo revisa administración)
        </label>
        <textarea
          id="motivo-tarde"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <div>
        <p className="text-xs font-semibold text-neutral-500 mb-1">Firmá acá: me notifico</p>
        <PadFirma onCambio={setFirma} />
        <p className="text-[11.5px] text-neutral-400 mt-1">Firmar quiere decir que recibiste esta nota, no que estés de acuerdo.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {confirmarNegativa ? (
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 text-sm space-y-2">
          <p>Si no firmás, queda registrado que te negaste, con la hora, y administración te la va a entregar en papel.</p>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setConfirmarNegativa(false)} className="text-xs font-semibold text-neutral-500 px-3 py-1.5">
              Volver
            </button>
            <button type="button" onClick={() => enviar(true)} disabled={guardando} className="text-xs font-bold text-white bg-neutral-700 rounded-lg px-3 py-1.5">
              No firmo
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => setConfirmarNegativa(true)} className="text-xs font-semibold text-neutral-400 underline">
            No quiero firmar
          </button>
          <button
            type="button"
            onClick={() => enviar(false)}
            disabled={!firma || guardando}
            className={`text-sm font-bold text-white rounded-xl px-5 py-2.5 disabled:opacity-40 ${apercibimiento ? "bg-red-600 hover:bg-red-700" : "bg-accent hover:bg-accent-dark"}`}
          >
            {guardando ? "Guardando..." : "Firmar y seguir"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Sin la tabla de llamados todavía: el motivo de la tardanza, como antes. */
function MotivoSimple({ idFichaje, onListo }: { idFichaje: string; onListo: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  return (
    <div className="text-left">
      <label className="block text-xs font-semibold text-neutral-500 mb-1">Motivo de la tardanza (opcional, lo revisa administración)</label>
      <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-2" />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onListo} className="text-xs font-semibold text-neutral-400 px-3 py-1.5">
          Seguir sin escribir
        </button>
        <button
          type="button"
          onClick={() => {
            setGuardando(true);
            guardarMotivoTardanza(idFichaje, motivo).finally(() => {
              setGuardando(false);
              onListo();
            });
          }}
          disabled={!motivo.trim() || guardando}
          className="text-xs font-bold text-white bg-neutral-800 disabled:opacity-40 px-3 py-1.5 rounded-lg"
        >
          Guardar motivo
        </button>
      </div>
    </div>
  );
}

/** Abrir la caja al entrar, con el sobre de cambio. */
function AbrirCaja({ caja, onListo, onOmitir }: { caja: CajaFicha; onListo: () => void; onOmitir: () => void }) {
  const [otra, setOtra] = useState(false);
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function abrir(valor: number) {
    setGuardando(true);
    setError(null);
    abrirTurno(caja.idLocal, valor, caja.fondo)
      .then((res) => {
        if (res.error) setError(res.error);
        else onListo();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="border border-neutral-200 bg-white rounded-2xl p-4 space-y-2.5">
      <p className="text-base font-bold text-neutral-900">Abrí tu caja</p>
      <p className="text-sm text-neutral-600">
        Agarrá el <b>sobre de cambio</b> y contalo. Tiene que tener <b>{pesos(caja.fondo)}</b>.
      </p>
      <p className="text-xs text-neutral-400">Los sobres de recaudación de los turnos anteriores no se tocan: esos los cuenta administración.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {otra ? (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-neutral-500">¿Cuánto hay en el sobre?</label>
          <input
            inputMode="numeric"
            value={monto}
            onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ""))}
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-lg font-semibold tabular-nums"
            placeholder="$"
            autoFocus
          />
          <p className="text-xs text-amber-700">Se abre con lo que contaste y le llega un aviso a administración.</p>
          <button
            type="button"
            onClick={() => abrir(Number(monto) || 0)}
            disabled={!monto || guardando}
            className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold py-2.5 text-sm"
          >
            {guardando ? "Abriendo..." : `Abrir caja con ${pesos(Number(monto) || 0)}`}
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => abrir(caja.fondo)}
            disabled={guardando}
            className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold py-2.5 text-sm"
          >
            {guardando ? "Abriendo..." : `Hay ${pesos(caja.fondo)}: abrir caja`}
          </button>
          <div className="flex justify-between">
            <button type="button" onClick={() => setOtra(true)} className="text-xs font-semibold text-neutral-500 underline">
              Hay otra cantidad
            </button>
            <button type="button" onClick={onOmitir} className="text-xs font-semibold text-neutral-400">
              Más tarde
            </button>
          </div>
        </>
      )}
    </div>
  );
}
