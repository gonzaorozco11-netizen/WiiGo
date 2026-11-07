"use client";

import { useCallback, useMemo, useState } from "react";
import EscanerCodigo from "@/components/EscanerCodigo";
import { NOMBRE_ALTURA, soloModulos, type ModuloGondola } from "@/lib/gondola";

// Góndola para el equipo (Gonzalo, 2026-11-07: «que vean las góndolas en 3D
// como yo, así ven cuánto hay de cada producto y adónde debería estar»).
// Pensada para el celular de los chicos: solo mirar, escanear y reponer.
// Acomodar la góndola sigue siendo en Precios → Góndola.

export type ProductoGondola = {
  id: string;
  /** Con la marca entre paréntesis, como lo ve el cliente. */
  nombre: string;
  /** id_local → unidades (suma de sus variantes). */
  stock: Record<string, number>;
  /** El mínimo cargado en Mínimos y objetivos (suma de sus variantes). */
  minimo: number;
  /** Código de barras y SKU de cada variante: con esto se lo encuentra al escanear. */
  codigos: string[];
};
type LocalGondola = { idLocal: string; nombre: string; modulos: ModuloGondola[] };
type Estado = "hay" | "poco" | "nohay" | "falta";
type Ubicacion = { mi: number; fila: number; columna: number };

const TEXTO: Record<Estado, string> = { hay: "Hay", poco: "Queda poco", nohay: "No hay", falta: "Falta poner" };
const clave = (u: Ubicacion) => `${u.mi}:${u.fila}:${u.columna}`;

export default function GondolaEquipo({ locales, productos }: { locales: LocalGondola[]; productos: ProductoGondola[] }) {
  const [idLocal, setIdLocal] = useState(locales[0]?.idLocal ?? "");
  const [actual, setActual] = useState(0);
  const [foco, setFoco] = useState<string | null>(null);
  const [vista, setVista] = useState<"gondola" | "reponer">("gondola");
  const [buscar, setBuscar] = useState("");
  const [escaneando, setEscaneando] = useState(false);
  const [hoja, setHoja] = useState<{ producto: ProductoGondola | null; codigo?: string } | null>(null);

  const local = locales.find((l) => l.idLocal === idLocal) ?? locales[0];
  const modulos = useMemo(() => local?.modulos ?? [], [local]);
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const porCodigo = useMemo(() => {
    const m = new Map<string, ProductoGondola>();
    for (const p of productos) for (const c of p.codigos) m.set(c, p);
    return m;
  }, [productos]);

  const cantidad = (p: ProductoGondola | undefined) => (p ? p.stock[local?.idLocal ?? ""] ?? 0 : 0);
  const estadoDe = (p: ProductoGondola | undefined, puesto = true): Estado => {
    if (!puesto) return "falta";
    const s = cantidad(p);
    if (s <= 0) return "nohay";
    if (p && p.minimo > 0 && s <= p.minimo) return "poco";
    return "hay";
  };

  // Todos los lugares con su producto, para buscar, reponer y escanear.
  const lugares = useMemo(
    () =>
      modulos.flatMap((m, mi) =>
        m.lugares.map((l) => ({ ...l, mi, m, p: porId.get(l.idProducto), u: { mi, fila: l.fila, columna: l.columna } as Ubicacion }))
      ),
    [modulos, porId]
  );
  const nombreZona = (m: ModuloGondola) => {
    if (m.tipo === "ISLA") return `Isla ${m.numero ?? ""} · ${m.lado === "DER" ? "lado Animalfit" : "lado módulos"}`;
    if (m.tipo === "ESTANTERIA") return m.numero === 2 ? "Animalfit fondo" : "Animalfit adelante";
    if (m.tipo === "FREEZER") return `Freezer ${m.numero ?? ""}`.trim();
    return `Mueble ${soloModulos(modulos).indexOf(m) + 1}`;
  };
  const alturaDe = (m: ModuloGondola, fila: number) => {
    const f = m.filas[fila];
    if (!f) return `Estante ${fila + 1}`;
    // Las estanterías tienen dos «arriba» y dos «ojos»: se aclara cuál.
    const iguales = m.filas.filter((x) => x.altura === f.altura);
    return iguales.length > 1 ? `${NOMBRE_ALTURA[f.altura]} ${iguales.indexOf(f) + 1}` : NOMBRE_ALTURA[f.altura];
  };

  const aReponer = lugares
    .filter((l) => l.puesto && ["nohay", "poco"].includes(estadoDe(l.p)))
    .sort((a, b) => a.mi - b.mi || (estadoDe(a.p) === "nohay" ? 0 : 1) - (estadoDe(b.p) === "nohay" ? 0 : 1) || a.fila - b.fila || a.columna - b.columna);

  function irA(u: Ubicacion) {
    setActual(u.mi);
    setFoco(clave(u));
    setVista("gondola");
    setBuscar("");
    // Que el lugar marcado quede a la vista, también en un mueble ancho.
    setTimeout(() => document.querySelector(".geq-lugar.foco")?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }), 80);
  }
  function abrir(p: ProductoGondola | undefined, u?: Ubicacion) {
    if (u) irA(u);
    setHoja({ producto: p ?? null });
  }
  const alLeer = useCallback(
    (codigo: string) => {
      setEscaneando(false);
      const p = porCodigo.get(codigo.trim()) ?? null;
      const u = p ? lugares.find((l) => l.idProducto === p.id)?.u : undefined;
      if (u) irA(u);
      setHoja({ producto: p, codigo });
    },
    [porCodigo, lugares]
  );

  if (!local) return <p className="geq-vacio">Todavía no hay locales activos.</p>;

  const m = modulos[actual] ?? modulos[0];
  const q = buscar.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const encontrados = q
    ? productos
        .filter((p) => p.nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q) || p.codigos.includes(buscar.trim()))
        .slice(0, 40)
    : [];

  return (
    <div className="geq">
      <header className="geq-cabeza">
        <div className="geq-titulo">
          <h1>Góndola</h1>
          {locales.length > 1 ? (
            <select value={local.idLocal} onChange={(e) => { setIdLocal(e.target.value); setActual(0); setFoco(null); }} aria-label="Local">
              {locales.map((l) => <option key={l.idLocal} value={l.idLocal}>{l.nombre}</option>)}
            </select>
          ) : (
            <span>{local.nombre}</span>
          )}
        </div>
        <div className="geq-buscar">
          <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto" />
          <button type="button" className="geq-escanear" onClick={() => setEscaneando(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8" />
            </svg>
            Escanear
          </button>
        </div>
        <div className="geq-pestanas" role="tablist">
          <button type="button" role="tab" aria-selected={vista === "gondola"} onClick={() => { setVista("gondola"); setBuscar(""); }}>
            Góndola
          </button>
          <button type="button" role="tab" aria-selected={vista === "reponer"} onClick={() => { setVista("reponer"); setBuscar(""); }}>
            Reponer {aReponer.length > 0 && <span className="num">{aReponer.length}</span>}
          </button>
        </div>
      </header>

      {q ? (
        <section className="geq-lista" aria-label="Resultados">
          {encontrados.length === 0 && <p className="geq-tenue">No encontré nada con «{buscar.trim()}».</p>}
          {encontrados.map((p) => {
            const l = lugares.find((x) => x.idProducto === p.id);
            const e = estadoDe(p, l ? l.puesto : true);
            return (
              <button type="button" key={p.id} className="geq-item" onClick={() => abrir(p, l?.u)}>
                <i className={e} />
                <span>
                  <b>{p.nombre}</b>
                  <small>{l ? `${nombreZona(l.m)} · ${alturaDe(l.m, l.fila)} · lugar ${l.columna + 1}` : "Sin lugar en la góndola"}</small>
                </span>
                <span className="cant">{cantidad(p)}</span>
              </button>
            );
          })}
        </section>
      ) : vista === "reponer" ? (
        <section className="geq-lista" aria-label="Para reponer">
          <p className="geq-tenue">Lo que hay que llevar a la góndola, mueble por mueble.</p>
          {aReponer.length === 0 && <p className="geq-ok">Todo repuesto 👌</p>}
          {aReponer.map((l, i) => {
            const e = estadoDe(l.p);
            return (
              <div key={clave(l.u)}>
                {(i === 0 || aReponer[i - 1].mi !== l.mi) && <h3>{nombreZona(l.m)}</h3>}
                <button type="button" className="geq-item" onClick={() => abrir(l.p, l.u)}>
                  <i className={e} />
                  <span>
                    <b>{l.p?.nombre ?? l.nombre}</b>
                    <small>{alturaDe(l.m, l.fila)} · lugar {l.columna + 1}</small>
                  </span>
                  <span className="cant">
                    {cantidad(l.p)}
                    <small>mín. {l.p?.minimo ?? 0}</small>
                  </span>
                </button>
              </div>
            );
          })}
        </section>
      ) : (
        <>
          <nav className="geq-zonas" aria-label="Muebles">
            {modulos.map((z, i) => {
              const malos = lugares.filter((l) => l.mi === i && l.puesto && ["nohay", "poco"].includes(estadoDe(l.p))).length;
              return (
                <button key={z.id} type="button" aria-pressed={i === actual} onClick={() => { setActual(i); setFoco(null); }}>
                  <span className={`pto ${z.lugares.length === 0 ? "vacio" : malos ? "mal" : "ok"}`} />
                  {nombreZona(z)}
                </button>
              );
            })}
          </nav>
          {m && <Mueble m={m} mi={actual} nombre={nombreZona(m)} modulos={modulos} foco={foco} porId={porId} estadoDe={estadoDe} cantidad={cantidad} alAbrir={abrir} />}
        </>
      )}

      {hoja && (
        <>
          <div className="geq-velo" onClick={() => setHoja(null)} />
          <section className="geq-hoja" role="dialog" aria-label="Producto">
            <div className="agarre" />
            {hoja.producto ? (
              (() => {
                const p = hoja.producto;
                const donde = lugares.filter((l) => l.idProducto === p.id);
                const e = estadoDe(p, donde.length ? donde.some((l) => l.puesto) : true);
                return (
                  <>
                    <h2>{p.nombre}</h2>
                    <div className={`geq-stock ${e}`}>
                      <b>{cantidad(p)}</b>
                      <span>
                        <strong>{e === "falta" ? "Falta poner en la góndola" : TEXTO[e]}</strong>
                        <br />
                        {e === "nohay" ? "No queda en el local" : p.minimo > 0 ? `El mínimo es ${p.minimo}` : "Sin mínimo cargado"}
                      </span>
                    </div>
                    {donde.length === 0 ? (
                      <p className="geq-tenue">Este producto no tiene lugar en la góndola. Avisale a Gonzalo dónde ponerlo.</p>
                    ) : (
                      donde.map((l) => (
                        <div className="geq-donde" key={clave(l.u)}>
                          <div><small>Mueble</small><b>{nombreZona(l.m).split(" · ")[0]}</b></div>
                          <div><small>Estante</small><b>{alturaDe(l.m, l.fila)}</b></div>
                          <div><small>Lugar</small><b>{l.columna + 1} de {l.m.filas[l.fila]?.lugares ?? "?"}</b></div>
                        </div>
                      ))
                    )}
                  </>
                );
              })()
            ) : (
              <>
                <h2>No lo encontré</h2>
                <p className="geq-tenue">El código {hoja.codigo} no es de ningún producto cargado. Revisá en Códigos de barras o avisale a Gonzalo.</p>
              </>
            )}
            <div className="geq-acciones">
              <button type="button" onClick={() => { setHoja(null); setEscaneando(true); }}>Escanear otro</button>
              <button type="button" className="prim" onClick={() => setHoja(null)}>Listo</button>
            </div>
          </section>
        </>
      )}

      {escaneando && <EscanerCodigo titulo="Escanear un producto" onLeido={alLeer} onCerrar={() => setEscaneando(false)} />}
    </div>
  );
}

/** El mueble de frente, con un poquito de perspectiva, como en Precios → Góndola. */
function Mueble({
  m,
  mi,
  nombre,
  modulos,
  foco,
  porId,
  estadoDe,
  cantidad,
  alAbrir,
}: {
  m: ModuloGondola;
  mi: number;
  nombre: string;
  modulos: ModuloGondola[];
  foco: string | null;
  porId: Map<string, ProductoGondola>;
  estadoDe: (p: ProductoGondola | undefined, puesto?: boolean) => Estado;
  cantidad: (p: ProductoGondola | undefined) => number;
  alAbrir: (p: ProductoGondola | undefined, u: Ubicacion) => void;
}) {
  const cuenta = (e: Estado) => m.lugares.filter((l) => estadoDe(porId.get(l.idProducto), l.puesto) === e).length;
  const ancho = Math.max(...m.filas.map((f) => f.lugares), 1);
  return (
    <section className="geq-cuerpo">
      <div className="geq-plano">
        <div>
          <h2>{nombre}</h2>
          <p>{m.titulo}{m.subtitulo ? ` · ${m.subtitulo}` : ""}</p>
        </div>
        <Mapa modulos={modulos} actual={mi} />
      </div>
      {m.lugares.length === 0 ? (
        <div className="geq-mueble sin-armar">Este mueble todavía no está armado en el sistema.</div>
      ) : (
        <div className="geq-escena">
          <div className="geq-mueble" style={{ minWidth: ancho > 6 ? ancho * 46 : undefined }}>
            <div className="geq-cartel">
              {m.titulo}
              {m.subtitulo && <small>{m.subtitulo}</small>}
            </div>
            {m.filas.map((f, fi) => (
              <div key={fi} className="geq-estante" style={{ gridTemplateColumns: `repeat(${f.lugares}, 1fr)` }}>
                {Array.from({ length: f.lugares }, (_, c) => {
                  const l = m.lugares.find((x) => x.fila === fi && x.columna === c);
                  if (!l) return <div key={c} className="geq-lugar vacio"><div className="bolsa" /></div>;
                  const p = porId.get(l.idProducto);
                  const e = estadoDe(p, l.puesto);
                  const u = { mi, fila: fi, columna: c };
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`geq-lugar${e === "falta" ? " planificado" : ""}${foco === clave(u) ? " foco" : ""}`}
                      onClick={() => alAbrir(p, u)}
                      aria-label={`${p?.nombre ?? l.nombre}: ${TEXTO[e]}`}
                    >
                      <div className="bolsa"><b>{p?.nombre ?? l.nombre}</b></div>
                      <span className={`badge ${e}`}>{e === "falta" ? "!" : cantidad(p)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="geq-leyenda">
        <span><i className="hay" />Hay</span>
        <span><i className="poco" />Queda poco</span>
        <span><i className="nohay" />No hay</span>
        <span><i className="falta" />Falta poner</span>
      </div>
      {m.lugares.length > 0 && (
        <div className="geq-resumen">
          <div className="r"><b>{cuenta("nohay")}</b><span>No hay</span></div>
          <div className="a"><b>{cuenta("poco")}</b><span>Queda poco</span></div>
          <div className="v"><b>{cuenta("hay")}</b><span>Bien</span></div>
        </div>
      )}
    </section>
  );
}

/** El local visto de arriba: módulos y freezer a la izquierda, islas al medio, Animalfit a la derecha. */
function Mapa({ modulos, actual }: { modulos: ModuloGondola[]; actual: number }) {
  const mods = soloModulos(modulos);
  const rect = (m: ModuloGondola) => {
    if (m.tipo === "MODULO") return { l: 3, t: 64 - mods.indexOf(m) * 11, w: 8, h: 10 };
    if (m.tipo === "FREEZER") return { l: 3, t: 6 + ((m.numero ?? 1) - 1) * 6, w: 8, h: 5 };
    if (m.tipo === "ISLA") return { l: m.lado === "DER" ? 46 : 36, t: m.numero === 2 ? 14 : 44, w: 9, h: 22 };
    return { l: 86, t: m.numero === 2 ? 8 : 42, w: 8, h: 30 };
  };
  return (
    <div className="geq-mapa" aria-hidden="true">
      {modulos.map((m, i) => {
        const r = rect(m);
        return <i key={m.id} className={i === actual ? "on" : undefined} style={{ left: `${r.l}%`, top: `${r.t}%`, width: `${r.w}%`, height: `${r.h}%` }} />;
      })}
      <span className="puerta" />
    </div>
  );
}
