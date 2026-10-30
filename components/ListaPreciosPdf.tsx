"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { WIIGO_LOGO_DATA_URI } from "@/lib/wiigo-logo-data";
import "./listaPrecios.css";

// La lista de precios para clientes, en hojas A4 de dos columnas, cada
// producto con su fotito (Gonzalo, 2026-10-30: la "forma 3"). Se guarda en PDF
// con Imprimir → Guardar como PDF.
//
// Los cortes: antes de armar las hojas se MIDE cada renglón tal como se ve, y
// recién ahí se reparte. Ningún producto queda partido, un título de rubro
// nunca queda solo al pie (va con al menos dos productos), y si un rubro sigue
// en la otra columna se repite su título con "(sigue)".

export type ProductoLista = {
  id: string;
  nombre: string;
  idMarca: string;
  marca: string;
  propia: boolean;
  rubro: string;
  lista: number;
  efectivo: number;
  /** Precio antes de la oferta; null si no está en oferta. */
  antes: number | null;
  descuento: number;
  imagen: string | null;
};

// Lo que va arriba de la primera hoja.
const SUCURSAL = { nombre: "Sucursal 1", direccion: "Arístides Villanueva 256, Mendoza", horario: "9 a 13 h y 17 a 21 h", dias: "Lunes a sábado", instagram: "@wiigo.arg" };

// Cada sección es una marca, con su nombre como título (Gonzalo, 2026-10-30): WiiGo primero, después las demás.
const NOMBRE_RUBRO: Record<string, string> = { "Frutos Secos Nacionales e importados": "Frutos secos", "Avenas y derivados": "Avenas", "Cacaos y chocolates": "Cacao" };
const ORDEN_RUBRO_PROPIO = ["frutos secos", "mix", "frutas", "cereales", "avena", "granola", "cacao"];
const COLORES = ["#a8701d", "#c2603a", "#b8405f", "#5f8a2e", "#8a7a3a", "#7a5bb5", "#6b4430", "#2f7fa8", "#3f7a5a", "#4f6b7a"];

const ICONOS: Record<string, ReactNode> = {
  nuez: (<svg viewBox="0 0 48 48" fill="currentColor"><path d="M24 4c8 6 13 15 13 24 0 9-6 16-13 16S11 37 11 28C11 19 16 10 24 4z" /><path d="M24 9v30" stroke="#fff" strokeWidth="2" opacity=".5" /></svg>),
  mix: (<svg viewBox="0 0 48 48" fill="currentColor"><circle cx="17" cy="20" r="8" /><circle cx="31" cy="18" r="6" opacity=".75" /><ellipse cx="26" cy="32" rx="9" ry="6" opacity=".9" /></svg>),
  fruta: (<svg viewBox="0 0 48 48" fill="none" stroke="currentColor"><circle cx="24" cy="24" r="16" fill="currentColor" fillOpacity=".18" strokeWidth="3" /><path d="M24 8v32M8 24h32M12.7 12.7l22.6 22.6M35.3 12.7 12.7 35.3" strokeWidth="2" opacity=".7" /></svg>),
  cereal: (<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="5"><circle cx="16" cy="18" r="7" /><circle cx="32" cy="22" r="7" opacity=".75" /><circle cx="22" cy="33" r="7" opacity=".55" /></svg>),
  avena: (<svg viewBox="0 0 48 48" fill="currentColor"><ellipse cx="17" cy="19" rx="9" ry="6" transform="rotate(-20 17 19)" /><ellipse cx="31" cy="24" rx="9" ry="6" transform="rotate(15 31 24)" opacity=".75" /><ellipse cx="21" cy="33" rx="9" ry="6" transform="rotate(-5 21 33)" opacity=".55" /></svg>),
  bowl: (<svg viewBox="0 0 48 48" fill="currentColor"><path d="M6 24h36c0 10-8 17-18 17S6 34 6 24z" /><circle cx="16" cy="20" r="3" opacity=".7" /><circle cx="24" cy="18" r="3.5" opacity=".7" /><circle cx="32" cy="20" r="3" opacity=".7" /></svg>),
  cacao: (<svg viewBox="0 0 48 48" fill="currentColor"><path d="M10 18h24v10a12 12 0 0 1-24 0z" /><path d="M34 21h3a5 5 0 0 1 0 10h-3" fill="none" stroke="currentColor" strokeWidth="3" /></svg>),
};
function iconoDe(rubro: string) {
  const r = rubro.toLowerCase();
  if (/mix/.test(r)) return "mix";
  if (/fruto|nuez|almendr/.test(r)) return "nuez";
  if (/fruta|snack/.test(r)) return "fruta";
  if (/avena/.test(r)) return "avena";
  if (/cereal/.test(r)) return "cereal";
  if (/cacao|chocolate/.test(r)) return "cacao";
  return "bowl";
}

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
/** "WHEY JUST x2lbs - STAR NUTRITION" → ["Whey Just x2lbs", "Star Nutrition"]; "Almendra Guara 250 g" → ["Almendra Guara", "250 g"]. */
function partes(nombre: string): [string, string] {
  const n = nombre === nombre.toUpperCase() ? nombre.toLowerCase().replace(/(^|[\s(/-])([a-záéíóúñ])/g, (_, a, b) => a + b.toUpperCase()) : nombre;
  const guion = n.split(/\s+-\s+/);
  if (guion.length > 1) return [guion[0], guion.slice(1).join(" · ")];
  const m = n.match(/^(.*?)\s+(\d+(?:[.,]\d+)?\s*(?:g|kg|gr|ml|cc))$/i);
  return m ? [m[1], m[2]] : [n, ""];
}

type Rubro = { nombre: string; color: string; icono: string };
type Bloque =
  | { tipo: "seccion"; titulo: string; n: number }
  | { tipo: "rubro"; rubro: Rubro; sigue?: boolean }
  | { tipo: "fila"; p: ProductoLista; rubro: Rubro };

function armarBloques(productos: ProductoLista[]): Bloque[] {
  const grupos = new Map<string, ProductoLista[]>();
  for (const p of productos) {
    if (!grupos.has(p.idMarca)) grupos.set(p.idMarca, []);
    grupos.get(p.idMarca)!.push(p);
  }
  const marcas = [...grupos.values()].sort((a, b) => Number(b[0].propia) - Number(a[0].propia) || a[0].marca.localeCompare(b[0].marca));
  const out: Bloque[] = [];
  for (const deSeccion of marcas) {
    out.push({ tipo: "seccion", titulo: deSeccion[0].propia ? "WiiGo" : deSeccion[0].marca, n: deSeccion.length });
    const rubros = [...new Set(deSeccion.map((p) => p.rubro))].sort((a, b) => {
      const pos = (r: string) => { const i = ORDEN_RUBRO_PROPIO.findIndex((x) => (NOMBRE_RUBRO[r] ?? r).toLowerCase().includes(x)); return i < 0 ? 99 : i; };
      return pos(a) - pos(b) || a.localeCompare(b);
    });
    rubros.forEach((r, i) => {
      const rubro: Rubro = { nombre: NOMBRE_RUBRO[r] ?? r, color: COLORES[i % COLORES.length], icono: iconoDe(r) };
      out.push({ tipo: "rubro", rubro });
      for (const p of deSeccion.filter((x) => x.rubro === r)) out.push({ tipo: "fila", p, rubro });
    });
  }
  return out;
}

// Medidas de la hoja A4 a 96 ppp y de sus partes fijas (en px, iguales que en listaPrecios.css).
const ALTO_HOJA = 1123, ALTO_PORTADA = 232, ALTO_CAB = 62, ALTO_PIE = 84, AIRE_ARRIBA = 22, MARGEN_SEGURIDAD = 8;
const DISPONIBLE_PRIMERA = ALTO_HOJA - ALTO_PORTADA - ALTO_PIE - AIRE_ARRIBA - MARGEN_SEGURIDAD;
const DISPONIBLE_RESTO = ALTO_HOJA - ALTO_CAB - ALTO_PIE - AIRE_ARRIBA - MARGEN_SEGURIDAD;

/** Una hoja: el título de la marca (a todo el ancho, si la marca arranca acá) y las dos columnas. */
type Hoja = { marca: Extract<Bloque, { tipo: "seccion" }> | null; cols: Bloque[][] };

/** Reparte los bloques medidos en hojas de dos columnas, sin partir nada. */
function repartir(bloques: Bloque[], alto: number[], altoSigue: number): Hoja[] {
  const hojas: Hoja[] = [{ marca: null, cols: [[], []] }];
  let col = 0, usado = 0, reserva = 0;
  let rubroActual: Rubro | null = null;
  const actual = () => hojas[hojas.length - 1];
  const max = () => (hojas.length === 1 ? DISPONIBLE_PRIMERA : DISPONIBLE_RESTO);
  const avanzar = () => {
    if (col === 0) col = 1;
    else { hojas.push({ marca: null, cols: [[], []] }); col = 0; reserva = 0; }
    usado = reserva;
  };
  bloques.forEach((b, i) => {
    // Cada marca arranca en una hoja nueva, con su nombre a todo el ancho
    // (Gonzalo, 2026-10-30: "cuando arranca una nueva marca, que haga un corte").
    if (b.tipo === "seccion") {
      if (i > 0) hojas.push({ marca: null, cols: [[], []] });
      actual().marca = b;
      col = 0;
      reserva = alto[i];
      usado = reserva;
      rubroActual = null;
      return;
    }
    let necesita = alto[i];
    // Lo que tiene que ir pegado: el título del rubro con sus dos primeros productos.
    if (b.tipo === "rubro") for (let k = 1; k <= 2 && i + k < bloques.length && bloques[i + k].tipo === "fila"; k++) necesita += alto[i + k];
    if (actual().cols[col].length > 0 && usado + necesita > max()) {
      avanzar();
      if (b.tipo === "fila" && rubroActual) {
        actual().cols[col].push({ tipo: "rubro", rubro: rubroActual, sigue: true });
        usado += altoSigue;
      }
    }
    actual().cols[col].push(b);
    usado += alto[i];
    if (b.tipo === "rubro") rubroActual = b.rubro;
  });
  return hojas;
}

function VistaBloque({ b }: { b: Bloque }) {
  if (b.tipo === "seccion")
    return (
      <div className="lp-seccion">
        <h3>{b.titulo}</h3>
        <span>
          {b.n} {b.n === 1 ? "producto" : "productos"}
        </span>
      </div>
    );
  if (b.tipo === "rubro")
    return (
      <div className="lp-rubro" style={{ "--c": b.rubro.color } as CSSProperties}>
        <div className="lp-rubro-nombre">
          {b.rubro.nombre}
          {b.sigue && <small> (sigue)</small>}
        </div>
        <div className="lp-cols">
          <span />
          <span>Producto</span>
          <span>Tarjeta</span>
          <span>Efectivo</span>
        </div>
      </div>
    );
  const { p, rubro } = b;
  const [nombre, detalle] = partes(p.nombre);
  return (
    <div className="lp-fila">
      {p.imagen ? (
        <span className="lp-img">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.imagen} alt="" loading="eager" />
        </span>
      ) : (
        <span className="lp-icono" style={{ "--c": rubro.color } as CSSProperties}>
          {ICONOS[rubro.icono]}
        </span>
      )}
      <span className="lp-nom">
        {nombre}
        {p.descuento > 0 && <span className="lp-oferta">OFERTA −{p.descuento}%</span>}
        {detalle && <small>{detalle}</small>}
      </span>
      <span className="lp-t">
        {p.antes != null && <s>{pesos(p.antes)}</s>}
        {pesos(p.lista)}
      </span>
      <span className="lp-e">{pesos(p.efectivo)}</span>
    </div>
  );
}

const ICONO_PIN = (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>);
const ICONO_RELOJ = (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
const ICONO_IG = (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" /></svg>);

export default function ListaPreciosPdf({ productos, hoy }: { productos: ProductoLista[]; hoy: string }) {
  const marcas = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; n: number; propia: boolean }>();
    for (const p of productos) {
      const x = m.get(p.idMarca) ?? { id: p.idMarca, nombre: p.propia ? "WiiGo" : p.marca, n: 0, propia: p.propia };
      x.n++;
      m.set(p.idMarca, x);
    }
    return [...m.values()].sort((a, b) => Number(b.propia) - Number(a.propia) || a.nombre.localeCompare(b.nombre));
  }, [productos]);
  const [elegidas, setElegidas] = useState<Set<string>>(() => new Set(marcas.map((m) => m.id)));
  const filtrados = useMemo(() => productos.filter((p) => elegidas.has(p.idMarca)), [productos, elegidas]);
  const bloques = useMemo(() => armarBloques(filtrados), [filtrados]);
  const medidor = useRef<HTMLDivElement>(null);
  const [hojas, setHojas] = useState<Hoja[] | null>(null);

  // Medir cada bloque ya dibujado (con la letra cargada) y recién ahí repartir en hojas.
  useEffect(() => {
    let vivo = true;
    (async () => {
      await document.fonts?.ready;
      const nodos = medidor.current?.querySelectorAll<HTMLElement>("[data-medir]");
      if (!nodos || !vivo) return;
      const altos = [...nodos].map((n) => n.getBoundingClientRect().height);
      const altoSigue = altos.pop() ?? 40;
      setHojas(repartir(bloques, altos, altoSigue));
    })();
    return () => {
      vivo = false;
    };
  }, [bloques]);

  const total = hojas?.length ?? 0;
  const todas = elegidas.size === marcas.length;
  return (
    <div className="lp">
      <div className="lp-controles">
        <div>
          <h1>Lista de precios</h1>
          <p>
            Con lo que cobra hoy la caja, ofertas incluidas. Tocá <b>Descargar PDF</b> y en la ventana elegí <b>Guardar como PDF</b>.
          </p>
        </div>
        <div className="lp-marcas" role="group" aria-label="Qué marcas van">
          <button type="button" aria-pressed={todas} onClick={() => setElegidas(new Set(marcas.map((m) => m.id)))}>
            Todo el local <small>{productos.length}</small>
          </button>
          {marcas.map((m) => (
            <label key={m.id}>
              <input
                type="checkbox"
                checked={elegidas.has(m.id)}
                onChange={(e) =>
                  setElegidas((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(m.id);
                    else n.delete(m.id);
                    return n;
                  })
                }
              />
              {m.nombre} <small>{m.n}</small>
            </label>
          ))}
        </div>
        <div className="lp-acciones">
          <span>
            {filtrados.length} productos · {total} {total === 1 ? "hoja" : "hojas"}
          </span>
          <button type="button" className="lp-descargar" disabled={!hojas || filtrados.length === 0} onClick={() => window.print()}>
            ⬇ Descargar PDF
          </button>
        </div>
      </div>

      {/* Fuera de la vista: cada bloque al ancho de una columna, para medirlo. El último es un título "(sigue)". */}
      <div className="lp-medidor" ref={medidor} aria-hidden="true">
        {bloques.map((b, i) => (
          <div key={i} data-medir>
            <VistaBloque b={b} />
          </div>
        ))}
        <div data-medir>
          <VistaBloque b={{ tipo: "rubro", rubro: { nombre: "Medida", color: "#000", icono: "bowl" }, sigue: true }} />
        </div>
      </div>

      {filtrados.length === 0 ? (
        <p className="lp-vacio">Elegí al menos una marca.</p>
      ) : !hojas ? (
        <p className="lp-vacio">Armando la lista…</p>
      ) : (
        <div className="lp-hojas">
          {hojas.map((h, i) => (
            <article className="lp-hoja" key={i} aria-label={`Hoja ${i + 1}`}>
              {i === 0 ? (
                <header className="lp-portada">
                  <div className="lp-p-fila">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="lp-logo" src={WIIGO_LOGO_DATA_URI} alt="WiiGo · Estaciones de bienestar" />
                    <div className="lp-titulo">
                      <h2>Lista de precios</h2>
                      <span>Vigente al {hoy}</span>
                    </div>
                  </div>
                  <div className="lp-datos">
                    <span>
                      {ICONO_PIN}
                      <span>
                        <b>{SUCURSAL.nombre}</b> · {SUCURSAL.direccion}
                      </span>
                    </span>
                    <span>
                      {ICONO_RELOJ}
                      <span>
                        <b>{SUCURSAL.dias}</b> · {SUCURSAL.horario}
                      </span>
                    </span>
                    <span>
                      {ICONO_IG}
                      <span>{SUCURSAL.instagram}</span>
                    </span>
                  </div>
                </header>
              ) : (
                <header className="lp-cab">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={WIIGO_LOGO_DATA_URI} alt="WiiGo" />
                  <span>Lista de precios · {hoy}</span>
                </header>
              )}
              <div className="lp-cuerpo">
                {h.marca && (
                  <div className="lp-marca-ancha">
                    <VistaBloque b={h.marca} />
                  </div>
                )}
                {h.cols.map((col, c) => (
                  <div className="lp-col" key={c}>
                    {col.map((b, k) => (
                      <VistaBloque key={k} b={b} />
                    ))}
                  </div>
                ))}
              </div>
              <footer className="lp-pie">
                <span>
                  Precios por unidad, con IVA incluido. <b className="lp-verde">En verde, pagando en efectivo.</b>
                  <br />
                  Los precios pueden tener variaciones sin previo aviso: vale el precio del local al momento de la compra. Ofertas hasta agotar stock.
                </span>
                <span className="lp-num">
                  Hoja {i + 1} de {total}
                  <br />
                  {SUCURSAL.instagram}
                </span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
