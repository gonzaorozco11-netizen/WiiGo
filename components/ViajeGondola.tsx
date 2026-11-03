"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { colorDeProducto, soloModulos, textoPosicionModulo, type ModuloGondola, type UbicacionGondola } from "@/lib/gondola";
import "./viajeGondola.css";

// "¿Dónde lo encuentro?": un viaje por el local entero (Gonzalo, 2026-11-03;
// vista previa aprobada: https://claude.ai/artifact/52HZ42KLTw5JtPSWfyVU3V).
//
// El local como es: los módulos de ganchos en la pared izquierda (con sus
// bolsas kraft, portaprecios, marco verde y luz cálida), las dos islas de
// roble en el centro (3 pisos, productos de los dos lados) y la estantería de
// Animalfit en la pared derecha. Cada producto está dibujado donde se ubicó en
// Precios → Góndola.
//
// El viaje: arranca en la entrada, camina por el pasillo que corresponde (por
// el medio están las islas), gira hacia el mueble y el producto sale apenas de
// su lugar. Ahí todo se oscurece un poco menos un círculo de luz en el
// producto, con el «¡Acá está!» encima: va por arriba de la escena, así ningún
// caño ni estante lo tapa.
//
// Para la all-in-one del local (placa Android floja):
// - solo se anima `transform` y `opacity`; nada de desenfoques ni will-change
//   (con will-change la escena se congela y al acercarse se ve borrosa);
// - el piso, las paredes y el techo son colores lisos (los dibuja sin costo);
// - los productos de cada estante van todos en una sola capa plana;
// - lo que queda a la espalda de la cámara se esconde;
// - va en un portal al <body>: la ficha del producto tiene su propio transform.
//
// Medidas: 3 px = 1 cm.

type Idioma = "es" | "en" | "pt";

const ANCHO = 1560; // de pared a pared
const FONDO = -2850; // de la puerta a la pared del fondo
const Y_OJO = -495; // los ojos, a 1,65 m
const FOCO = 760; // la perspectiva de la cámara
const MOD = { z0: -780, paso: 304, ancho: 300, alacena: 70, zona: 380, alto: 570 };
const ISLA = { x: 780, ancho: 210, alto: 210, estantes: [-456, -336], largo: 750, z0s: [-900, -1800] };
const AF = { z0: -900, largo: 1300, alto: 700, fondo: 90 };
const Z_BOLSA = -62;

const TXT = {
  es: {
    llevamos: "Te llevamos hasta", volver: "Volver al producto", otraVez: "Ver de nuevo", aca: "¡Acá está!", mueble: "Mueble", cartel: "Buscá el cartel", isla: "Isla", elLocal: "El local",
    fila: { arriba: "Fila de arriba", ojos: "A la altura de los ojos", manos: "Fila del medio", abajo: "Fila de abajo" },
    pisos: ["Piso de arriba", "Piso del medio", "Piso de abajo"],
    estante: (n: number) => `Estante ${n} desde abajo`,
    lugar: (n: number) => (n === 1 ? "El primero de la izquierda" : `El ${n}.º desde la izquierda`),
    lado: { IZQ: "lado de los módulos", DER: "lado de Animalfit" },
    posIsla: (n: number) => (n === 1 ? "la primera desde la entrada" : "la del fondo"),
    caminaIsla: (n: number, pos: string) => `Caminá hasta la isla ${n}, ${pos}`,
    delLado: (l: string) => `Del ${l}`,
    aLaDerecha: "a la derecha",
    mapa: { modulos: "módulos", islas: "islas", entrada: "entrada" },
  },
  en: {
    llevamos: "Let's find", volver: "Back to the product", otraVez: "Show again", aca: "Here it is!", mueble: "Shelf", cartel: "Look for the sign", isla: "Island", elLocal: "The store",
    fila: { arriba: "Top row", ojos: "Eye level", manos: "Middle row", abajo: "Bottom row" },
    pisos: ["Top level", "Middle level", "Bottom level"],
    estante: (n: number) => `Shelf ${n} from the bottom`,
    lugar: (n: number) => (n === 1 ? "First from the left" : `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"} from the left`),
    lado: { IZQ: "side facing the wall shelves", DER: "side facing Animalfit" },
    posIsla: (n: number) => (n === 1 ? "the one by the entrance" : "the one at the back"),
    caminaIsla: (n: number, pos: string) => `Walk to island ${n}, ${pos}`,
    delLado: (l: string) => `On the ${l}`,
    aLaDerecha: "on the right",
    mapa: { modulos: "shelves", islas: "islands", entrada: "entrance" },
  },
  pt: {
    llevamos: "Vamos até", volver: "Voltar ao produto", otraVez: "Ver de novo", aca: "Está aqui!", mueble: "Móvel", cartel: "Procure a placa", isla: "Ilha", elLocal: "A loja",
    fila: { arriba: "Fileira de cima", ojos: "Altura dos olhos", manos: "Fileira do meio", abajo: "Fileira de baixo" },
    pisos: ["Nível de cima", "Nível do meio", "Nível de baixo"],
    estante: (n: number) => `Prateleira ${n} de baixo para cima`,
    lugar: (n: number) => (n === 1 ? "O primeiro da esquerda" : `O ${n}º da esquerda`),
    lado: { IZQ: "lado dos móveis", DER: "lado da Animalfit" },
    posIsla: (n: number) => (n === 1 ? "a da entrada" : "a do fundo"),
    caminaIsla: (n: number, pos: string) => `Vá até a ilha ${n}, ${pos}`,
    delLado: (l: string) => `No ${l}`,
    aLaDerecha: "à direita",
    mapa: { modulos: "móveis", islas: "ilhas", entrada: "entrada" },
  },
};

/** Dónde va cada fila de ganchos de un módulo y qué tamaño tiene cada bolsa. */
function medirFilas(modulo: ModuloGondola) {
  const pesos = modulo.filas.map((f) => (f.grande ? 1.6 : 1));
  const total = pesos.reduce((a, b) => a + b, 0) || 1;
  const unidad = (MOD.zona - 26 - 8) / total;
  let acum = 0;
  return modulo.filas.map((f, i) => {
    const y = MOD.alacena + 26 + acum * unidad;
    const alto = pesos[i] * unidad;
    acum += pesos[i];
    const lugares = Math.max(1, f.lugares);
    const paso = (MOD.ancho - 24) / lugares;
    let bolsaAlto = Math.min(f.grande ? 84 : 62, alto - 16);
    let bolsaAncho = bolsaAlto * 0.7;
    if (bolsaAncho > paso - 6) {
      bolsaAncho = paso - 6;
      bolsaAlto = bolsaAncho / 0.7;
    }
    return { y, lugares, paso, bolsaAlto, bolsaAncho };
  });
}

/** La altura (y) de cada fila de una isla: estante de arriba, del medio y la tapa del mueble bajo. */
function pisoIsla(fila: number) {
  return [ISLA.estantes[0], ISLA.estantes[1], -ISLA.alto][fila] ?? -ISLA.alto;
}
/** La altura (y) de cada estante de Animalfit; la fila 0 es la de arriba. */
function estanteAF(fila: number, filas: number) {
  const s = filas - 1 - fila; // 0 = el de abajo
  return -40 - s * ((AF.alto - 90) / Math.max(1, filas - 1));
}
const bahiaAF = (AF.largo - 40) / 2;
/** La parte 1 (adelante) es la más cerca de la puerta; en la escena es la de la derecha del frente. */
const xBahia = (numero: number | null) => (numero === 2 ? 0 : bahiaAF + 40);

/** La forma del producto en una isla o en la estantería: siempre la misma para el mismo nombre. */
function forma(nombre: string, zona: "isla" | "af") {
  let h = 0;
  for (const ch of nombre) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  if (zona === "af") return h % 3 === 0 ? "sobre" : "pote";
  return (["frasco", "doy", "frasco", "pote"] as const)[h % 4];
}
const ANCHO_FORMA = { frasco: 34, doy: 38, pote: 46, sobre: 46 } as const;

type Camara = { x: number; y: number; z: number; yaw: number; pitch: number };
function pose(c: Camara) {
  // El translateZ del principio pone el ojo justo donde está la cámara: sin él,
  // la pared que queda atrás termina tapando todo.
  return `translateZ(${FOCO}px) rotateX(${c.pitch.toFixed(2)}deg) rotateY(${c.yaw}deg) translate3d(${(-c.x).toFixed(1)}px,${(-c.y).toFixed(1)}px,${(-c.z).toFixed(1)}px)`;
}
/** Inclinación para mirar un punto: negativa = mirar hacia abajo. Apunta un poco más abajo para que el producto quede arriba del cartel de los pasos. */
function mirar(camY: number, objY: number, distancia: number) {
  return (-Math.atan2(objY + 70 - camY, distancia) * 180) / Math.PI;
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
  const { modulo: zona, fila, columna } = ubicacion;
  const modulos = useMemo(() => soloModulos(gondola), [gondola]);
  const islas = useMemo(() => gondola.filter((m) => m.tipo === "ISLA"), [gondola]);
  const estanteria = useMemo(() => gondola.filter((m) => m.tipo === "ESTANTERIA"), [gondola]);
  const filasModulos = useMemo(() => modulos.map(medirFilas), [modulos]);
  const [paso, setPaso] = useState<0 | 1 | 2>(0);
  const [salto, setSalto] = useState(false);
  const [foco, setFoco] = useState<{ x: number; y: number; tam: number } | null>(null);
  const [montado, setMontado] = useState(false);
  const tiempos = useRef<number[]>([]);
  const raiz = useRef<HTMLDivElement>(null);
  const objetivo = useRef<HTMLDivElement>(null);

  // Dónde está el producto en la escena, y desde dónde lo mira la cámara.
  const destino = useMemo(() => {
    if (zona.tipo === "ISLA") {
      const n = zona.numero === 2 ? 1 : 0;
      const z0 = ISLA.z0s[n];
      const lugares = Math.max(1, zona.filas[fila]?.lugares ?? 12);
      const ancho = ISLA.largo / lugares;
      const izq = zona.lado !== "DER";
      const z = izq ? z0 - ISLA.largo + ancho * (columna + 0.5) : z0 - ancho * (columna + 0.5);
      const y = pisoIsla(fila) - 31;
      const cam: Camara = izq ? { x: 150, y: -470, z, yaw: 90, pitch: 0 } : { x: ANCHO - 150, y: -470, z, yaw: -90, pitch: 0 };
      cam.pitch = mirar(cam.y, y, 525);
      return { cam, ocultar: izq ? ["izq"] : ["der"], mapa: [izq ? 52 : 68, n === 0 ? 116 : 64] };
    }
    if (zona.tipo === "ESTANTERIA") {
      const lugares = Math.max(1, zona.filas[fila]?.lugares ?? 12);
      const ancho = bahiaAF / lugares;
      const z = AF.z0 - AF.largo + xBahia(zona.numero) + ancho * (columna + 0.5);
      const y = estanteAF(fila, zona.filas.length) - 31;
      const cam: Camara = { x: 930, y: -480, z, yaw: 90, pitch: 0 };
      cam.pitch = mirar(cam.y, y, 540);
      return { cam, ocultar: ["izq", "islas"], mapa: [108, zona.numero === 2 ? 62 : 96] };
    }
    const i = Math.max(0, modulos.indexOf(zona));
    const f = filasModulos[i]?.[fila];
    const z = MOD.z0 - i * MOD.paso - (12 + (f ? f.paso * (columna + 0.5) : MOD.ancho / 2));
    const y = -MOD.alto + (f ? f.y + 6 + f.bolsaAlto / 2 : 250);
    // Con el producto en las filas de abajo, la cámara no baja tanto: el cartel del mueble tiene que verse.
    const yCam = Math.min(-470, y - 40);
    const cam: Camara = { x: 650, y: yCam, z, yaw: -90, pitch: mirar(yCam, Math.min(y, -MOD.alto + 300), 550) };
    return { cam, ocultar: ["der", "islas"], mapa: [8, 134 - ((i + 0.5) * 100) / Math.max(1, modulos.length)] };
  }, [zona, fila, columna, modulos, filasModulos]);

  const entrada: Camara = { x: ANCHO / 2, y: Y_OJO, z: 650, yaw: 0, pitch: -3 };
  const caminando: Camara = { ...destino.cam, y: Y_OJO, z: destino.cam.z + 260, yaw: 0, pitch: -4 };

  function enfocar() {
    const o = objetivo.current, r0 = raiz.current;
    if (!o || !r0) return;
    const r = o.getBoundingClientRect(), v = r0.getBoundingClientRect();
    setFoco({ x: r.left + r.width / 2 - v.left, y: r.top + r.height / 2 - v.top, tam: Math.max(r.width, r.height) });
  }

  function viajar() {
    tiempos.current.forEach((id) => window.clearTimeout(id));
    setFoco(null);
    const quieto = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (quieto) {
      setPaso(2);
      tiempos.current = [window.setTimeout(enfocar, 300)];
      return;
    }
    // Al repetir, la cámara salta a la entrada sin rebobinar el recorrido.
    setSalto(true);
    setPaso(0);
    tiempos.current = [
      window.setTimeout(() => setSalto(false), 60),
      window.setTimeout(() => setPaso(1), 650),
      window.setTimeout(() => setPaso(2), 1650),
      // Por si el aviso de fin del movimiento no llega (pestaña en segundo plano).
      window.setTimeout(enfocar, 3300),
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
  const camara = paso === 0 ? entrada : paso === 1 ? caminando : destino.cam;
  const oculto = (g: string) => (paso === 2 && destino.ocultar.includes(g) ? " oculto" : "");

  // ---- el producto elegido (sale apenas de su lugar) ----
  const elegido = (ancho: number, alto: number, formaProducto: string, color: string) => (
    <div ref={objetivo} className="vg-obj" style={{ width: ancho, height: alto }}>
      {imagen ? (
        <span className="vg-foto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imagen} alt="" />
        </span>
      ) : (
        <span className={`vg-pr vg-${formaProducto}`} style={{ ["--c" as string]: color, left: 0, bottom: 0 }} />
      )}
    </div>
  );

  // ---- los productos de un estante, en una sola capa ----
  const estante = (m: ModuloGondola | undefined, f: number, largo: number, tipo: "isla" | "af") => {
    if (!m) return null;
    const lugares = Math.max(1, m.filas[f]?.lugares ?? 12);
    const ancho = largo / lugares;
    return m.lugares
      .filter((l) => l.fila === f)
      .map((l) => {
        const fo = forma(l.nombre, tipo);
        const w = ANCHO_FORMA[fo];
        const x = ancho * (l.columna + 0.5) - w / 2;
        const esEste = m.id === zona.id && l.fila === fila && l.columna === columna;
        if (esEste) {
          return (
            <div key={l.columna} className="vg-pos" style={{ left: x, bottom: 0 }}>
              {elegido(w, 60, fo, colorDeProducto(l.nombre))}
            </div>
          );
        }
        return <span key={l.columna} className={`vg-pr vg-${fo}`} style={{ left: x, ["--c" as string]: colorDeProducto(l.nombre) }} />;
      });
  };

  // ---- una isla: mueble bajo con puertas, dos estantes flotantes, postes verdes ----
  const isla = (n: 1 | 2) => {
    const z0 = ISLA.z0s[n - 1];
    const L = ISLA.largo, A = ISLA.ancho, xl = ISLA.x - A / 2, xr = ISLA.x + A / 2;
    const izq = islas.find((m) => m.numero === n && m.lado === "IZQ");
    const der = islas.find((m) => m.numero === n && m.lado === "DER");
    return (
      <div key={n} className="vg-p">
        <div className="vg-c vg-isla-puertas" style={{ width: L, height: ISLA.alto, transform: `translate3d(${xl}px,${-ISLA.alto}px,${z0 - L}px) rotateY(-90deg)` }} />
        <div className="vg-c vg-isla-puertas" style={{ width: L, height: ISLA.alto, transform: `translate3d(${xr}px,${-ISLA.alto}px,${z0}px) rotateY(90deg)` }} />
        <div className="vg-c vg-isla-cabeza" style={{ width: A, height: ISLA.alto, transform: `translate3d(${xl}px,${-ISLA.alto}px,${z0}px)` }} />
        <div className="vg-c vg-isla-tapa" style={{ width: A + 20, height: L + 10, transform: `translate3d(${xl - 10}px,${-ISLA.alto}px,${z0 + 5}px) rotateX(-90deg)` }} />
        {[0.2, 0.8].map((f) => (
          <div key={f} className="vg-c vg-isla-poste" style={{ width: 16, height: -ISLA.estantes[0] - ISLA.alto, transform: `translate3d(${ISLA.x - 8}px,${ISLA.estantes[0]}px,${z0 - L * f}px)` }} />
        ))}
        {ISLA.estantes.map((y) => (
          <div key={y}>
            <div className="vg-c vg-isla-tapa" style={{ width: A + 40, height: L + 30, transform: `translate3d(${xl - 20}px,${y}px,${z0 + 15}px) rotateX(-90deg)` }} />
            <div className="vg-c vg-isla-canto" style={{ width: A + 40, height: 12, transform: `translate3d(${xl - 20}px,${y}px,${z0 + 15}px)` }} />
          </div>
        ))}
        {[0, 1, 2].map((f) => (
          <div key={`i${f}`} className="vg-fila" style={{ width: L, transform: `translate3d(${xl + 22}px,${pisoIsla(f) - 62}px,${z0 - L}px) rotateY(-90deg)` }}>
            {estante(izq, f, L, "isla")}
          </div>
        ))}
        {[0, 1, 2].map((f) => (
          <div key={`d${f}`} className="vg-fila" style={{ width: L, transform: `translate3d(${xr - 22}px,${pisoIsla(f) - 62}px,${z0}px) rotateY(90deg)` }}>
            {estante(der, f, L, "isla")}
          </div>
        ))}
      </div>
    );
  };

  // ---- la estantería de Animalfit: dos partes, columna de roble con LED ----
  const filasAF = Math.max(estanteria[0]?.filas.length ?? 6, 1);
  const ys = Array.from({ length: filasAF }, (_, f) => estanteAF(f, filasAF));

  // ---- textos de abajo ----
  let numero = "";
  let linea = "";
  let pasos: string[] = [];
  if (zona.tipo === "ISLA") {
    const n = zona.numero ?? 1;
    const lado = t.lado[zona.lado === "DER" ? "DER" : "IZQ"];
    numero = `I${n}`;
    linea = `${t.isla} ${n} · ${lado} · ${(t.pisos[fila] ?? "").toLowerCase()}, ${t.lugar(columna + 1).toLowerCase()}`;
    pasos = [`1 · ${t.caminaIsla(n, t.posIsla(n))}`, `2 · ${t.delLado(lado)}`, `3 · ${t.pisos[fila] ?? ""}, ${t.lugar(columna + 1).toLowerCase()}`];
  } else if (zona.tipo === "ESTANTERIA") {
    const est = t.estante(zona.filas.length - fila);
    numero = "E";
    linea = `${zona.titulo} · ${(zona.subtitulo ?? "").toLowerCase()} · ${est.toLowerCase()}, ${t.lugar(columna + 1).toLowerCase()}`;
    pasos = [`1 · ${zona.titulo}, ${t.aLaDerecha}`, `2 · ${zona.subtitulo ?? ""}`, `3 · ${est}, ${t.lugar(columna + 1).toLowerCase()}`];
  } else {
    const n = modulos.indexOf(zona) + 1;
    const altura = zona.filas[fila]?.altura ?? "manos";
    numero = String(n);
    linea = `${t.mueble} ${n} «${zona.titulo}» · ${t.fila[altura].toLowerCase()}, ${t.lugar(columna + 1).toLowerCase()}`;
    pasos = [
      `1 · ${t.cartel} «${zona.titulo}»${idioma === "es" ? ` (${textoPosicionModulo(n, modulos.length).toLowerCase()})` : ""}`,
      `2 · ${t.fila[altura]}`,
      `3 · ${t.lugar(columna + 1)}`,
    ];
  }

  const varsFoco = foco
    ? ({ ["--x" as string]: `${foco.x}px`, ["--y" as string]: `${foco.y}px`, ["--r" as string]: `${Math.max(130, foco.tam * 2.4)}px`, ["--d" as string]: `${Math.max(70, foco.tam * 1.5)}px`, ["--pin-y" as string]: `${foco.y - foco.tam * 0.75 - 14}px` } as React.CSSProperties)
    : undefined;

  return createPortal(
    <div
      ref={raiz}
      className={`vg${paso === 2 ? " listo" : ""}${foco ? " foco-on" : ""}`}
      style={varsFoco}
      role="dialog"
      aria-modal="true"
      aria-label={`${t.llevamos} ${nombre}`}
      onClick={(e) => e.stopPropagation()}
    >
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
          style={{ transform: pose(camara) }}
          onTransitionEnd={(e) => {
            if (e.target === e.currentTarget && e.propertyName === "transform" && paso === 2) tiempos.current.push(window.setTimeout(enfocar, 700));
          }}
        >
          {/* El local: colores lisos, que la placa dibuja sin costo */}
          <div className="vg-c vg-piso" style={{ width: ANCHO, height: -FONDO, transform: "rotateX(-90deg)" }}>
            {Array.from({ length: 8 }, (_, k) => (
              <i key={`l${k}`} style={{ left: (k + 1) * (ANCHO / 9), top: 0, width: 3, height: "100%" }} />
            ))}
            {Array.from({ length: 15 }, (_, k) => (
              <i key={`t${k}`} style={{ top: (k + 1) * 180, left: 0, height: 3, width: "100%" }} />
            ))}
          </div>
          <div className="vg-c vg-techo" style={{ width: ANCHO, height: -FONDO, transform: "translate3d(0,-900px,0) rotateX(-90deg)" }} />
          <div className="vg-c vg-fondo" style={{ width: ANCHO, height: 900, transform: `translate3d(0,-900px,${FONDO}px)` }} />
          <div className="vg-c vg-tele" style={{ width: 450, height: 255, transform: `translate3d(${ANCHO / 2 - 225}px,-700px,${FONDO + 2}px)` }} />

          {/* Pared izquierda: los módulos de ganchos */}
          <div className={`vg-grupo${oculto("izq")}`}>
            <div className="vg-c vg-pared" style={{ width: -FONDO, height: 900, transform: "translate3d(0,-900px,0) rotateY(90deg)" }} />
            {modulos.map((m, i) => {
              const filas = filasModulos[i];
              const esFoco = m.id === zona.id;
              return (
                <div key={m.id} className={`vg-mb${esFoco ? " foco" : ""}`} style={{ transform: `translate3d(100px,${-MOD.alto}px,${MOD.z0 - i * MOD.paso}px) rotateY(90deg)` }}>
                  <div className="vg-c vg-ranurado" />
                  <div className="vg-c vg-estante" />
                  <div className="vg-c vg-alacena-bajo" />
                  <div className="vg-c vg-led" />
                  <div className="vg-c vg-halo" />
                  {filas.map((f, r) => (
                    <div key={`g${r}`} className="vg-c vg-ganchos" style={{ top: f.y }}>
                      {Array.from({ length: f.lugares }, (_, c) => (
                        <i key={c} style={{ left: 12 + f.paso * (c + 0.5) - 1.5 }} />
                      ))}
                    </div>
                  ))}
                  {[1, 0].map((capa) => (
                    <div key={`b${capa}`} className="vg-c vg-capa" style={{ transform: `translateZ(${Z_BOLSA - capa * 9}px)` }}>
                      {filas.map((f, r) =>
                        Array.from({ length: f.lugares }, (_, c) => {
                          const lugar = m.lugares.find((l) => l.fila === r && l.columna === c);
                          if (!lugar) return null;
                          if (capa === 0 && esFoco && r === fila && c === columna) return null;
                          return (
                            <span key={`${r}-${c}`} className="vg-bolsa" style={{ left: 12 + f.paso * (c + 0.5) - f.bolsaAncho / 2, top: f.y + 6 - capa * 2, width: f.bolsaAncho, height: f.bolsaAlto }}>
                              <i style={{ background: colorDeProducto(lugar.nombre) }} />
                            </span>
                          );
                        })
                      )}
                    </div>
                  ))}
                  <div className="vg-c vg-capa vg-portas">
                    {filas.map((f, r) =>
                      Array.from({ length: f.lugares }, (_, c) => <i key={`${r}-${c}`} style={{ left: 12 + f.paso * (c + 0.5) - 14, top: f.y - 16 }} />)
                    )}
                  </div>
                  {esFoco && filas[fila] && (
                    <div
                      className="vg-pos"
                      style={{
                        left: 12 + filas[fila].paso * (columna + 0.5) - filas[fila].bolsaAncho / 2,
                        top: filas[fila].y + 6,
                        transform: `translateZ(${Z_BOLSA}px)`,
                      }}
                    >
                      {imagen ? (
                        elegido(filas[fila].bolsaAncho, filas[fila].bolsaAlto, "doy", colorDeProducto(nombre))
                      ) : (
                        <div ref={objetivo} className="vg-obj" style={{ width: filas[fila].bolsaAncho, height: filas[fila].bolsaAlto }}>
                          <span className="vg-bolsa" style={{ left: 0, top: 0, width: "100%", height: "100%" }}>
                            <i style={{ background: colorDeProducto(nombre) }} />
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="vg-c vg-marco-lado i" />
                  <div className="vg-c vg-marco-lado d" />
                  <div className="vg-c vg-poste i" />
                  <div className="vg-c vg-poste d" />
                  <div className="vg-c vg-bajo-tapa" />
                  <div className="vg-c vg-bajo" />
                  <div className="vg-c vg-alacena">
                    <b>{m.titulo}</b>
                    {m.subtitulo && <span>{m.subtitulo}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Centro: las dos islas */}
          <div className={`vg-grupo${oculto("islas")}`}>
            {isla(1)}
            {isla(2)}
          </div>

          {/* Pared derecha: la estantería de Animalfit */}
          <div className={`vg-grupo${oculto("der")}`}>
            <div className="vg-c vg-pared" style={{ width: -FONDO, height: 900, transform: `translate3d(${ANCHO}px,-900px,${FONDO}px) rotateY(-90deg)` }} />
            <div className="vg-p" style={{ transform: `translate3d(${ANCHO}px,0,${AF.z0 - AF.largo}px) rotateY(-90deg)` }}>
              <div className="vg-c vg-af-marco" style={{ left: -40, top: -AF.alto - 60, width: AF.largo + 80, height: AF.alto + 60, transform: "translateZ(1px)" }} />
              <div className="vg-c vg-af-hueco" style={{ left: 0, top: -AF.alto - 30, width: AF.largo, height: AF.alto, transform: "translateZ(2px)" }} />
              <div className="vg-c vg-af-cartel" style={{ left: 0, top: -AF.alto - 260, width: AF.largo, height: 160, transform: "translateZ(2px)" }}>
                <b>{(estanteria[0]?.titulo ?? "Animalfit").replace(/^Estanter[ií]a\s*/i, "").toUpperCase()}</b>
                <span>SUPLEMENTOS ——</span>
              </div>
              <div className="vg-c vg-af-led" style={{ left: 40, top: -AF.alto - 24, width: AF.largo - 80, height: 8, transform: "translateZ(4px)" }} />
              {[2, 1].map((parte) => {
                const m = estanteria.find((x) => x.numero === parte);
                const x0 = xBahia(parte);
                return (
                  <div key={parte}>
                    {ys.map((y, f) => (
                      <div key={f}>
                        <div className="vg-c vg-af-estante" style={{ left: x0, top: y, width: bahiaAF, height: AF.fondo }} />
                        <div className="vg-c vg-af-canto" style={{ left: x0, top: y, width: bahiaAF, height: 10, transform: `translateZ(${AF.fondo}px)` }} />
                        <div className="vg-fila" style={{ left: x0, top: y - 62, width: bahiaAF, transform: `translateZ(${AF.fondo - 30}px)` }}>
                          {estante(m, f, bahiaAF, "af")}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div className="vg-c vg-af-col" style={{ left: bahiaAF, top: -AF.alto - 30, width: 40, height: AF.alto, transform: `translateZ(${AF.fondo}px)` }} />
              <div className="vg-c vg-af-led" style={{ left: bahiaAF - 3, top: -AF.alto - 20, width: 4, height: AF.alto - 20, transform: `translateZ(${AF.fondo + 1}px)` }} />
              <div className="vg-c vg-af-led" style={{ left: bahiaAF + 39, top: -AF.alto - 20, width: 4, height: AF.alto - 20, transform: `translateZ(${AF.fondo + 1}px)` }} />
            </div>
          </div>
        </div>
      </div>

      {/* El foco de luz, el anillo y el cartel: por encima de la escena */}
      <div className="vg-foco" aria-hidden="true" />
      <span className="vg-anillo2d" aria-hidden="true" />
      <div className="vg-pin2d">{t.aca}</div>

      <div className="vg-indic">
        <span className="vg-n">{numero}</span>
        <div className="vg-texto">
          <b>{linea}</b>
          <div className="vg-pasos">
            {pasos.map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
        </div>
        <button type="button" onClick={viajar}>
          {t.otraVez}
        </button>
      </div>

      {/* El mapita del local, con el punto donde está */}
      <div className="vg-planta" aria-hidden="true">
        <b>{t.elLocal}</b>
        <svg viewBox="0 0 120 170">
          <rect x="1" y="1" width="118" height="168" rx="6" fill="#fff" stroke="#e8dfcd" />
          <rect x="3" y="34" width="10" height="100" rx="2" fill="#a3c19b" />
          <text x="9" y="26" fontSize="8" textAnchor="middle" fill="#857f6f">
            {t.mapa.modulos}
          </text>
          <rect x="52" y="44" width="16" height="40" rx="2" fill="#dcc6a3" />
          <rect x="52" y="96" width="16" height="40" rx="2" fill="#dcc6a3" />
          <text x="60" y="38" fontSize="8" textAnchor="middle" fill="#857f6f">
            {t.mapa.islas}
          </text>
          <rect x="107" y="44" width="10" height="70" rx="2" fill="#7d8b7e" />
          <text x="60" y="164" fontSize="8" textAnchor="middle" fill="#857f6f">
            {t.mapa.entrada}
          </text>
          <circle cx={destino.mapa[0]} cy={destino.mapa[1]} r="6" fill="#e8743b" stroke="#fff" strokeWidth="2" />
        </svg>
      </div>
    </div>,
    document.body
  );
}
