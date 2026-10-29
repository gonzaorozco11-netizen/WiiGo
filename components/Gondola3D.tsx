"use client";

import type { CSSProperties } from "react";
import { colorDeProducto, NOMBRE_ALTURA, type ModuloGondola } from "@/lib/gondola";
import "./gondola3d.css";

// La góndola del local en 3D: la pared de módulos (girada, con profundidad) y
// un mueble de frente con cada lugar. La usan Precios → Góndola (para ubicar)
// y la ficha del producto de la pantalla asesora (para mostrar dónde está).

type Aca = { idModulo: string; fila: number; columna: number } | null;

function lugarEn(m: ModuloGondola, fila: number, columna: number) {
  return m.lugares.find((l) => l.fila === fila && l.columna === columna) ?? null;
}

/** Los módulos uno al lado del otro, de izquierda a derecha, en perspectiva. */
export function Pared3D({
  modulos,
  sel,
  aca = null,
  onElegir,
  foco = false,
}: {
  modulos: ModuloGondola[];
  sel: string | null;
  aca?: Aca;
  onElegir?: (idModulo: string) => void;
  foco?: boolean;
}) {
  return (
    <div className="gd">
      <div className="gd-escenario">
        <div className="gd-piso" />
        <div className={`gd-pared3d${foco ? " foco" : ""}`}>
          {modulos.map((m, i) => {
            const clase = `gd-mod3d${m.id === sel ? " sel" : ""}${aca && m.id !== aca.idModulo ? " apagado" : ""}`;
            const contenido = (
              <>
                <span className="gd-cara gd-frente">
                  <span className="gd-f-franja">
                    <span className="gd-f-cartel">
                      {m.titulo}
                      {m.subtitulo && <small>{m.subtitulo}</small>}
                    </span>
                  </span>
                  <span className="gd-f-pared">
                    {m.filas.map((f, fi) => (
                      <span key={fi} className={`gd-f-fila${f.grande ? " grande" : ""}`} style={{ gridTemplateColumns: `repeat(${f.lugares}, 1fr)` }}>
                        {Array.from({ length: f.lugares }, (_, ci) => {
                          const l = lugarEn(m, fi, ci);
                          const esAca = aca && aca.idModulo === m.id && aca.fila === fi && aca.columna === ci;
                          return (
                            <i
                              key={ci}
                              className={`${l ? "" : "vacio"}${esAca ? " aca" : ""}`}
                              style={{ "--r": l ? colorDeProducto(l.nombre) : "transparent" } as CSSProperties}
                            />
                          );
                        })}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="gd-cara gd-lado" />
                <span className="gd-cara gd-techo" />
                <span className="gd-num3d">
                  {i + 1}
                  {i === 0 ? " · izq." : i === modulos.length - 1 ? " · der." : ""}
                </span>
              </>
            );
            return onElegir ? (
              <button key={m.id} type="button" className={clase} onClick={() => onElegir(m.id)} aria-label={`Módulo ${i + 1}, ${m.titulo}`} aria-pressed={m.id === sel}>
                {contenido}
              </button>
            ) : (
              <div key={m.id} className={clase} role="img" aria-label={`Módulo ${i + 1}, ${m.titulo}`}>
                {contenido}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Un módulo de frente, fila por fila. Con onLugar, cada lugar se puede tocar. */
export function MuebleFrente({
  modulo,
  numero,
  elegido = null,
  aca = null,
  textoAca = "¡Acá está!",
  onLugar,
}: {
  modulo: ModuloGondola;
  numero: number;
  elegido?: { fila: number; columna: number } | null;
  aca?: { fila: number; columna: number } | null;
  textoAca?: string;
  onLugar?: (fila: number, columna: number) => void;
}) {
  return (
    <div className="gd">
      <div className="gd-escena">
        <div className="gd-mueble" role={onLugar ? undefined : "img"} aria-label={`Módulo ${numero} de frente`}>
          <div className="gd-franja">
            <div className="gd-cartel">
              {modulo.titulo}
              <small>
                Módulo {numero}
                {modulo.subtitulo ? ` · ${modulo.subtitulo}` : ""}
              </small>
            </div>
          </div>
          <div className="gd-pared">
            {modulo.filas.map((f, fi) => (
              <div key={fi} className={`gd-fila${f.grande ? " grande" : ""}`} style={{ gridTemplateColumns: `66px repeat(${f.lugares}, minmax(0, 1fr))` }}>
                <div className={`gd-altura ${f.altura}`}>
                  <span>{NOMBRE_ALTURA[f.altura]}</span>
                </div>
                {Array.from({ length: f.lugares }, (_, ci) => {
                  const l = lugarEn(modulo, fi, ci);
                  const esElegido = elegido?.fila === fi && elegido?.columna === ci;
                  const esAca = aca?.fila === fi && aca?.columna === ci;
                  const clase = `gd-gancho${l ? "" : " vacio"}${esElegido ? " elegido" : ""}${esAca ? " aca" : aca ? " atenuado" : ""}`;
                  const adentro = (
                    <>
                      <span className="gd-porta">{l ? l.nombre : "Libre"}</span>
                      <span className="gd-bolsa" style={{ "--relleno": l ? colorDeProducto(l.nombre) : "transparent" } as CSSProperties}>
                        {l ? <i className="gd-ventana" /> : <span>+</span>}
                      </span>
                    </>
                  );
                  return onLugar ? (
                    <button
                      key={ci}
                      type="button"
                      className={clase}
                      onClick={() => onLugar(fi, ci)}
                      aria-label={`${l ? l.nombre : "Lugar libre"}, fila ${NOMBRE_ALTURA[f.altura].toLowerCase()}, lugar ${ci + 1}`}
                    >
                      {adentro}
                    </button>
                  ) : (
                    <div key={ci} className={clase} data-aca={esAca ? textoAca : undefined}>
                      {adentro}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
