"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { listarTareasJunta, preguntar } from "@/app/(app)/junta/actions";
import { ENCARGADOS, type DestinoJunta, type Lamina, type MensajeJunta } from "@/lib/juntaPersonajes";
import type { ItemTablero } from "@/lib/tablero";
import type { EquipoTareas, TareaVista } from "@/lib/tareasEquipo";
import JuntaTareas from "@/components/JuntaTareas";

const pesos = (v: number) => `$ ${Math.round(v).toLocaleString("es-AR")}`;
const COLOR_PENDIENTE: Record<ItemTablero["color"], string> = { rojo: "#dc2626", ambar: "#d97706", azul: "#2563eb" };
const encargado = (id: string) => ENCARGADOS.find((e) => e.id === id);

function LaminaTele({ l }: { l: Lamina }) {
  const max = Math.max(...(l.barras ?? []).map((b) => b.valor), 0);
  return (
    <div className="jt-lamina">
      <small>{l.titulo}</small>
      {l.barras?.length ? (
        <div className="jt-barras">
          {l.barras.map((b) => (
            <div key={b.etiqueta}>
              <i className={b.valor === max && max > 0 ? "top" : ""} style={{ height: `${max > 0 ? Math.max((b.valor / max) * 100, 3) : 3}%` }} />
              <em>{b.etiqueta}</em>
            </div>
          ))}
        </div>
      ) : (
        <b className={(l.grande ?? "").length > 11 ? "texto" : ""}>{l.grande}</b>
      )}
      {l.detalle && <span>{l.detalle}</span>}
    </div>
  );
}

export default function JuntaApp({
  mensajesIniciales,
  faltaSql,
  sinClave,
  hoy,
  pendientes,
  tareasIniciales,
}: {
  mensajesIniciales: MensajeJunta[];
  faltaSql: boolean;
  sinClave: boolean;
  hoy: { vendido: number; ventas: number; ticket: number } | null;
  pendientes: ItemTablero[];
  tareasIniciales: { tareas: TareaVista[]; equipo: EquipoTareas; faltaSql: boolean };
}) {
  const [tareas, setTareas] = useState(tareasIniciales);
  const propuestas = tareas.tareas.filter((t) => t.estadoTarea === "PROPUESTA").length;
  const [panel, setPanel] = useState<"tareas" | "mesa">(propuestas > 0 ? "tareas" : "mesa");
  const recargarTareas = async () => setTareas(await listarTareasJunta());
  const tareasDe = (idMensaje: string) => tareas.tareas.filter((t) => t.idMensaje === idMensaje);
  const [sel, setSel] = useState<DestinoJunta>("junta");
  const [mensajes, setMensajes] = useState(mensajesIniciales);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState<{ destino: DestinoJunta; pregunta: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teleGrande, setTeleGrande] = useState(false);
  const [nroLamina, setNroLamina] = useState(0);
  const hiloRef = useRef<HTMLDivElement>(null);

  const delHilo = useMemo(() => mensajes.filter((m) => m.hilo === sel), [mensajes, sel]);

  // La pantalla del fondo: lo último que se habló en este hilo, o cómo va el día.
  const laminas = useMemo<Lamina[]>(() => {
    if (enviando?.destino === sel) {
      const corto = enviando.pregunta.length > 40 ? `${enviando.pregunta.slice(0, 38)}…` : enviando.pregunta;
      return [{ titulo: "Tema nuevo", grande: corto, detalle: sel === "junta" ? "La junta está mirando los números…" : "Mirando los números…" }];
    }
    const ultimaPregunta = delHilo.map((m) => m.autor).lastIndexOf("gonzalo");
    if (ultimaPregunta >= 0) {
      const pregunta = delHilo[ultimaPregunta].texto;
      const deLaRespuesta = delHilo.slice(ultimaPregunta + 1).flatMap((m) => (m.lamina ? [m.lamina] : []));
      return [{ titulo: "Tema", grande: pregunta.length > 40 ? `${pregunta.slice(0, 38)}…` : pregunta, detalle: "Lo que se está hablando" }, ...deLaRespuesta];
    }
    return hoy
      ? [{ titulo: "Hoy en Arístides", grande: pesos(hoy.vendido), detalle: `${hoy.ventas} ventas${hoy.ventas ? ` · ticket ${pesos(hoy.ticket)}` : ""}` }]
      : [{ titulo: "Junta WiiGo", grande: "Lista para charlar", detalle: "Escribí un tema abajo" }];
  }, [delHilo, enviando, sel, hoy]);

  useEffect(() => {
    setNroLamina(0);
    if (laminas.length < 2) return;
    const reloj = setInterval(() => setNroLamina((n) => n + 1), 5000);
    return () => clearInterval(reloj);
  }, [laminas]);

  useEffect(() => {
    hiloRef.current?.scrollTo({ top: hiloRef.current.scrollHeight });
  }, [delHilo.length, sel, enviando]);

  async function enviar() {
    const pregunta = texto.trim();
    if (!pregunta || enviando) return;
    setError(null);
    setEnviando({ destino: sel, pregunta });
    setTexto("");
    const r = await preguntar(sel, pregunta, delHilo.slice(-12));
    setEnviando(null);
    if ("error" in r) {
      setError(r.error);
      setTexto(pregunta);
      return;
    }
    setMensajes((m) => [...m, ...r.mensajes]);
    // Si propusieron tareas, aparecen en "Para aprobar".
    const antes = tareas.tareas.filter((t) => t.estadoTarea === "PROPUESTA").length;
    const nuevas = await listarTareasJunta();
    setTareas(nuevas);
    if (nuevas.tareas.filter((t) => t.estadoTarea === "PROPUESTA").length > antes) setPanel("tareas");
  }

  const elegido = encargado(sel);
  const lamina = laminas[nroLamina % laminas.length];
  const piensa = (id: string) => enviando !== null && (enviando.destino === "junta" || enviando.destino === id);

  return (
    <div>
      <div className="jt-cab">
        <div>
          <h1 className="jt-titulo">Junta WiiGo</h1>
          <p className="jt-sub">
            Tus seis encargados, cada uno experto en su área, mirando los números reales. Tocá a uno para hablar solo con él, o escribile a toda la junta.
          </p>
        </div>
      </div>

      <section className="jt-sala" style={{ backgroundImage: "url(/junta/sala.webp)" }} aria-label="La sala de la junta">
        <div className={`jt-foco${elegido ? " on" : ""}`} style={{ ["--fx" as string]: `${elegido?.cara.x ?? 50}%`, ["--fy" as string]: `${elegido?.cara.y ?? 40}%` }} />
        {ENCARGADOS.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`jt-zona${sel === e.id ? " activa" : ""}${piensa(e.id) ? " pensando" : ""}`}
            style={{ left: `${e.zona.x}%`, top: `${e.zona.y}%`, width: `${e.zona.w}%`, height: `${e.zona.h}%`, ["--c" as string]: e.color }}
            onClick={() => setSel(sel === e.id ? "junta" : e.id)}
            aria-label={`Hablar con ${e.nombre}, ${e.area}`}
          >
            <span className="jt-cartel" style={{ top: `${e.cartel}%` }}>
              <b>{e.nombre}</b>
              <span>{e.area}</span>
            </span>
          </button>
        ))}
        <div
          className={`jt-tele${teleGrande ? " grande" : ""}`}
          role="button"
          tabIndex={0}
          aria-label="Pantalla de la presentación: tocá para agrandarla o achicarla"
          aria-live="polite"
          onClick={() => setTeleGrande((g) => !g)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              setTeleGrande((g) => !g);
            }
          }}
        >
          <LaminaTele key={`${sel}-${nroLamina % laminas.length}-${lamina.titulo}`} l={lamina} />
          {laminas.length > 1 && (
            <div className="jt-puntos">
              {laminas.map((_, i) => (
                <i key={i} className={i === nroLamina % laminas.length ? "on" : ""} />
              ))}
            </div>
          )}
          <span className="jt-lupa">{teleGrande ? "Tocá para achicar" : "Tocá para agrandar"}</span>
        </div>
        <div className="jt-cabecera">Tu lugar · cabecera</div>
      </section>

      <div className="jt-abajo">
        <section className="jt-caja">
          <div className="jt-chips" role="tablist" aria-label="Con quién hablás">
            <button type="button" role="tab" aria-selected={sel === "junta"} className={`jt-chip${sel === "junta" ? " on" : ""}`} style={{ ["--c" as string]: "#c9a26b" }} onClick={() => setSel("junta")}>
              <i />
              Toda la junta
            </button>
            {ENCARGADOS.map((e) => (
              <button key={e.id} type="button" role="tab" aria-selected={sel === e.id} className={`jt-chip${sel === e.id ? " on" : ""}`} style={{ ["--c" as string]: e.color }} onClick={() => setSel(e.id)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/junta/${e.id}.webp`} alt="" />
                {e.nombre}
              </button>
            ))}
          </div>

          {sinClave && <p className="jt-aviso">Falta conectar la inteligencia artificial: cargá ANTHROPIC_API_KEY en Vercel (la misma que usa Aprender).</p>}
          {faltaSql && <p className="jt-aviso">Falta correr sql/junta.sql en Supabase: la junta contesta igual, pero la conversación no queda guardada.</p>}

          <div className="jt-hilo" ref={hiloRef}>
            {delHilo.length === 0 && !enviando && (
              <p className="jt-vacio">
                {elegido ? (
                  <>
                    <b>{elegido.nombre}</b> · {elegido.area}. {elegido.rasgo} Preguntale lo que quieras de su área.
                  </>
                ) : (
                  <>
                    Llevá un tema a la mesa y te contestan los seis, cada uno desde su área, con un resumen al final. Por ejemplo: <b>¿conviene abrir los domingos?</b> o <b>¿cómo venimos este mes?</b>
                  </>
                )}
              </p>
            )}
            {delHilo.map((m) => {
              if (m.autor === "gonzalo")
                return (
                  <div key={m.id} className="jt-msg yo">
                    <div className="jt-burbuja">{m.texto}</div>
                  </div>
                );
              if (m.autor === "resumen")
                return (
                  <div key={m.id} className="jt-resumen">
                    <b>Resumen de la junta</b>
                    {m.texto}
                    {m.puntos?.length ? (
                      <ul>
                        {m.puntos.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              const e = encargado(m.autor);
              return (
                <div key={m.id} className="jt-msg" style={{ ["--c" as string]: e?.color ?? "#737373" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/junta/${m.autor}.webp`} alt="" />
                  <div className="jt-burbuja">
                    <div className="jt-quien">
                      {e?.nombre} <span>· {e?.area}</span>
                    </div>
                    {m.texto}
                    {tareasDe(m.id).map((t) => (
                      <button key={t.id} type="button" className="jt-propuso" onClick={() => setPanel("tareas")}>
                        <b>Propone una tarea:</b> {t.titulo}
                        <span className={`jt-estado ${t.estadoTarea === "PROPUESTA" ? "pendiente" : t.estadoTarea === "ACTIVA" ? "hecha" : "descartada"}`}>
                          {t.estadoTarea === "PROPUESTA" ? "Para aprobar" : t.estadoTarea === "ACTIVA" ? "Aprobada" : t.estadoTarea === "DESCARTADA" ? "Descartada" : "Quitada"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {enviando?.destino === sel && (
              <>
                <div className="jt-msg yo">
                  <div className="jt-burbuja">{enviando.pregunta}</div>
                </div>
                <p className="jt-espera">
                  <i />
                  {sel === "junta" ? "La junta está mirando los números… puede tardar unos 20 segundos." : `${elegido?.nombre} está mirando los números…`}
                </p>
              </>
            )}
          </div>

          {error && (
            <p className="jt-error" role="alert">
              {error}
            </p>
          )}
          <form
            className="jt-escribir"
            onSubmit={(ev) => {
              ev.preventDefault();
              enviar();
            }}
          >
            <textarea
              id="junta-mensaje"
              rows={1}
              value={texto}
              onChange={(ev) => setTexto(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && !ev.shiftKey) {
                  ev.preventDefault();
                  enviar();
                }
              }}
              placeholder={elegido ? `Escribile a ${elegido.nombre}…` : "Escribile a la junta…"}
              aria-label="Mensaje"
            />
            <button type="submit" disabled={!texto.trim() || enviando !== null}>
              Enviar
            </button>
          </form>
          <p className="jt-nota">Solo opinan y proponen: no cambian nada del sistema. Cada pregunta usa la inteligencia artificial, que se paga por uso; a toda la junta son siete consultas.</p>
        </section>

        <section className="jt-caja">
          <div className="jt-pestanas" role="tablist" aria-label="Panel">
            <button type="button" role="tab" aria-selected={panel === "tareas"} className={panel === "tareas" ? "on" : ""} onClick={() => setPanel("tareas")}>
              Tareas{propuestas > 0 && <span className="jt-cuenta alerta">{propuestas}</span>}
            </button>
            <button type="button" role="tab" aria-selected={panel === "mesa"} className={panel === "mesa" ? "on" : ""} onClick={() => setPanel("mesa")}>
              Sobre la mesa
            </button>
          </div>
          {panel === "tareas" ? (
            <JuntaTareas tareas={tareas.tareas} equipo={tareas.equipo} faltaSql={tareas.faltaSql} onCambio={recargarTareas} />
          ) : (
          <>
          {pendientes.length === 0 ? (
            <p className="jt-vacio">El sistema no marca nada pendiente ahora.</p>
          ) : (
            <div className="jt-pend">
              {pendientes.map((p) => (
                <Link key={`${p.titulo}-${p.href}`} href={p.href} style={{ ["--c" as string]: COLOR_PENDIENTE[p.color] }}>
                  <b>
                    {p.titulo} · {p.valor}
                  </b>
                  <span>{p.detalle}</span>
                </Link>
              ))}
            </div>
          )}
          <p className="jt-nota">Es lo mismo que ves en el Inicio, y la junta lo tiene en cuenta cuando opina. Los reportes del día, la semana y el mes llegan en la próxima etapa.</p>
          </>
          )}
        </section>
      </div>
    </div>
  );
}
