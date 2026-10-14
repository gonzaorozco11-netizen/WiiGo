"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { guardarAvisos, type AvisosPortal } from "@/app/portal/avisos/actions";
import { AVISOS, MAX_MAILS, type TipoAviso } from "@/lib/avisosMarca";
import { ETIQUETA_PLAN } from "@/lib/planesMarca";

// Las preferencias de aviso.
//
// Cada aviso dice para qué le sirve a la marca, no qué hace el sistema. Y lo
// que puede molestar —el mail por cada venta— arranca apagado: un aviso que
// cansa termina en spam, y ahí se pierden también los que importan.

function cuando(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function PortalAvisos({ datos }: { datos: AvisosPortal }) {
  const [prendidos, setPrendidos] = useState<Record<string, boolean>>(datos.prendidos);
  const [mails, setMails] = useState<string[]>(datos.mails);
  const [nuevo, setNuevo] = useState("");
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  if (!datos.habilitado) {
    return (
      <main className="portal-lienzo">
        <div className="av-cab">
          <h1>Avisos</h1>
          <p>Para que no tengas que entrar a mirar. Te escribimos solo cuando hay algo que hacer.</p>
        </div>
        <div className="av-bloqueado">
          <span className="medalla">Silver</span>
          <h2>Los avisos son del plan Silver para arriba</h2>
          <p>
            Hoy tenés {ETIQUETA_PLAN[datos.plan]}: todo lo del portal lo ves entrando. Con Silver te
            escribimos cuando se agota un producto, cuando te respondemos algo, y cuando vendés.
          </p>
          <Link className="av-btn" href="/portal">
            Ver qué incluye Silver
          </Link>
        </div>
      </main>
    );
  }

  function guardar(siguientes: Record<string, boolean>, siguientesMails: string[]) {
    setError(null);
    empezar(async () => {
      const r = await guardarAvisos({ prendidos: siguientes, mails: siguientesMails });
      if (r.error) setError(r.error);
      else {
        setGuardado(true);
        setTimeout(() => setGuardado(false), 1600);
      }
    });
  }

  function alternar(tipo: TipoAviso) {
    const siguientes = { ...prendidos, [tipo]: !prendidos[tipo] };
    setPrendidos(siguientes);
    guardar(siguientes, mails);
  }

  function agregarMail() {
    const m = nuevo.trim();
    if (!m) return;
    const siguientes = [...new Set([...mails, m])];
    setMails(siguientes);
    setNuevo("");
    guardar(prendidos, siguientes);
  }

  function quitarMail(m: string) {
    const siguientes = mails.filter((x) => x !== m);
    setMails(siguientes);
    guardar(prendidos, siguientes);
  }

  return (
    <main className="portal-lienzo">
      <div className="av-cab">
        <div>
          <h1>Avisos</h1>
          <p>Para que no tengas que entrar a mirar. Te escribimos solo cuando hay algo que hacer.</p>
        </div>
        {guardado && <span className="av-guardado">Guardado ✓</span>}
      </div>

      {error && <p className="av-error">{error}</p>}

      {mails.length === 0 && (
        <div className="av-sinmail">
          <b>Todavía no nos dijiste a dónde escribirte.</b> Cargá un mail abajo: hasta que no haya
          uno, no sale ningún aviso aunque los tengas todos prendidos.
        </div>
      )}

      <div className="av-grid">
        <section className="av-caja">
          <h2>Qué te avisamos</h2>
          <p className="sub">Prendé solo lo que te sirva. Se guarda solo.</p>

          {AVISOS.map((a) => (
            <div className="av-fila" key={a.tipo}>
              <div>
                <p className="t">
                  {a.titulo}
                  {a.proximamente && <span className="pronto">Pronto</span>}
                </p>
                <p className="d">{a.detalle}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(prendidos[a.tipo])}
                aria-label={a.titulo}
                className={`av-sw${prendidos[a.tipo] ? " on" : ""}`}
                disabled={pendiente}
                onClick={() => alternar(a.tipo)}
              >
                <b />
              </button>
            </div>
          ))}
        </section>

        <div className="av-col">
          <section className="av-caja">
            <h2>A dónde te escribimos</h2>
            <p className="sub">Hasta {MAX_MAILS} direcciones.</p>

            {mails.map((m) => (
              <div className="av-mail" key={m}>
                <span>{m}</span>
                <button type="button" disabled={pendiente} onClick={() => quitarMail(m)}>
                  Quitar
                </button>
              </div>
            ))}

            {mails.length < MAX_MAILS && (
              <label className="av-agregar">
                <span>Agregar un mail</span>
                <div>
                  <input
                    type="email"
                    value={nuevo}
                    placeholder="nombre@tumarca.com"
                    onChange={(e) => setNuevo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        agregarMail();
                      }
                    }}
                  />
                  <button type="button" disabled={pendiente || nuevo.trim() === ""} onClick={agregarMail}>
                    Agregar
                  </button>
                </div>
              </label>
            )}
          </section>

          <section className="av-caja pronto-caja">
            <div className="cab">
              <h2>Por WhatsApp</h2>
              <span className="pronto">Pronto</span>
            </div>
            <p className="sub">Por ahora solo mail. Cuando esté, lo vas a poder prender acá mismo.</p>
          </section>

          {datos.ultimos.length > 0 && (
            <section className="av-caja">
              <h2>Lo último que te mandamos</h2>
              <ul className="av-ultimos">
                {datos.ultimos.map((u, i) => (
                  <li key={i} className={u.ok ? undefined : "falló"}>
                    <span className="a">{u.asunto ?? u.tipo}</span>
                    <span className="c mono">{cuando(u.cuando)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <div className="av-tope">
        <b>Nunca más de un mail por día por cada cosa.</b> Si se agotan cuatro productos el mismo
        día, te llega uno solo con los cuatro. El aviso que cansa se manda a spam, y ahí perdemos
        también los que importan.
      </div>
    </main>
  );
}
