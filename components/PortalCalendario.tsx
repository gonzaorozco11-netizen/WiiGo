"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  anotarmeEnEvento,
  proponerEvento,
  responderInvitacion,
  type CalendarioPortal,
  type EventoPortal,
} from "@/app/portal/calendario/actions";
import {
  CLASE_TIPO,
  ETIQUETA_PARTICIPACION,
  ETIQUETA_TIPO,
  cuandoCorto,
  horario,
  puedeProponerEvento,
  rangoCorto,
  rangoLargo,
  type MesAlmanaque,
} from "@/lib/eventos";
import { NIVEL } from "@/lib/planesMarca";
import { pedirCambioDePlan } from "@/app/portal/cambios/actions";

// El calendario del local, del lado de la marca.
//
// Está armado alrededor de una idea: la marca entra cada dos semanas, así que
// lo primero que ve tiene que ser lo próximo y nada más. El resto —la lista y
// el almanaque— es para ubicarse, no para decidir.
//
// Los feriados importan tanto como los eventos: hoy la marca ve que un martes
// vendió cero y piensa que algo anda mal. Con el calendario sabe que el local
// estaba cerrado.

const DOW = ["L", "M", "M", "J", "V", "S", "D"];

export default function PortalCalendario({ datos }: { datos: CalendarioPortal }) {
  const router = useRouter();
  // `null` = cerrado. Un string = abierto con esa fecha ya puesta: la marca
  // acaba de señalar el día con el dedo, pedirle que lo elija de nuevo en un
  // selector es hacerle repetir lo que ya dijo.
  const [proponiendo, setProponiendo] = useState<string | null>(null);
  const [mostrandoGold, setMostrandoGold] = useState(false);
  // El día que está mirando. El almanaque deja de ser un dibujo: se toca un
  // día y dice qué pasa, incluso cuando no pasa nada — que es el caso más
  // frecuente y justo cuando la marca quiere proponer algo.
  const [dia, setDia] = useState<string | null>(null);
  const puedeProponer = puedeProponerEvento(datos.plan);

  // El destacado es el primero sobre el que todavía puede hacer algo; si no
  // hay ninguno, el primero que viene. Un feriado en grande arriba no sirve de
  // nada.
  const destacado =
    datos.eventos.find((e) => e.puedoAnotarme || e.miEstado === "INVITADA") ??
    datos.eventos.find((e) => e.tipo === "EVENTO") ??
    datos.eventos[0] ??
    null;

  const resto = datos.eventos.filter((e) => e !== destacado);

  return (
    <main className="portal-lienzo">
      <div className="cal-cab">
        <div>
          <h1>Calendario</h1>
          <p>Lo que viene en el local. Si te enterás con tiempo, llegás con stock.</p>
        </div>
        {/* El botón se le muestra a todas, apagado para las que no son Gold:
            esconderlo haría que una Bronce ni se entere de que existe, y nadie
            paga por algo que no sabe que hay. */}
        <button
          type="button"
          className={`cal-proponer${puedeProponer ? "" : " trabado"}`}
          onClick={() => (puedeProponer ? setProponiendo("") : setMostrandoGold(true))}
        >
          + Proponer un evento
          {!puedeProponer && <span className="medalla">Gold</span>}
        </button>
      </div>

      {/* El almanaque va siempre, haya eventos o no: sin él esto no es un
          calendario, es una lista. Lo que se esconde cuando no hay nada es lo
          de arriba, que es lo que pide una decisión. */}
      {destacado ? (
        <Destacado e={destacado} plan={datos.plan} onListo={() => router.refresh()} />
      ) : (
        <p className="cal-nada">
          Todavía no hay eventos cargados. Cuando WiiGo arme uno —un Black Friday, una semana
          temática— te va a aparecer acá y en Mis tareas, con los días que faltan.
        </p>
      )}

      {resto.length > 0 && (
        <section className="cal-lista-sec">
          <h2>Lo que sigue</h2>
          <div className="cal-lista">
            {resto.map((e) => (
              <FilaEvento key={e.idEvento} e={e} onListo={() => router.refresh()} />
            ))}
          </div>
        </section>
      )}

      <section className="cal-lista-sec">
        <div className="cal-alm-cab">
          <h2>Los próximos {datos.almanaque.length} meses</h2>
          <div className="cal-ref">
            <span><i className="ev" /> Evento WiiGo</span>
            <span><i className="com" /> Fecha comercial</span>
            <span><i className="esp" /> Horario especial</span>
            <span><i className="cerr" /> Local cerrado</span>
            <span><i className="fer" /> Feriado</span>
          </div>
        </div>
        <div className="cal-almanaque">
          {datos.almanaque.map((m) => (
            <div className="mes" key={m.nombre}>
              <h3>{m.nombre}</h3>
              <div className="rejilla">
                {DOW.map((d, i) => (
                  <span className="dow" key={i}>
                    {d}
                  </span>
                ))}
                {m.celdas.map((c, i) =>
                  c.iso === "" ? (
                    <span className={c.clase} key={i} />
                  ) : (
                    <button
                      type="button"
                      className={`${c.clase}${dia === c.iso ? " sel" : ""}`}
                      key={i}
                      aria-pressed={dia === c.iso}
                      onClick={() => setDia(dia === c.iso ? null : c.iso)}
                    >
                      {c.t}
                    </button>
                  )
                )}
              </div>
              {/* Con el nombre y no solo marcados: para preparar una promo
                  hay que saber QUÉ se festeja ese día, y en el teléfono no
                  hay dónde pasar el mouse por encima. */}
              {m.feriados.length > 0 && (
                <ul className="cal-feriados">
                  {m.feriados.map((f) => (
                    <li key={f.dia}>
                      <b>{f.dia}</b> {f.nombre}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {dia && (
          <PanelDia
            iso={dia}
            eventos={datos.eventos}
            almanaque={datos.almanaque}
            puedeProponer={puedeProponer}
            onCerrar={() => setDia(null)}
            onProponer={() => (puedeProponer ? setProponiendo(dia) : setMostrandoGold(true))}
          />
        )}
      </section>

      <p className="cal-pie">
        Anotarte no cambia nada en la góndola: queda esperando que WiiGo confirme tu lugar. Y si se
        te ocurre algo para tu marca, proponelo — lo revisamos como cualquier otra solicitud.
      </p>

      {proponiendo !== null && (
        <ModalProponer
          fechaInicial={proponiendo}
          onCerrar={() => setProponiendo(null)}
          onListo={() => {
            setProponiendo(null);
            router.refresh();
          }}
        />
      )}
      {mostrandoGold && <ModalGold onCerrar={() => setMostrandoGold(false)} />}
    </main>
  );
}

/**
 * Por qué proponer un evento es de Gold.
 *
 * Dicho en lo que ocupa y no en "es una función premium": un evento de marca
 * se lleva la góndola de entrada, las pantallas y un rato del operativo. Eso
 * es lo que se paga, y entendido así nadie siente que le esconden un botón.
 */
function ModalGold({ onCerrar }: { onCerrar: () => void }) {
  const [pendiente, empezar] = useTransition();
  const [mandado, setMandado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cal-modal-cab">
          <div>
            <h2>Proponer tu propio evento es de Gold</h2>
            <p>Anotarte en los que armamos nosotros lo podés hacer igual, con cualquier plan.</p>
          </div>
          <button type="button" className="cal-btn plano" onClick={onCerrar}>
            Cerrar
          </button>
        </div>

        <div className="cal-aviso">
          Un evento tuyo se lleva la góndola de entrada, las pantallas del local y un rato del
          equipo, todo ese día y solo para tu marca. Eso es lo que incluye el plan Gold — y por eso
          no lo puede pedir cualquiera: si lo pidieran todas, no le tocaría a nadie.
        </div>

        <ul className="cal-gold-lista">
          <li>Proponer eventos propios: lanzamientos, degustaciones, activaciones.</li>
          <li>Entrar primero en los eventos que armamos nosotros, antes que el resto.</li>
          <li>Comparar cómo rendís contra las demás marcas del local.</li>
          <li>Saber en qué día y a qué hora se vende lo tuyo.</li>
        </ul>

        {mandado ? (
          <p className="cal-ok">
            Listo, nos llegó. Te respondemos por acá — lo vas a ver en Mis solicitudes.
          </p>
        ) : (
          <>
            {error && <p className="cal-error">{error}</p>}
            <div className="cal-modal-pie">
              <button type="button" className="cal-btn plano" onClick={onCerrar}>
                Ahora no
              </button>
              <button
                type="button"
                className="cal-btn grande"
                disabled={pendiente}
                onClick={() =>
                  empezar(async () => {
                    const r = await pedirCambioDePlan("GOLD");
                    if (r.error) setError(r.error);
                    else setMandado(true);
                  })
                }
              >
                {pendiente ? "Mandando…" : "Quiero pasarme a Gold"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Destacado({
  e,
  plan,
  onListo,
}: {
  e: EventoPortal;
  plan: CalendarioPortal["plan"];
  onListo: () => void;
}) {
  const quedan = e.cupo != null ? Math.max(0, e.cupo - e.tomados) : null;

  return (
    <section className={`cal-destacado ${CLASE_TIPO[e.tipo]}`}>
      <div className="cal-destacado-cab">
        <div>
          <span className="tipo">{ETIQUETA_TIPO[e.tipo]}</span>
          <span className="cuando">
            {rangoLargo(e.fechaDesde, e.fechaHasta)}
            {horario(e.horaDesde, e.horaHasta) ? `, ${horario(e.horaDesde, e.horaHasta)}` : ""}
          </span>
        </div>
        <span className="faltan">
          {e.diasFaltan <= 0 ? "es hoy" : e.diasFaltan === 1 ? "es mañana" : `faltan ${e.diasFaltan} días`}
        </span>
      </div>

      <div className="cal-destacado-cuerpo">
        <div className="texto">
          <h2>{e.nombre}</h2>
          {e.descripcion && <p>{e.descripcion}</p>}
          {e.esMiPropuesta && (
            <p className="cal-espera">
              <i aria-hidden="true">⏳</i> Lo propusiste vos. Esperando que WiiGo lo apruebe.
            </p>
          )}
        </div>

        {!e.esMiPropuesta && e.alcance !== "AVISO" && (
          <div className="accion">
            {e.cupo != null && (
              <div className="cupo">
                <p className="rot">Cupo</p>
                <p className="n">
                  <b>{e.cupo} marcas</b>
                  {quedan != null && (
                    <>
                      {" "}· quedan <b className={quedan === 0 ? "sin" : "pocas"}>{quedan}</b>
                    </>
                  )}
                </p>
                <span className="riel">
                  <span style={{ width: `${Math.min(100, (e.tomados / e.cupo) * 100)}%` }} />
                </span>
              </div>
            )}

            <Botones e={e} onListo={onListo} grande />

            {e.alcance === "ABIERTO" && e.ordenEntrada === "GOLD_PRIMERO" && NIVEL[plan] < NIVEL.GOLD && (
              <p className="nota">
                Las Gold entran primero. Si queda lugar después de ellas, entrás.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function FilaEvento({ e, onListo }: { e: EventoPortal; onListo: () => void }) {
  return (
    <div className="cal-fila">
      <div className="fecha">
        <p className="d">{rangoCorto(e.fechaDesde, e.fechaHasta)}</p>
        <p className="s">
          {cuandoCorto(e.fechaDesde, e.fechaHasta)}
          {horario(e.horaDesde, e.horaHasta) ? ` · ${horario(e.horaDesde, e.horaHasta)}` : ""}
        </p>
      </div>
      <span className={`cal-chip ${e.miEstado === "INVITADA" ? "com" : CLASE_TIPO[e.tipo]}`}>
        {e.miEstado === "INVITADA" ? "Te invitamos" : ETIQUETA_TIPO[e.tipo]}
      </span>
      <div className="qué">
        <p className="t">{e.nombre}</p>
        {e.descripcion && <p className="d">{e.descripcion}</p>}
      </div>
      <div className="acc">
        <Botones e={e} onListo={onListo} />
      </div>
    </div>
  );
}

/** Lo único que la marca puede hacer con este evento, o nada. */
function Botones({ e, onListo, grande }: { e: EventoPortal; onListo: () => void; grande?: boolean }) {
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const clase = grande ? "cal-btn grande" : "cal-btn";

  if (e.esMiPropuesta) return <span className="cal-estado esperando">⏳ Esperando</span>;

  if (e.miEstado === "INVITADA") {
    return (
      <div className="cal-acciones">
        <button
          type="button"
          className={clase}
          disabled={pendiente}
          onClick={() =>
            empezar(async () => {
              const r = await responderInvitacion(e.idEvento, true);
              if (r.error) setError(r.error);
              else onListo();
            })
          }
        >
          Aceptar
        </button>
        <button
          type="button"
          className="cal-btn plano"
          disabled={pendiente}
          onClick={() =>
            empezar(async () => {
              const r = await responderInvitacion(e.idEvento, false);
              if (r.error) setError(r.error);
              else onListo();
            })
          }
        >
          No puedo
        </button>
        {error && <p className="cal-error">{error}</p>}
      </div>
    );
  }

  if (e.miEstado) {
    return (
      <span className={`cal-estado ${e.miEstado === "CONFIRMADA" ? "ok" : e.miEstado === "RECHAZADA" || e.miEstado === "NO_VA" ? "no" : "esperando"}`}>
        {ETIQUETA_PARTICIPACION[e.miEstado]}
      </span>
    );
  }

  if (!e.puedoAnotarme) return null;

  return (
    <div className="cal-acciones">
      <button
        type="button"
        className={clase}
        disabled={pendiente}
        onClick={() =>
          empezar(async () => {
            const r = await anotarmeEnEvento(e.idEvento);
            if (r.error) setError(r.error);
            else onListo();
          })
        }
      >
        {pendiente ? "Anotándote…" : grande ? "Quiero participar" : "Anotarme"}
      </button>
      {error && <p className="cal-error">{error}</p>}
    </div>
  );
}

/**
 * Qué pasa el día que la marca tocó.
 *
 * Abajo del almanaque y no en una ventana: en el celular una ventana para
 * decir "no hay nada" es demasiado, y así la grilla queda a la vista con el
 * día marcado mientras se lee — se puede tocar otro sin cerrar nada.
 *
 * El día VACÍO es el caso más frecuente y el que más importa: es justo cuando
 * la marca quiere proponer algo, porque buscó un día libre y lo encontró.
 */
function PanelDia({
  iso,
  eventos,
  almanaque,
  puedeProponer,
  onCerrar,
  onProponer,
}: {
  iso: string;
  eventos: EventoPortal[];
  almanaque: MesAlmanaque[];
  puedeProponer: boolean;
  onCerrar: () => void;
  onProponer: () => void;
}) {
  // Un evento de varios días ocupa todos: se busca por rango, no por igualdad.
  const delDia = eventos.filter((e) => e.fechaDesde <= iso && iso <= e.fechaHasta);
  const feriado =
    almanaque.flatMap((m) => m.celdas).find((c) => c.iso === iso)?.feriado ?? null;
  const [a, m, d] = iso.split("-");

  return (
    <div className="cal-panel">
      <div className="cal-panel-cab">
        <h4>{rangoLargo(iso, iso)}</h4>
        <button type="button" className="cerrar" onClick={onCerrar}>
          Cerrar
        </button>
      </div>

      <div className="cal-panel-cuerpo">
        {feriado && (
          <div className="cal-panel-item">
            <span className="barra fer" />
            <span>
              <span className="t fer">Feriado nacional</span>
              <h5>{feriado}</h5>
              <p>
                No lo pone WiiGo: es feriado en todo el país. Si el local abre o no, lo vas a ver
                acá mismo cuando esté cargado.
              </p>
            </span>
          </div>
        )}

        {delDia.map((e) => (
          <div className="cal-panel-item" key={e.idEvento}>
            <span className={`barra ${CLASE_TIPO[e.tipo]}`} />
            <span>
              <span className={`t ${CLASE_TIPO[e.tipo]}`}>{ETIQUETA_TIPO[e.tipo]}</span>
              <h5>{e.nombre}</h5>
              <p>
                {horario(e.horaDesde, e.horaHasta) || "Todo el día"}
                {e.fechaDesde !== e.fechaHasta && ` · ${rangoCorto(e.fechaDesde, e.fechaHasta)}`}
                {e.cupo != null && ` · cupo para ${e.cupo} marcas`}
                {e.puedoAnotarme && " · te podés anotar"}
              </p>
            </span>
          </div>
        ))}

        {!feriado && delDia.length === 0 && (
          <p className="cal-panel-nada">
            No hay nada el {Number(d)}/{Number(m)}/{a.slice(2)}. El local abre normal.
          </p>
        )}
      </div>

      <div className="cal-panel-pie">
        <span>¿Querés hacer algo tuyo este día?</span>
        <button type="button" className="cal-btn" onClick={onProponer}>
          Proponer un evento el {Number(d)}/{Number(m)}
          {!puedeProponer && <span className="medalla">Gold</span>}
        </button>
      </div>
    </div>
  );
}

function ModalProponer({
  fechaInicial = "",
  onCerrar,
  onListo,
}: {
  /** El día que la marca tocó en el almanaque. Vacío = abrió desde el botón. */
  fechaInicial?: string;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [nombre, setNombre] = useState("");
  // Casi siempre es un día: una degustación, un lanzamiento. Arrancar en "un
  // solo día" evita que la mayoría tenga que cargar dos fechas iguales.
  const [variosDias, setVariosDias] = useState(false);
  const [desde, setDesde] = useState(fechaInicial);
  const [hasta, setHasta] = useState("");
  const [horaDesde, setHoraDesde] = useState("");
  const [horaHasta, setHoraHasta] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [trae, setTrae] = useState("");
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="cal-modal" onClick={(ev) => ev.stopPropagation()}>
        <div className="cal-modal-cab">
          <div>
            <h2>Proponer un evento</h2>
            <p>Contanos qué querés hacer en el local. Lo revisamos y te respondemos.</p>
          </div>
          <button type="button" className="cal-btn plano" onClick={onCerrar}>
            Cerrar
          </button>
        </div>

        <label className="cal-campo">
          <span>¿Qué querés hacer?</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={80}
            placeholder="Lanzamiento, degustación, activación…"
          />
        </label>

        <div className="cal-dias">
          <button
            type="button"
            aria-pressed={!variosDias}
            onClick={() => {
              setVariosDias(false);
              setHasta("");
            }}
          >
            Un solo día
          </button>
          <button type="button" aria-pressed={variosDias} onClick={() => setVariosDias(true)}>
            Varios días
          </button>
        </div>

        <div className="cal-campos">
          <label className="cal-campo">
            <span>{variosDias ? "Desde" : "Qué día"}</span>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          {variosDias && (
            <label className="cal-campo">
              <span>Hasta</span>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </label>
          )}
        </div>

        <div className="cal-campos">
          <label className="cal-campo">
            <span>De qué hora</span>
            <input type="time" value={horaDesde} onChange={(e) => setHoraDesde(e.target.value)} />
          </label>
          <label className="cal-campo">
            <span>A qué hora</span>
            <input type="time" value={horaHasta} onChange={(e) => setHoraHasta(e.target.value)} />
          </label>
        </div>
        <small className="cal-ayuda">
          Si dura todo el día, dejá las horas vacías. El horario es lo que necesita saber el local
          para tenerte el espacio listo.
        </small>

        <label className="cal-campo">
          <span>Contanos un poco más</span>
          <textarea
            rows={3}
            maxLength={400}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Qué llevás, qué esperás que pase."
          />
          <small>Cuanto más claro, más rápido te contestamos.</small>
        </label>

        <label className="cal-campo">
          <span>¿Qué vas a traer?</span>
          <textarea
            rows={2}
            value={trae}
            onChange={(e) => setTrae(e.target.value)}
            maxLength={300}
            placeholder="Una promotora, muestras, cartelería, una mesa propia, folletos…"
          />
          <small>
            Contanos todo lo que va a entrar al local ese día. Lo tenemos que aprobar antes: no
            lleves nada que no te hayamos confirmado por acá.
          </small>
        </label>

        <div className="cal-aviso">
          Esto no reserva nada todavía. Llega como una solicitud más y lo vas a ver acá con el reloj
          hasta que te respondamos. Si no se puede, te decimos por qué.
        </div>

        {error && <p className="cal-error">{error}</p>}

        <div className="cal-modal-pie">
          <button type="button" className="cal-btn plano" onClick={onCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            className="cal-btn grande"
            disabled={pendiente || nombre.trim() === "" || !desde || (variosDias && !hasta)}
            onClick={() =>
              empezar(async () => {
                setError(null);
                const r = await proponerEvento({
                  nombre,
                  fechaDesde: desde,
                  fechaHasta: variosDias ? hasta : desde,
                  horaDesde,
                  horaHasta,
                  descripcion,
                  trae,
                });
                if (r.error) setError(r.error);
                else onListo();
              })
            }
          >
            {pendiente ? "Mandando…" : "Mandar la propuesta"}
          </button>
        </div>
      </div>
    </div>
  );
}
