"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { datosDeGuia, preguntarEnGuia, responderPreguntaGuia, descartarPreguntaGuia } from "@/app/guia/actions";
import type { Audiencia, DatosGuia, GuiaLista } from "@/lib/guia/tipos";
import "./guia.css";

// Guía WiiGo: el botón "¿Alguna duda?" de todas las pantallas (equipo,
// portal de marcas y espacio de las profesionales). Mockup aprobado por
// Gonzalo: https://claude.ai/artifact/V57Md18ndHtDkw9SY69qHR
//
// Lo que se ve lo arma el servidor según quién es (app/guia/actions.ts): el
// panel no decide nada, solo muestra. Se carga recién al abrirlo, así no
// suma nada a cada pantalla.

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const sinEtiquetas = (html: string) => html.replace(/<[^>]+>/g, "");

/** "En esta pantalla": la ruta más larga que coincide. "=" adelante pide la ruta exacta. */
function puntaje(ruta: string, pathname: string) {
  if (ruta.startsWith("=")) return pathname === ruta.slice(1) ? ruta.length : -1;
  return pathname === ruta || pathname.startsWith(`${ruta}/`) ? ruta.length : -1;
}

function textoDe(g: GuiaLista) {
  return sinTildes([g.titulo, g.tema, g.donde, ...(g.pasos ?? []), ...(g.puntos ?? []), g.tip ?? ""].map(sinEtiquetas).join(" "));
}

const fechaCorta = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00-03:00` : iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });

const ETIQUETA_AUDIENCIA: Record<Audiencia, string> = { interno: "Equipo", marca: "Marca", profesional: "Profesional" };

export default function GuiaWiigo({ audiencia, preguntasSinResponder = 0 }: { audiencia: Audiencia; preguntasSinResponder?: number }) {
  const pathname = usePathname() ?? "/";
  const [abierta, setAbierta] = useState(false);
  const [datos, setDatos] = useState<DatosGuia | null>(null);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [tab, setTab] = useState<"guias" | "glosario" | "novedades">("guias");
  const [busqueda, setBusqueda] = useState("");
  const [abiertaId, setAbiertaId] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setCargando(true);
    setFallo(false);
    datosDeGuia(audiencia)
      .then((d) => {
        setDatos(d);
        if (!d) setFallo(true);
      })
      .catch(() => setFallo(true))
      .finally(() => setCargando(false));
  }, [audiencia]);

  useEffect(() => {
    if (abierta && !datos && !cargando) cargar();
  }, [abierta, datos, cargando, cargar]);

  // Escape cierra; al cambiar de pantalla vuelve a la lista.
  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAbierta(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierta]);
  useEffect(() => setAbiertaId(null), [pathname]);

  const deEstaPantalla = useMemo(() => {
    if (!datos) return [];
    return datos.guias
      .map((g) => ({ g, p: Math.max(-1, ...(g.rutas ?? []).map((r) => puntaje(r, pathname))) }))
      .filter((x) => x.p >= 0)
      .sort((a, b) => b.p - a.p)
      .slice(0, 4)
      .map((x) => x.g);
  }, [datos, pathname]);

  // Para el Dueño: cuántas preguntas esperan respuesta (lo trae el layout,
  // así se ve el número sin abrir el panel).
  const pendientes = datos ? datos.pendientes.length : preguntasSinResponder;

  return (
    <div className="guia-raiz print:hidden">
      <button
        type="button"
        className="guia-fab"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        aria-controls="guia-panel"
      >
        <span className="guia-q" aria-hidden="true">
          ?
        </span>
        ¿Alguna duda?
        {pendientes > 0 && <span className="guia-punto">{pendientes}</span>}
      </button>

      {abierta && <div className="guia-velo" onClick={() => setAbierta(false)} aria-hidden="true" />}
      <aside id="guia-panel" className={`guia-panel${abierta ? " abierta" : ""}`} aria-label="Guía WiiGo" aria-hidden={!abierta}>
        <div className="guia-cab">
          <div className="guia-cab-fila">
            <div>
              <h2>Guía WiiGo</h2>
              <p>{datos ? `Para ${datos.quien.split(" (")[0]}` : "Cómo se hace cada cosa"}</p>
            </div>
            <button type="button" className="guia-x" onClick={() => setAbierta(false)} aria-label="Cerrar la guía">
              ×
            </button>
          </div>
          <label className="guia-buscar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                setAbiertaId(null);
                if (tab === "novedades") setTab("guias");
              }}
              placeholder="Escribí tu duda: puntos, precio, cartel…"
              aria-label="Buscar en la guía"
            />
          </label>
          <div className="guia-tabs" role="tablist">
            {(["guias", "glosario", "novedades"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                  setAbiertaId(null);
                }}
              >
                {t === "guias" ? "Guías" : t === "glosario" ? "Glosario" : "Novedades"}
              </button>
            ))}
          </div>
        </div>

        <div className="guia-cuerpo">
          {cargando && !datos ? (
            <p className="guia-vacio">Cargando…</p>
          ) : fallo || !datos ? (
            <div className="guia-vacio">
              No se pudo cargar la guía.{" "}
              <button type="button" className="guia-link" onClick={cargar}>
                Probar de nuevo
              </button>
            </div>
          ) : abiertaId ? (
            <GuiaAbierta
              guia={datos.guias.find((g) => g.id === abiertaId)!}
              todas={datos.guias}
              onAbrir={setAbiertaId}
              onVolver={() => setAbiertaId(null)}
              datos={datos}
              audiencia={audiencia}
              pathname={pathname}
              onCambio={cargar}
            />
          ) : tab === "glosario" ? (
            <Glosario datos={datos} busqueda={busqueda} />
          ) : tab === "novedades" ? (
            <Novedades datos={datos} />
          ) : busqueda.trim() ? (
            <Resultados datos={datos} busqueda={busqueda} onAbrir={setAbiertaId} audiencia={audiencia} pathname={pathname} onCambio={cargar} />
          ) : (
            <Inicio datos={datos} deEstaPantalla={deEstaPantalla} onAbrir={setAbiertaId} audiencia={audiencia} pathname={pathname} onCambio={cargar} />
          )}
        </div>
      </aside>
    </div>
  );
}

function Item({ g, onAbrir }: { g: GuiaLista; onAbrir: (id: string) => void }) {
  return (
    <button type="button" className="guia-item" onClick={() => onAbrir(g.id)}>
      <span>
        <span className="t">{g.titulo}</span>
        {g.esNueva && <span className="guia-nuevo">Nuevo</span>}
        <span className="m">{g.donde}</span>
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </button>
  );
}

type ParteComun = { datos: DatosGuia; audiencia: Audiencia; pathname: string; onCambio: () => void };

function Inicio({ datos, deEstaPantalla, onAbrir, ...comun }: ParteComun & { deEstaPantalla: GuiaLista[]; onAbrir: (id: string) => void }) {
  const temas = [...new Set(datos.guias.map((g) => g.tema))];
  return (
    <>
      {datos.esAdmin && <Bandeja datos={datos} onCambio={comun.onCambio} />}
      {deEstaPantalla.length > 0 && (
        <div className="guia-ctx">
          <p className="guia-sec">En esta pantalla</p>
          {deEstaPantalla.map((g) => (
            <Item key={g.id} g={g} onAbrir={onAbrir} />
          ))}
        </div>
      )}
      {temas.map((t) => (
        <div key={t}>
          <p className="guia-sec">{t}</p>
          {datos.guias
            .filter((g) => g.tema === t)
            .map((g) => (
              <Item key={g.id} g={g} onAbrir={onAbrir} />
            ))}
        </div>
      ))}
      {datos.frecuentes.length > 0 && (
        <div>
          <p className="guia-sec">Preguntas frecuentes</p>
          {datos.frecuentes.map((f) => (
            <details key={f.id} className="guia-faq">
              <summary>{f.pregunta}</summary>
              <p>{f.respuesta}</p>
            </details>
          ))}
        </div>
      )}
      <MisPreguntas datos={datos} />
      <Preguntar {...comun} datos={datos} />
    </>
  );
}

function Resultados({ datos, busqueda, onAbrir, ...comun }: ParteComun & { busqueda: string; onAbrir: (id: string) => void }) {
  const q = sinTildes(busqueda.trim());
  const guias = datos.guias.filter((g) => textoDe(g).includes(q));
  const glosario = datos.glosario.filter((t) => sinTildes(`${t.termino} ${t.definicion}`).includes(q));
  const faq = datos.frecuentes.filter((f) => sinTildes(`${f.pregunta} ${f.respuesta}`).includes(q));
  const nada = guias.length + glosario.length + faq.length === 0;
  return (
    <>
      {guias.length > 0 && (
        <>
          <p className="guia-sec">Guías</p>
          {guias.map((g) => (
            <Item key={g.id} g={g} onAbrir={onAbrir} />
          ))}
        </>
      )}
      {faq.length > 0 && (
        <>
          <p className="guia-sec">Preguntas frecuentes</p>
          {faq.map((f) => (
            <details key={f.id} className="guia-faq" open>
              <summary>{f.pregunta}</summary>
              <p>{f.respuesta}</p>
            </details>
          ))}
        </>
      )}
      {glosario.length > 0 && (
        <>
          <p className="guia-sec">En el glosario</p>
          <dl className="guia-glos">
            {glosario.map((t) => (
              <div key={t.termino}>
                <dt>{t.termino}</dt>
                <dd>{t.definicion}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {nada && <p className="guia-vacio">No encontramos nada con «{busqueda}».</p>}
      <Preguntar {...comun} datos={datos} inicial={nada ? busqueda : ""} />
    </>
  );
}

function GuiaAbierta({
  guia,
  todas,
  onAbrir,
  onVolver,
  ...comun
}: ParteComun & { guia: GuiaLista; todas: GuiaLista[]; onAbrir: (id: string) => void; onVolver: () => void }) {
  const [util, setUtil] = useState<"si" | "no" | null>(null);
  const rel = (guia.rel ?? []).map((id) => todas.find((g) => g.id === id)).filter((g): g is GuiaLista => !!g);
  return (
    <article className="guia-art">
      <button type="button" className="guia-volver" onClick={onVolver}>
        ← Volver
      </button>
      <p className="guia-tema">{guia.tema}</p>
      <h3>{guia.titulo}</h3>
      <p className="guia-donde">
        Dónde: <b>{guia.donde}</b>
      </p>
      {guia.puntos ? (
        <ul className="guia-puntos">
          {guia.puntos.map((p, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: p }} />
          ))}
        </ul>
      ) : (
        <ol className="guia-pasos">
          {(guia.pasos ?? []).map((p, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: p }} />
          ))}
        </ol>
      )}
      {guia.tabla && (
        <div className="guia-tabla">
          <p>{guia.tabla.titulo}</p>
          <table>
            <thead>
              <tr>
                {guia.tabla.cab.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guia.tabla.filas.map((f, i) => (
                <tr key={i}>
                  {f.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {guia.tip && <div className="guia-tip">💡 {guia.tip}</div>}
      {rel.length > 0 && (
        <>
          <p className="guia-sec">Relacionadas</p>
          <div className="guia-rel">
            {rel.map((g) => (
              <button key={g.id} type="button" onClick={() => onAbrir(g.id)}>
                {g.titulo}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="guia-util">
        {util === "si" ? (
          <span className="ok">¡Gracias!</span>
        ) : util === "no" ? (
          <span>Contanos qué te faltó y lo sumamos a la guía:</span>
        ) : (
          <>
            ¿Te sirvió?
            <button type="button" onClick={() => setUtil("si")}>
              Sí
            </button>
            <button type="button" onClick={() => setUtil("no")}>
              No
            </button>
          </>
        )}
      </div>
      {util === "no" && <Preguntar {...comun} inicial={`Sobre «${sinEtiquetas(guia.titulo)}»: `} sinTitulo />}
    </article>
  );
}

function Glosario({ datos, busqueda }: { datos: DatosGuia; busqueda: string }) {
  const q = sinTildes(busqueda.trim());
  const lista = datos.glosario.filter((t) => !q || sinTildes(`${t.termino} ${t.definicion}`).includes(q));
  if (lista.length === 0) return <p className="guia-vacio">No hay palabras con «{busqueda}».</p>;
  return (
    <dl className="guia-glos">
      {lista.map((t) => (
        <div key={t.termino}>
          <dt>{t.termino}</dt>
          <dd>{t.definicion}</dd>
        </div>
      ))}
    </dl>
  );
}

function Novedades({ datos }: { datos: DatosGuia }) {
  if (datos.novedades.length === 0) return <p className="guia-vacio">No hay novedades de los últimos meses.</p>;
  return (
    <>
      {datos.novedades.map((n, i) => (
        <div key={i} className="guia-nov">
          <p className="f">{fechaCorta(n.fecha)}</p>
          <p className="t">{n.titulo}</p>
          <p>{n.detalle}</p>
        </div>
      ))}
    </>
  );
}

function MisPreguntas({ datos }: { datos: DatosGuia }) {
  if (datos.misPreguntas.length === 0) return null;
  return (
    <div>
      <p className="guia-sec">Tus preguntas</p>
      {datos.misPreguntas.map((p) => (
        <div key={p.id} className="guia-mia">
          <p className="q">{p.pregunta}</p>
          {p.respuesta ? <p className="r">{p.respuesta}</p> : <p className="espera">Esperando respuesta · {fechaCorta(p.fecha)}</p>}
        </div>
      ))}
    </div>
  );
}

function Preguntar({ datos, audiencia, pathname, onCambio, inicial = "", sinTitulo = false }: ParteComun & { inicial?: string; sinTitulo?: boolean }) {
  const [texto, setTexto] = useState(inicial);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  useEffect(() => setTexto(inicial), [inicial]);
  if (!datos.preguntasDisponibles || datos.esAdmin) return null;
  if (listo)
    return (
      <div className="guia-preg">
        <p className="t">Pregunta enviada</p>
        <p>Te avisamos acá mismo cuando esté la respuesta.</p>
      </div>
    );
  return (
    <div className="guia-preg">
      {!sinTitulo && (
        <>
          <p className="t">¿No encontraste lo que buscabas?</p>
          <p>Escribí tu pregunta. Le llega a WiiGo y la respuesta queda en esta guía.</p>
        </>
      )}
      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Tu pregunta" placeholder="Ej.: ¿qué hago si un cliente quiere devolver algo?" />
      {error && <p className="guia-error">{error}</p>}
      <div className="fila">
        <button
          type="button"
          className="guia-btn"
          disabled={enviando}
          onClick={() => {
            setError(null);
            setEnviando(true);
            preguntarEnGuia(audiencia, texto, pathname)
              .then((r) => {
                if (r.error) return setError(r.error);
                setListo(true);
                onCambio();
              })
              .finally(() => setEnviando(false));
          }}
        >
          {enviando ? "Enviando…" : "Enviar pregunta"}
        </button>
      </div>
    </div>
  );
}

/** Solo el Dueño: lo que preguntaron. Al responder, si es para todos, queda en Preguntas frecuentes. */
function Bandeja({ datos, onCambio }: { datos: DatosGuia; onCambio: () => void }) {
  if (datos.pendientes.length === 0) return null;
  return (
    <div className="guia-bandeja">
      <p className="t">Preguntas que te hicieron · {datos.pendientes.length}</p>
      <p>Respondé y, si sirve para todos, queda en Preguntas frecuentes de esa guía.</p>
      {datos.pendientes.map((p) => (
        <Pendiente key={p.id} p={p} onCambio={onCambio} />
      ))}
    </div>
  );
}

function Pendiente({ p, onCambio }: { p: DatosGuia["pendientes"][number]; onCambio: () => void }) {
  const [respuesta, setRespuesta] = useState("");
  const [publica, setPublica] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function correr(accion: () => Promise<{ error: string | null }>) {
    setError(null);
    setTrabajando(true);
    accion()
      .then((r) => (r.error ? setError(r.error) : onCambio()))
      .finally(() => setTrabajando(false));
  }
  return (
    <div className="guia-pend">
      <p className="q">{p.pregunta}</p>
      <p className="w">
        {p.quien} · {ETIQUETA_AUDIENCIA[p.audiencia]}
        {p.pantalla ? ` · en ${p.pantalla}` : ""} · {fechaCorta(p.fecha)}
      </p>
      <textarea value={respuesta} onChange={(e) => setRespuesta(e.target.value)} placeholder="Tu respuesta" aria-label="Tu respuesta" />
      <label className="guia-check">
        <input type="checkbox" checked={publica} onChange={(e) => setPublica(e.target.checked)} />
        Que la vean todos ({ETIQUETA_AUDIENCIA[p.audiencia].toLowerCase()}s) en Preguntas frecuentes
      </label>
      {error && <p className="guia-error">{error}</p>}
      <div className="fila">
        <button type="button" className="guia-link" disabled={trabajando} onClick={() => correr(() => descartarPreguntaGuia(p.id))}>
          Descartar
        </button>
        <button type="button" className="guia-btn" disabled={trabajando} onClick={() => correr(() => responderPreguntaGuia(p.id, respuesta, publica))}>
          Responder
        </button>
      </div>
    </div>
  );
}
