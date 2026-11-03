"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { colorDeProducto, textoPosicionModulo, type ModuloGondola, type UbicacionGondola } from "@/lib/gondola";
import "./viajeGondola.css";

// "¿Dónde lo encuentro?" como un viaje (Gonzalo, 2026-11-02; vista previa
// aprobada: https://claude.ai/artifact/KHCcZNFtaSzt6rsgriKqR1).
//
// La cámara arranca viendo la pared entera con los muebles reales del local,
// se acerca al mueble del producto y el producto sale del estante hacia el
// cliente, con un anillo latiendo y los pasos abajo.
//
// Hecho para la all-in-one del local, que tiene una placa Android floja y
// puede tener un navegador viejo:
// - solo se anima `transform` y `opacity` (los resuelve la placa de video);
// - nada de desenfoques, `gap` en flex, `inset` ni `aspect-ratio`;
// - va en un portal al <body>: la ficha del producto tiene su propio
//   `transform` y un `position: fixed` adentro quedaría encerrado en ella.

type Idioma = "es" | "en" | "pt";

// Medidas de la escena, en px antes de la cámara.
const ANCHO_MUEBLE = 270;
const SEPARACION = 16;
const ALTO_CARTEL = 66;
const ALTO_MUEBLE = 420;
const MARGEN = 10;
const ZOOM_LUGAR = 1.4;

const TXT = {
  es: { llevamos: "Te llevamos hasta", volver: "Volver al producto", otraVez: "Ver de nuevo", aca: "¡Acá está!", mueble: "Mueble", cartel: "Buscá el cartel", fila: { arriba: "Fila de arriba", ojos: "A la altura de los ojos", manos: "Fila del medio", abajo: "Fila de abajo" }, lugar: (n: number) => (n === 1 ? "El primero de la izquierda" : `El ${n}.º desde la izquierda`) },
  en: { llevamos: "Let's find", volver: "Back to the product", otraVez: "Show again", aca: "Here it is!", mueble: "Shelf", cartel: "Look for the sign", fila: { arriba: "Top shelf", ojos: "Eye level", manos: "Middle shelf", abajo: "Bottom shelf" }, lugar: (n: number) => (n === 1 ? "First from the left" : `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"} from the left`) },
  pt: { llevamos: "Vamos até", volver: "Voltar ao produto", otraVez: "Ver de novo", aca: "Está aqui!", mueble: "Móvel", cartel: "Procure a placa", fila: { arriba: "Prateleira de cima", ojos: "Altura dos olhos", manos: "Prateleira do meio", abajo: "Prateleira de baixo" }, lugar: (n: number) => (n === 1 ? "O primeiro da esquerda" : `O ${n}º da esquerda`) },
};

export default function ViajeGondola({
  gondola,
  ubicacion,
  nombre,
  imagen,
  idioma,
  onVolver,
}: {
  gondola: ModuloGondola[];
  ubicacion: UbicacionGondola;
  nombre: string;
  imagen: string | null;
  idioma: Idioma;
  onVolver: () => void;
}) {
  const t = TXT[idioma] ?? TXT.es;
  const { modulo, fila, columna } = ubicacion;
  const indice = Math.max(0, gondola.indexOf(modulo));
  const numero = indice + 1;
  const altura = modulo.filas[fila]?.altura ?? "manos";
  const [paso, setPaso] = useState<0 | 1 | 2>(0);
  const [montado, setMontado] = useState(false);
  const tiempos = useRef<number[]>([]);

  // Dónde cae el lugar dentro de la escena, para que la cámara lo ponga en el medio.
  const camara = useMemo(() => {
    const total = gondola.length;
    const anchoEscena = total * (ANCHO_MUEBLE + SEPARACION);
    const altoEscena = ALTO_CARTEL + ALTO_MUEBLE;
    const izquierdaMueble = SEPARACION / 2 + indice * (ANCHO_MUEBLE + SEPARACION);
    const centroMueble = izquierdaMueble + ANCHO_MUEBLE / 2;
    const pesos = modulo.filas.map((f) => (f.grande ? 2 : 1));
    const pesoTotal = pesos.reduce((a, b) => a + b, 0) || 1;
    const antes = pesos.slice(0, fila).reduce((a, b) => a + b, 0);
    const altoUtil = ALTO_MUEBLE - 2 * MARGEN;
    const lugares = modulo.filas[fila]?.lugares ?? 6;
    const anchoUtil = ANCHO_MUEBLE - 2 * MARGEN;
    const x = izquierdaMueble + MARGEN + ((columna + 0.5) * anchoUtil) / lugares;
    const y = ALTO_CARTEL + MARGEN + ((antes + (pesos[fila] ?? 1) * 0.6) * altoUtil) / pesoTotal;
    const anchoPantalla = typeof window !== "undefined" ? window.innerWidth : 1600;
    const entra = Math.min(0.9, (anchoPantalla * 0.94) / anchoEscena);
    const dx = x - anchoEscena / 2;
    const dy = y - altoEscena / 2;
    return {
      anchoEscena,
      altoEscena,
      general: `rotateX(12deg) translate3d(0px, 0px, -380px) scale(${entra.toFixed(3)})`,
      mueble: `rotateX(7deg) rotateY(-8deg) translate3d(${(-(centroMueble - anchoEscena / 2)).toFixed(1)}px, 70px, -140px) scale(1)`,
      // De frente (sin girar en Y): girada, el producto salía hacia el costado
      // y quedaba encima del mueble de al lado.
      lugar: `rotateX(4deg) rotateY(0deg) translate3d(${(-dx * ZOOM_LUGAR).toFixed(1)}px, ${(-dy * ZOOM_LUGAR + 10).toFixed(1)}px, 40px) scale(${ZOOM_LUGAR})`,
    };
  }, [gondola, modulo, indice, fila, columna]);

  function viajar() {
    tiempos.current.forEach((id) => window.clearTimeout(id));
    const quieto = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (quieto) {
      setPaso(2);
      return;
    }
    setPaso(0);
    tiempos.current = [window.setTimeout(() => setPaso(1), 450), window.setTimeout(() => setPaso(2), 2100)];
  }

  useEffect(() => {
    setMontado(true);
    viajar();
    const alTeclear = (e: KeyboardEvent) => e.key === "Escape" && onVolver();
    window.addEventListener("keydown", alTeclear);
    return () => {
      tiempos.current.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("keydown", alTeclear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!montado) return null;
  const transformacion = paso === 0 ? camara.general : paso === 1 ? camara.mueble : camara.lugar;

  return createPortal(
    <div className={`vg${paso === 2 ? " listo" : ""}`} role="dialog" aria-modal="true" aria-label={`${t.llevamos} ${nombre}`} onClick={(e) => e.stopPropagation()}>
      <div className="vg-arriba">
        <b>
          {t.llevamos} {nombre}
        </b>
        <button type="button" onClick={onVolver}>
          {t.volver}
        </button>
      </div>
      <div className="vg-camara">
        <div
          className={`vg-escena paso${paso}`}
          style={{ width: camara.anchoEscena, height: camara.altoEscena, marginLeft: -camara.anchoEscena / 2, marginTop: -camara.altoEscena / 2, transform: transformacion }}
        >
          <div className="vg-pared">
            {gondola.map((m, i) => (
              <div key={m.id} className={`vg-mod${i === indice ? " foco" : ""}`} style={{ width: ANCHO_MUEBLE, marginLeft: SEPARACION / 2, marginRight: SEPARACION / 2 }}>
                <div className="vg-cartel">
                  <b>{m.titulo}</b>
                  {m.subtitulo && <span>{m.subtitulo}</span>}
                </div>
                <div className="vg-mueble" style={{ height: ALTO_MUEBLE }}>
                  {m.filas.map((f, r) => (
                    <div key={r} className="vg-fila" style={{ flexGrow: f.grande ? 2 : 1 }}>
                      {Array.from({ length: f.lugares }, (_, c) => {
                        const lugar = m.lugares.find((l) => l.fila === r && l.columna === c);
                        const esEste = i === indice && r === fila && c === columna;
                        if (esEste) {
                          return (
                            <span key={c} className="vg-bolsa vg-objetivo">
                              {imagen ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={imagen} alt="" />
                              ) : (
                                <i style={{ background: colorDeProducto(nombre) }} />
                              )}
                              <span className="vg-anillo" />
                              <span className="vg-pin">{t.aca}</span>
                            </span>
                          );
                        }
                        return lugar ? (
                          <span key={c} className="vg-bolsa">
                            <i style={{ background: colorDeProducto(lugar.nombre) }} />
                          </span>
                        ) : (
                          <span key={c} className="vg-bolsa vacio" />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="vg-indic">
        <span className="vg-n">{numero}</span>
        <div className="vg-texto">
          <b>
            {t.mueble} {numero} «{modulo.titulo}» · {t.fila[altura].toLowerCase()}, {t.lugar(columna + 1).toLowerCase()}
          </b>
          <div className="vg-pasos">
            <span>
              1 · {t.cartel} «{modulo.titulo}»{idioma === "es" ? ` (${textoPosicionModulo(numero, gondola.length).toLowerCase()})` : ""}
            </span>
            <span>2 · {t.fila[altura]}</span>
            <span>3 · {t.lugar(columna + 1)}</span>
          </div>
        </div>
        <button type="button" onClick={viajar}>
          {t.otraVez}
        </button>
      </div>
    </div>,
    document.body
  );
}
