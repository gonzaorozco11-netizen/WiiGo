"use client";

import { useState } from "react";
import { enviarOpinionPaciente } from "./actions";
import { LARGO_OPINION, type ComoAparece } from "@/lib/opinionesPacientes";

const IDEAS = [
  { boton: "Me ayudó a…", texto: "Me ayudó a " },
  { boton: "Lo que más me gustó…", texto: "Lo que más me gustó fue " },
  { boton: "Se la recomiendo a…", texto: "Se la recomiendo a quien " },
];

export default function FormOpinion({
  token,
  profesional,
  nombres,
}: {
  token: string;
  profesional: { nombre: string; pila: string; cargo: string; foto: string | null };
  nombres: { NOMBRE: string; INICIALES: string };
}) {
  const [dni3, setDni3] = useState("");
  const [texto, setTexto] = useState("");
  const [como, setComo] = useState<ComoAparece>("NOMBRE");
  const [detalle, setDetalle] = useState("");
  const [acepta, setAcepta] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const [listo, setListo] = useState<string | null>(null);

  const largo = texto.trim().length;
  const quien = [como === "ANONIMO" ? `Paciente de ${profesional.pila}` : nombres[como], detalle.trim()].filter(Boolean).join(" · ");
  const falta = [!/^\d{3}$/.test(dni3) && "tu DNI", largo < LARGO_OPINION.minimo && "tu opinión", !acepta && "el permiso"].filter(Boolean) as string[];

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (falta.length > 0 || enviando) return;
    setError(null);
    setEnviando(true);
    enviarOpinionPaciente(token, { dni3, texto, como, detalle, acepta })
      .then((r) => {
        if (r.error) {
          setError(r.error);
          if (r.bloqueado) setBloqueado(true);
          return;
        }
        setListo(r.nombre ?? "");
      })
      .catch(() => setError("No se pudo enviar. Fijate tu conexión y probá de nuevo."))
      .finally(() => setEnviando(false));
  }

  if (listo !== null) {
    return (
      <div className="op-gracias">
        <div className="op-tilde" aria-hidden="true">
          ✓
        </div>
        <h1>¡Gracias{listo ? `, ${listo}` : ""}!</h1>
        <p>Tu opinión llegó. WiiGo la revisa y en unos días sale en la pantalla del local, en el perfil de {profesional.pila}.</p>
        <div className="op-cupon">
          <b>Pasá por WiiGo cuando quieras</b>
          <span>Con tu DNI en la caja juntás puntos del Club en cada compra.</span>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} noValidate>
      <div className="op-quien">
        {profesional.foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="op-foto" src={profesional.foto} alt="" />
        ) : (
          <span className="op-foto">{profesional.pila.charAt(0)}</span>
        )}
        <h1>¿Cómo te fue con {profesional.nombre}?</h1>
        {profesional.cargo && <p>{profesional.cargo}</p>}
      </div>

      <div className="op-campo">
        <label htmlFor="op-dni">Los últimos 3 números de tu DNI</label>
        <div className="op-dni">
          <span aria-hidden="true">•• •••</span>
          <input
            id="op-dni"
            inputMode="numeric"
            autoComplete="off"
            maxLength={3}
            placeholder="___"
            value={dni3}
            onChange={(e) => setDni3(e.target.value.replace(/\D/g, "").slice(0, 3))}
          />
        </div>
        <small>Así sabemos que sos vos y no alguien a quien le reenviaron el link.</small>
      </div>

      <div className="op-campo">
        <label htmlFor="op-texto">Tu opinión</label>
        <div className="op-ideas">
          {IDEAS.map((i) => (
            <button
              key={i.boton}
              type="button"
              onClick={() => {
                if (!texto.trim()) setTexto(i.texto);
                document.getElementById("op-texto")?.focus();
              }}
            >
              {i.boton}
            </button>
          ))}
        </div>
        <textarea
          id="op-texto"
          maxLength={LARGO_OPINION.maximo}
          placeholder="Contá cómo te sentiste en la consulta, qué aprendiste, qué cambió en tu día a día…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <div className="op-contador">
          <span className={largo < LARGO_OPINION.minimo ? "falta" : undefined}>
            {largo === 0 ? `Escribí al menos ${LARGO_OPINION.minimo} letras` : largo < LARGO_OPINION.minimo ? `Faltan ${LARGO_OPINION.minimo - largo} letras` : "¡Perfecto!"}
          </span>
          <span>
            {texto.length}/{LARGO_OPINION.maximo}
          </span>
        </div>
      </div>

      <p className="op-aviso">
        <span aria-hidden="true">🔒</span>
        <span>No pongas diagnósticos, enfermedades ni medicamentos. Es una opinión que va a ver cualquiera en el local.</span>
      </p>

      <div className="op-campo">
        <span className="op-rot">¿Cómo querés aparecer?</span>
        <div className="op-opciones" role="radiogroup" aria-label="Cómo querés aparecer">
          {(
            [
              ["NOMBRE", "Nombre", nombres.NOMBRE],
              ["INICIALES", "Iniciales", nombres.INICIALES],
              ["ANONIMO", "Sin nombre", "Paciente"],
            ] as const
          ).map(([valor, titulo, ejemplo]) => (
            <label key={valor}>
              <input type="radio" name="op-como" value={valor} checked={como === valor} onChange={() => setComo(valor)} />
              <span>
                {titulo}
                <small>{ejemplo}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="op-campo">
        <label htmlFor="op-detalle">
          Algo sobre vos <em>(si querés)</em>
        </label>
        <input id="op-detalle" maxLength={50} placeholder="Corredora · 34 años" value={detalle} onChange={(e) => setDetalle(e.target.value)} />
      </div>

      <div className="op-rot op-rot-vista">Así se va a ver en el local</div>
      <div className="op-vista">
        <span className={`op-vista-texto${texto.trim() ? "" : " vacia"}`}>{texto.trim() || "Tu opinión va a aparecer acá"}</span>
        <span className="op-vista-quien">{quien}</span>
      </div>

      <label className="op-check">
        <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
        <span>Acepto que WiiGo muestre esta opinión en la pantalla del local. Puedo pedir que la saquen cuando quiera.</span>
      </label>

      {error && <p className="op-error">{error}</p>}
      <button className="op-boton" type="submit" disabled={falta.length > 0 || enviando || bloqueado}>
        {enviando ? "Enviando..." : "Enviar mi opinión"}
      </button>
      {!bloqueado && falta.length > 0 && <p className="op-motivo">Completá {falta.join(", ").replace(/, ([^,]*)$/, " y $1")}</p>}
      <p className="op-pie">El link es solo tuyo y se usa una vez.</p>
    </form>
  );
}
