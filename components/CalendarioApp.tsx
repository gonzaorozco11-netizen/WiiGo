"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  aprobarPropuesta,
  guardarEvento,
  rechazarPropuesta,
  resolverMarca,
  type CalendarioAdmin,
  type EventoAdmin,
} from "@/app/(app)/calendario/actions";
import {
  ALCANCES,
  CLASE_TIPO,
  ETIQUETA_ALCANCE,
  ETIQUETA_ORDEN,
  ETIQUETA_TIPO,
  EXPLICA_ALCANCE,
  ORDENES,
  TIPOS,
  horario,
  rangoCorto,
  rangoLargo,
  type AlcanceEvento,
  type OrdenEntrada,
  type TipoEvento,
} from "@/lib/eventos";
import { ETIQUETA_PLAN } from "@/lib/planesMarca";

// El calendario del lado de WiiGo.
//
// Arriba lo que proponen las marcas, porque es lo único que está esperando una
// respuesta; abajo el formulario para cargar lo nuestro y la lista de lo que
// viene con quién se anotó en cada cosa.

export default function CalendarioApp({ datos }: { datos: CalendarioAdmin }) {
  const router = useRouter();
  const recargar = () => router.refresh();

  return (
    <div>
      <div className="cal-cab">
        <h1 className="cal-titulo">Calendario</h1>
        <p className="cal-sub">
          Lo que cargues acá lo ven las marcas en su portal el mismo día. Los feriados también:
          sin eso, una marca ve un martes en cero y piensa que algo anda mal.
        </p>
      </div>

      {datos.propuestas.length > 0 && (
        <div className="cal-caja">
          <h2>
            {datos.propuestas.length === 1
              ? "Una marca propuso un evento"
              : `${datos.propuestas.length} eventos propuestos por marcas`}
          </h2>
          {datos.propuestas.map((e) => (
            <Propuesta key={e.idEvento} e={e} onListo={recargar} />
          ))}
        </div>
      )}

      <div className="cal-grid">
        <div>
          <div className="cal-caja">
            <h2>Lo que viene</h2>
            {datos.proximos.length === 0 ? (
              <p className="cal-vacio">Todavía no hay nada cargado.</p>
            ) : (
              datos.proximos.map((e) => <Evento key={e.idEvento} e={e} onListo={recargar} />)
            )}
          </div>
        </div>

        <Formulario marcas={datos.marcas} onListo={recargar} />
      </div>
    </div>
  );
}

function Propuesta({ e, onListo }: { e: EventoAdmin; onListo: () => void }) {
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="cal-propuesta">
      <p className="quien">{e.marcaPropone}</p>
      <p className="que">{e.nombre}</p>
      <p className="cuando">
        {rangoLargo(e.fechaDesde, e.fechaHasta)}
        {horario(e.horaDesde, e.horaHasta) ? `, ${horario(e.horaDesde, e.horaHasta)}` : ""}
      </p>
      {e.descripcion && <p className="desc">{e.descripcion}</p>}
      {e.trae && (
        <p className="pide">
          <b>Va a traer:</b> {e.trae}
          <br />
          <span style={{ color: "#a3a3a3" }}>
            Si aprobás, esto entra al local ese día. Lo que no quieras adentro, decilo en el motivo.
          </span>
        </p>
      )}

      {rechazando && (
        <label className="cal-campo" style={{ marginTop: 12, marginBottom: 0 }}>
          <span>Por qué no se puede</span>
          <textarea
            rows={2}
            value={motivo}
            onChange={(ev) => setMotivo(ev.target.value)}
            placeholder="Lo ve la marca. Sin motivo, lo vuelve a proponer igual la semana que viene."
          />
        </label>
      )}

      {error && <p className="cal-error">{error}</p>}

      <div className="cal-acc">
        {rechazando ? (
          <>
            <button type="button" className="cal-btn plano" onClick={() => setRechazando(false)}>
              Volver
            </button>
            <button
              type="button"
              className="cal-btn malo"
              disabled={pendiente || motivo.trim() === ""}
              onClick={() =>
                empezar(async () => {
                  const r = await rechazarPropuesta(e.idEvento, motivo);
                  if (r.error) setError(r.error);
                  else onListo();
                })
              }
            >
              Rechazar
            </button>
          </>
        ) : (
          <>
            <button type="button" className="cal-btn malo" onClick={() => setRechazando(true)}>
              Rechazar
            </button>
            <button
              type="button"
              className="cal-btn"
              disabled={pendiente}
              onClick={() =>
                empezar(async () => {
                  const r = await aprobarPropuesta(e.idEvento);
                  if (r.error) setError(r.error);
                  else onListo();
                })
              }
            >
              {pendiente ? "Aprobando…" : "Aprobar y publicar"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Evento({ e, onListo }: { e: EventoAdmin; onListo: () => void }) {
  const [pendiente, empezar] = useTransition();
  const confirmadas = e.marcas.filter((m) => m.estado === "CONFIRMADA").length;

  return (
    <div className="cal-evento">
      <div className="cal-evento-cab">
        <div>
          <p className="fecha">
            {rangoCorto(e.fechaDesde, e.fechaHasta)}
            {horario(e.horaDesde, e.horaHasta) ? ` · ${horario(e.horaDesde, e.horaHasta)}` : ""}
          </p>
          <p className="nom">{e.nombre}</p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {e.estado === "BORRADOR" && <span className="cal-tag borrador">Borrador</span>}
          <span className={`cal-tag ${CLASE_TIPO[e.tipo]}`}>{ETIQUETA_TIPO[e.tipo]}</span>
        </div>
      </div>

      {e.alcance !== "AVISO" && (
        <div className="cal-marcas">
          <p style={{ fontSize: 12, color: "#737373", marginBottom: 4 }}>
            {e.cupo != null ? `${confirmadas} de ${e.cupo} lugares` : `${confirmadas} confirmadas`}
            {e.alcance === "ABIERTO" ? ` · ${ETIQUETA_ORDEN[e.ordenEntrada]}` : " · por invitación"}
          </p>

          {e.marcas.length === 0 ? (
            <p style={{ fontSize: 13, color: "#a3a3a3", padding: "4px 0" }}>Todavía no hay ninguna.</p>
          ) : (
            e.marcas.map((m) => (
              <div className="cal-marca" key={m.idMarca}>
                <span className={`cal-medalla ${m.plan}`}>{ETIQUETA_PLAN[m.plan].toUpperCase()}</span>
                <span className="nom">{m.nombre}</span>
                {m.estado === "ANOTADA" ? (
                  <>
                    <button
                      type="button"
                      className="cal-btn plano"
                      style={{ fontSize: 12, padding: "5px 11px" }}
                      disabled={pendiente}
                      onClick={() => empezar(async () => {
                        await resolverMarca(e.idEvento, m.idMarca, false, "No quedó lugar en la góndola.");
                        onListo();
                      })}
                    >
                      No entra
                    </button>
                    <button
                      type="button"
                      className="cal-btn"
                      style={{ fontSize: 12, padding: "5px 11px" }}
                      disabled={pendiente}
                      onClick={() => empezar(async () => {
                        await resolverMarca(e.idEvento, m.idMarca, true);
                        onListo();
                      })}
                    >
                      Confirmar
                    </button>
                  </>
                ) : (
                  <span
                    className={`est ${m.estado === "CONFIRMADA" ? "ok" : m.estado === "INVITADA" ? "esp" : "no"}`}
                  >
                    {m.estado === "CONFIRMADA"
                      ? "Confirmada"
                      : m.estado === "INVITADA"
                        ? "Invitada, sin contestar"
                        : m.estado === "NO_VA"
                          ? "Dijo que no"
                          : "No entró"}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Formulario({
  marcas,
  onListo,
}: {
  marcas: CalendarioAdmin["marcas"];
  onListo: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoEvento>("EVENTO");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [horaDesde, setHoraDesde] = useState("");
  const [horaHasta, setHoraHasta] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [alcance, setAlcance] = useState<AlcanceEvento>("AVISO");
  const [cupo, setCupo] = useState("6");
  const [orden, setOrden] = useState<OrdenEntrada>("GOLD_PRIMERO");
  const [visibleTodas, setVisibleTodas] = useState(true);
  const [invitadas, setInvitadas] = useState<string[]>([]);
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function limpiar() {
    setNombre("");
    setDesde("");
    setHasta("");
    setHoraDesde("");
    setHoraHasta("");
    setDescripcion("");
    setInvitadas([]);
  }

  function mandar(publicar: boolean) {
    empezar(async () => {
      setError(null);
      const r = await guardarEvento({
        nombre,
        tipo,
        descripcion,
        fechaDesde: desde,
        fechaHasta: hasta || desde,
        horaDesde,
        horaHasta,
        alcance,
        cupo: Number(cupo) > 0 ? Number(cupo) : null,
        ordenEntrada: orden,
        visibleParaTodas: visibleTodas,
        publicar,
        invitadas,
      });
      if (r.error) setError(r.error);
      else {
        limpiar();
        onListo();
      }
    });
  }

  return (
    <div className="cal-caja">
      <h2>Nuevo evento</h2>

      <label className="cal-campo">
        <span>Nombre</span>
        <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} />
      </label>

      <label className="cal-campo">
        <span>Tipo</span>
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoEvento)}>
          {TIPOS.map((t) => (
            <option key={t} value={t}>
              {ETIQUETA_TIPO[t]}
            </option>
          ))}
        </select>
      </label>

      <div className="cal-fila2">
        <label className="cal-campo">
          <span>Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="cal-campo">
          <span>Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          <small>Vacío = un solo día.</small>
        </label>
      </div>

      <div className="cal-fila2">
        <label className="cal-campo">
          <span>De qué hora</span>
          <input type="time" value={horaDesde} onChange={(e) => setHoraDesde(e.target.value)} />
        </label>
        <label className="cal-campo">
          <span>A qué hora</span>
          <input type="time" value={horaHasta} onChange={(e) => setHoraHasta(e.target.value)} />
          <small>Vacío = todo el día.</small>
        </label>
      </div>

      <label className="cal-campo">
        <span>Qué significa para la marca</span>
        <textarea
          rows={3}
          maxLength={400}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
        <small>
          Escribilo en lo que le cambia a ella, no en lo que hacemos nosotros. Es lo que decide si se
          anota.
        </small>
      </label>

      <div className="cal-campo">
        <span>Quiénes participan</span>
        {ALCANCES.map((a) => (
          <label key={a} className={`cal-opcion${alcance === a ? " elegida" : ""}`}>
            <input type="radio" name="alcance" checked={alcance === a} onChange={() => setAlcance(a)} />
            <span>
              <b>{ETIQUETA_ALCANCE[a]}</b> — {EXPLICA_ALCANCE[a]}
            </span>
          </label>
        ))}
      </div>

      {alcance === "ABIERTO" && (
        <>
          <div className="cal-fila2">
            <label className="cal-campo">
              <span>Cupo de marcas</span>
              <input type="number" min={1} value={cupo} onChange={(e) => setCupo(e.target.value)} />
            </label>
            <label className="cal-campo">
              <span>Orden de entrada</span>
              <select value={orden} onChange={(e) => setOrden(e.target.value as OrdenEntrada)}>
                {ORDENES.map((o) => (
                  <option key={o} value={o}>
                    {ETIQUETA_ORDEN[o]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p style={{ fontSize: 12, color: "#a3a3a3", marginTop: -6, marginBottom: 12, lineHeight: 1.45 }}>
            El cupo de góndola es finito igual. Que las Gold entren primero convierte ese límite en
            el argumento de venta del plan, sin tener que explicar nada.
          </p>
        </>
      )}

      {alcance === "INVITACION" && (
        <>
          <div className="cal-campo">
            <span>A quién invito</span>
            <div className="cal-invitadas">
              {marcas.map((m) => (
                <label key={m.idMarca}>
                  <input
                    type="checkbox"
                    checked={invitadas.includes(m.idMarca)}
                    onChange={(e) =>
                      setInvitadas((prev) =>
                        e.target.checked ? [...prev, m.idMarca] : prev.filter((x) => x !== m.idMarca)
                      )
                    }
                  />
                  <span style={{ flexGrow: 1 }}>{m.nombre}</span>
                  <span className={`cal-medalla ${m.plan}`}>{ETIQUETA_PLAN[m.plan].toUpperCase()}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="cal-opcion" style={{ marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={visibleTodas}
              onChange={(e) => setVisibleTodas(e.target.checked)}
            />
            <span>
              <b>Las demás marcas lo ven igual</b>, sin poder anotarse. Conviene dejarlo prendido:
              ver que a otra la invitaron es lo que hace querer estar.
            </span>
          </label>
        </>
      )}

      {error && <p className="cal-error">{error}</p>}

      <div className="cal-acc">
        <button
          type="button"
          className="cal-btn plano"
          disabled={pendiente || nombre.trim() === "" || !desde}
          onClick={() => mandar(false)}
        >
          Guardar borrador
        </button>
        <button
          type="button"
          className="cal-btn"
          disabled={pendiente || nombre.trim() === "" || !desde}
          onClick={() => mandar(true)}
        >
          {pendiente ? "Guardando…" : "Publicar"}
        </button>
      </div>
    </div>
  );
}
