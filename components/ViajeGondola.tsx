"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { colorDeProducto, textoPosicionModulo, type ModuloGondola, type UbicacionGondola } from "@/lib/gondola";
import "./viajeGondola.css";

// "¿Dónde lo encuentro?" como un viaje por el local (Gonzalo, 2026-11-02;
// vista previa aprobada: https://claude.ai/artifact/5Pi9K6iNc7twd3aCpFt3sU).
//
// Los muebles están copiados de los del local: marco de caño verde, panel
// ranurado blanco con ganchos y portaprecios, bolsas kraft con ventanita,
// mueble bajo de roble, alacena blanca arriba con el nombre del mueble y la
// tira de luz cálida. Tres tomas:
//   1. la pared de costado, como cuando entrás al local;
//   2. de frente al mueble del producto (los demás se apagan);
//   3. cerca del gancho: el producto sale apenas, con borde naranja, un
//      anillo que late y «¡Acá está!». Sale poco a propósito: el cliente
//      tiene que seguir viendo los de al lado para ubicarse.
//
// Hecho para la all-in-one del local (placa Android floja, navegador que
// puede ser viejo):
// - solo se anima `transform` y `opacity`;
// - las bolsas de cada mueble van juntas en unas pocas capas planas (todas
//   las de adelante en una, las de atrás en otra): una capa 3D por bolsa
//   serían 500 capas y la placa no da;
// - nada de desenfoques, `gap` en flex, `inset` ni `aspect-ratio`;
// - va en un portal al <body>: la ficha del producto tiene su propio
//   `transform` y un `position: fixed` adentro quedaría encerrado en ella.

type Idioma = "es" | "en" | "pt";

// Medidas de un mueble, en px antes de la cámara.
const ANCHO = 300;
const SEP = 4;
const ALACENA = 70; // la alacena blanca de arriba
const ZONA = 380; // el panel ranurado con los ganchos
const BAJO = 120; // el mueble de roble
const ARRIBA = 30; // aire arriba de la alacena dentro de la escena
const ALTO_ESCENA = 600;
const Z_BOLSA = -62; // dónde cuelgan las bolsas de adelante
const ZOOM = 1.25;

const TXT = {
  es: { llevamos: "Te llevamos hasta", volver: "Volver al producto", otraVez: "Ver de nuevo", aca: "¡Acá está!", mueble: "Mueble", cartel: "Buscá el cartel", fila: { arriba: "Fila de arriba", ojos: "A la altura de los ojos", manos: "Fila del medio", abajo: "Fila de abajo" }, lugar: (n: number) => (n === 1 ? "El primero de la izquierda" : `El ${n}.º desde la izquierda`) },
  en: { llevamos: "Let's find", volver: "Back to the product", otraVez: "Show again", aca: "Here it is!", mueble: "Shelf", cartel: "Look for the sign", fila: { arriba: "Top row", ojos: "Eye level", manos: "Middle row", abajo: "Bottom row" }, lugar: (n: number) => (n === 1 ? "First from the left" : `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"} from the left`) },
  pt: { llevamos: "Vamos até", volver: "Voltar ao produto", otraVez: "Ver de novo", aca: "Está aqui!", mueble: "Móvel", cartel: "Procure a placa", fila: { arriba: "Fileira de cima", ojos: "Altura dos olhos", manos: "Fileira do meio", abajo: "Fileira de baixo" }, lugar: (n: number) => (n === 1 ? "O primeiro da esquerda" : `O ${n}º da esquerda`) },
};

/** Dónde va cada fila de ganchos y qué tamaño tiene cada bolsa en ella. */
function medirFilas(modulo: ModuloGondola) {
  const pesos = modulo.filas.map((f) => (f.grande ? 1.6 : 1));
  const total = pesos.reduce((a, b) => a + b, 0) || 1;
  const unidad = (ZONA - 26 - 8) / total;
  let acum = 0;
  return modulo.filas.map((f, i) => {
    const y = ALACENA + 26 + acum * unidad; // altura del gancho
    const alto = pesos[i] * unidad;
    acum += pesos[i];
    const lugares = Math.max(1, f.lugares);
    const paso = (ANCHO - 24) / lugares;
    let bolsaAlto = Math.min(f.grande ? 84 : 62, alto - 16);
    let bolsaAncho = bolsaAlto * 0.7;
    if (bolsaAncho > paso - 6) {
      bolsaAncho = paso - 6;
      bolsaAlto = bolsaAncho / 0.7;
    }
    return { y, lugares, paso, bolsaAlto, bolsaAncho };
  });
}

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
  const [salto, setSalto] = useState(false);
  const tiempos = useRef<number[]>([]);

  const filasPorModulo = useMemo(() => gondola.map(medirFilas), [gondola]);

  // Las tres posiciones de la cámara.
  const camara = useMemo(() => {
    const ancho = gondola.length * (ANCHO + SEP);
    const filas = filasPorModulo[indice] ?? [];
    const f = filas[fila];
    const izquierda = indice * (ANCHO + SEP);
    const centroMueble = izquierda + ANCHO / 2 - ancho / 2;
    const x = izquierda + 12 + (f ? f.paso * (columna + 0.5) : ANCHO / 2) - ancho / 2;
    const y = ARRIBA + (f ? f.y + 6 + f.bolsaAlto / 2 : ALACENA + ZONA / 2) - ALTO_ESCENA / 2;
    return {
      ancho,
      // Mirando la pared de costado, con el primer mueble cerca, como al entrar.
      pared: `rotateX(3deg) rotateY(56deg) translate3d(${(ancho / 2 - 360).toFixed(0)}px, 20px, 60px)`,
      mueble: `rotateX(5deg) rotateY(-12deg) translate3d(${(-centroMueble).toFixed(1)}px, 20px, -120px)`,
      lugar: `rotateX(3deg) rotateY(0deg) translate3d(${(-x * ZOOM).toFixed(1)}px, ${(-y * ZOOM + 10).toFixed(1)}px, 40px) scale(${ZOOM})`,
    };
  }, [gondola.length, filasPorModulo, indice, fila, columna]);

  function viajar() {
    tiempos.current.forEach((id) => window.clearTimeout(id));
    const quieto = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (quieto) {
      setPaso(2);
      return;
    }
    // Al repetir, la cámara salta a la pared sin rebobinar el recorrido.
    setSalto(true);
    setPaso(0);
    tiempos.current = [
      window.setTimeout(() => setSalto(false), 60),
      window.setTimeout(() => setPaso(1), 1300),
      window.setTimeout(() => setPaso(2), 2700),
    ];
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
  const transformacion = paso === 0 ? camara.pared : paso === 1 ? camara.mueble : camara.lugar;
  const filaElegida = filasPorModulo[indice]?.[fila];

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
          className={`vg-escena paso${paso}${salto ? " salto" : ""}`}
          style={{ width: camara.ancho, height: ALTO_ESCENA, marginLeft: -camara.ancho / 2, marginTop: -ALTO_ESCENA / 2, transform: transformacion }}
        >
          <div className="vg-c vg-pared" />
          <div className="vg-c vg-piso" />
          {gondola.map((m, i) => {
            const filas = filasPorModulo[i];
            const esFoco = i === indice;
            return (
              <div key={m.id} className={`vg-mb${esFoco ? " foco" : ""}`} style={{ left: i * (ANCHO + SEP), top: ARRIBA }}>
                <div className="vg-c vg-ranurado" />
                <div className="vg-c vg-estante" />
                <div className="vg-c vg-alacena-bajo" />
                <div className="vg-c vg-led" />
                <div className="vg-c vg-halo" />

                {/* Los ganchos: una capa por fila, saliendo de la pared. */}
                {filas.map((f, r) => (
                  <div key={`g${r}`} className="vg-c vg-ganchos" style={{ top: f.y }}>
                    {Array.from({ length: f.lugares }, (_, c) => (
                      <i key={c} style={{ left: 12 + f.paso * (c + 0.5) - 1.5 }} />
                    ))}
                  </div>
                ))}

                {/* Las bolsas de atrás (la pila) y las de adelante: una capa cada una. */}
                {[1, 0].map((capa) => (
                  <div key={`b${capa}`} className="vg-c vg-capa" style={{ transform: `translateZ(${Z_BOLSA - capa * 9}px)` }}>
                    {filas.map((f, r) =>
                      Array.from({ length: f.lugares }, (_, c) => {
                        const lugar = m.lugares.find((l) => l.fila === r && l.columna === c);
                        if (!lugar) return null;
                        if (capa === 0 && esFoco && r === fila && c === columna) return null;
                        return (
                          <span
                            key={`${r}-${c}`}
                            className="vg-bolsa"
                            style={{ left: 12 + f.paso * (c + 0.5) - f.bolsaAncho / 2, top: f.y + 6 - capa * 2, width: f.bolsaAncho, height: f.bolsaAlto }}
                          >
                            <i style={{ background: colorDeProducto(lugar.nombre) }} />
                          </span>
                        );
                      })
                    )}
                  </div>
                ))}

                {/* Los portaprecios, en la punta de cada gancho. */}
                <div className="vg-c vg-capa vg-portas">
                  {filas.map((f, r) =>
                    Array.from({ length: f.lugares }, (_, c) => (
                      <i key={`${r}-${c}`} style={{ left: 12 + f.paso * (c + 0.5) - 14, top: f.y - 16 }} />
                    ))
                  )}
                </div>

                {esFoco && filaElegida && (
                  <div
                    className="vg-c vg-pos"
                    style={{
                      left: 12 + filaElegida.paso * (columna + 0.5) - filaElegida.bolsaAncho / 2,
                      top: filaElegida.y + 6,
                      width: filaElegida.bolsaAncho,
                      height: filaElegida.bolsaAlto,
                    }}
                  >
                    <div className="vg-obj">
                      <div className="vg-flota">
                        <span className="vg-anillo" />
                        {imagen ? (
                          <span className="vg-bolsa vg-foto">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={imagen} alt="" />
                          </span>
                        ) : (
                          <span className="vg-bolsa">
                            <i style={{ background: colorDeProducto(nombre) }} />
                          </span>
                        )}
                        {/* En la fila de arriba el cartel va abajo de la bolsa
                            (arriba lo taparía la alacena), y en las puntas se
                            corre hacia adentro (afuera lo taparía el marco). */}
                        <span
                          className={`vg-pin${fila === 0 ? " abajo" : ""}${columna === 0 ? " izq" : columna === filaElegida.lugares - 1 ? " der" : ""}`}
                        >
                          {t.aca}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="vg-c vg-marco-lado i" />
                <div className="vg-c vg-marco-lado d" />
                <div className="vg-c vg-poste i" />
                <div className="vg-c vg-poste d" />
                <div className="vg-c vg-bajo-tapa" />
                <div className="vg-c vg-bajo-lado" />
                <div className="vg-c vg-bajo" />
                <div className="vg-c vg-alacena">
                  <b>{m.titulo}</b>
                  {m.subtitulo && <span>{m.subtitulo}</span>}
                </div>
                <div className="vg-c vg-velo" />
              </div>
            );
          })}
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
