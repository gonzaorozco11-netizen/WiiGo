"use client";

import { useEffect, useState } from "react";
import "./perfilProfesional.css";

// Piezas del perfil de la profesional en la pantalla asesora, rediseñado como
// un perfil de red social (Gonzalo, 2026-11-05; vista previa aprobada:
// https://claude.ai/artifact/AC9DpvxkvjBA8LfkMus9BJ):
// - las fotos pasan como historias de Instagram, con zoom lento (Ken Burns);
// - formación y trayectoria en píldoras con ícono, que se levantan al tocarlas;
// - los números de su recorrido, que suben al abrir.
// Para la all-in-one: solo se animan transform y opacity, sin will-change.

type Idioma = "es" | "en" | "pt";

const DURACION_FOTO = 5000;

/**
 * Las fotos de la profesional una detrás de otra, con rayitas arriba como las
 * historias. Tocando la mitad izquierda vuelve, la derecha avanza. Con una sola
 * foto no hay rayitas: queda con el zoom lento.
 */
export function CarruselProfesional({
  fotos,
  inicial,
  children,
  style,
}: {
  fotos: string[];
  /** Lo que va sin foto: la inicial grande. */
  inicial: string;
  /** Lo que va encima (nombre, matrícula). */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const [actual, setActual] = useState(0);
  // Cambia en cada foto para reiniciar la rayita y el zoom aunque se repita la misma.
  const [vuelta, setVuelta] = useState(0);
  const varias = fotos.length > 1;

  useEffect(() => {
    if (!varias) return;
    const id = window.setTimeout(() => {
      setActual((a) => (a + 1) % fotos.length);
      setVuelta((v) => v + 1);
    }, DURACION_FOTO);
    return () => window.clearTimeout(id);
  }, [actual, vuelta, varias, fotos.length]);

  function ir(paso: number) {
    setActual((a) => (a + paso + fotos.length) % fotos.length);
    setVuelta((v) => v + 1);
  }

  return (
    <div className="pp-carrusel" style={style}>
      {fotos.length === 0 && <span className="pp-inicial">{inicial}</span>}
      {fotos.map((url, i) => (
        <div key={url} className={`pp-foto${i === actual ? " on" : ""}`} aria-hidden={i !== actual}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={i === actual ? `on-${vuelta}` : "off"} src={url} alt="" />
        </div>
      ))}
      <div className="pp-sombra" />
      {varias && (
        <div className="pp-barras" aria-hidden="true">
          {fotos.map((url, i) => (
            <i key={`${url}-${i === actual ? vuelta : "x"}`} className={i < actual ? "hecha" : i === actual ? "va" : undefined} style={{ animationDuration: `${DURACION_FOTO}ms` }} />
          ))}
        </div>
      )}
      {varias && (
        <div className="pp-toques">
          <button type="button" aria-label="Foto anterior" onClick={() => ir(-1)} />
          <button type="button" aria-label="Foto siguiente" onClick={() => ir(1)} />
        </div>
      )}
      {children}
    </div>
  );
}

/** El ícono de cada formación o lugar, según lo que dice. */
function iconoDe(texto: string, tipo: "formacion" | "trayectoria") {
  const t = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (tipo === "formacion") {
    if (/isak|antropometr/.test(t)) return "📏";
    if (/deport|fitness|entrenamiento/.test(t)) return "🏃";
    if (/planta|vegan|vegetar/.test(t)) return "🌱";
    if (/magister|master|maestr|doctor|posgrado|especiali|diplomat/.test(t)) return "🎖️";
    if (/licenc|grado|universidad|titulo/.test(t)) return "🎓";
    return "📚";
  }
  if (/instituto|hospital|clinica|medicina|sanatorio/.test(t)) return "🏥";
  if (/club|division|futbol|rugby|basquet|hockey|primera|seleccion/.test(t)) return "⚽";
  if (/fundador|cofundador|director|duen/.test(t)) return "✨";
  if (/docen|profesor|curso|charla|catedra/.test(t)) return "🎤";
  if (/consultorio|atencion|privad/.test(t)) return "🩺";
  return "💼";
}

export type Recorrido = { id: string; que: string; donde: string | null; cuando: string };

/** Formación o trayectoria en píldoras con ícono, que entran de a una. */
export function PildorasRecorrido({ items, tipo }: { items: Recorrido[]; tipo: "formacion" | "trayectoria" }) {
  return (
    <div className="pp-pildoras">
      {items.map((x, i) => (
        <div key={x.id} className={`pp-pildora ${tipo}`} style={{ animationDelay: `${0.08 + i * 0.07}s` }}>
          <i aria-hidden="true">{iconoDe(`${x.que} ${x.donde ?? ""}`, tipo)}</i>
          <span>
            <b>{x.que}</b>
            {x.donde && <small>{x.donde}</small>}
          </span>
          {x.cuando && <em>{x.cuando}</em>}
        </div>
      ))}
    </div>
  );
}

const TXT = {
  es: { formaciones: (n: number) => (n === 1 ? "formación" : "formaciones"), lugares: (n: number) => (n === 1 ? "lugar donde trabajó" : "lugares donde trabajó"), anios: (n: number) => (n === 1 ? "año de experiencia" : "años de experiencia") },
  en: { formaciones: (n: number) => (n === 1 ? "qualification" : "qualifications"), lugares: (n: number) => (n === 1 ? "place worked" : "places worked"), anios: (n: number) => (n === 1 ? "year of experience" : "years of experience") },
  pt: { formaciones: (n: number) => (n === 1 ? "formação" : "formações"), lugares: (n: number) => (n === 1 ? "lugar onde trabalhou" : "lugares onde trabalhou"), anios: (n: number) => (n === 1 ? "ano de experiência" : "anos de experiência") },
};

function Contador({ hasta }: { hasta: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const quieto = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let id = 0;
    if (quieto) {
      id = requestAnimationFrame(() => setV(hasta));
      return () => cancelAnimationFrame(id);
    }
    const t0 = performance.now() + 300;
    const paso = (t: number) => {
      const x = Math.max(0, Math.min(1, (t - t0) / 900));
      setV(Math.round(hasta * (1 - Math.pow(1 - x, 3))));
      if (x < 1) id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [hasta]);
  return <>{v}</>;
}

/**
 * Los números de su recorrido: formaciones, lugares donde trabajó y años de
 * experiencia (solo si cargó desde qué año). Salen solos de lo que ella carga.
 */
export function NumerosProfesional({ formaciones, lugares, desde, idioma }: { formaciones: number; lugares: number; desde: number | null; idioma: Idioma }) {
  const t = TXT[idioma] ?? TXT.es;
  const [anioActual] = useState(() => new Date().getFullYear());
  const anios = desde ? Math.max(1, anioActual - desde) : 0;
  const numeros = [
    formaciones > 0 ? { n: formaciones, txt: t.formaciones(formaciones) } : null,
    lugares > 0 ? { n: lugares, txt: t.lugares(lugares) } : null,
    anios > 0 ? { n: anios, txt: t.anios(anios) } : null,
  ].filter((x): x is { n: number; txt: string } => x !== null);
  if (numeros.length === 0) return null;
  return (
    <div className="pp-numeros" style={{ gridTemplateColumns: `repeat(${numeros.length}, minmax(0, 1fr))` }}>
      {numeros.map((x, i) => (
        <div key={x.txt} className="pp-numero" style={{ animationDelay: `${0.12 + i * 0.08}s` }}>
          <b>
            <Contador hasta={x.n} />
          </b>
          <span>{x.txt}</span>
        </div>
      ))}
    </div>
  );
}
