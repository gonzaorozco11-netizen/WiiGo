"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { guardarMiCosto, type MisCostosPortal, type ProductoConMargen } from "@/app/portal/actions";
import { SIN_SUBCATEGORIA } from "@/lib/costosMarca";
import type { MargenSimulado } from "@/lib/margenMarca";

// "Mis productos": la lista de lo que WiiGo le vende a la marca, con su stock
// y con el costo que solo ella puede cargar.
//
// Vivía arriba del tablero. Con una marca de 72 productos eso era un muro de
// 72 "falta" antes de poder ver cómo había vendido, así que ahora es su propia
// pantalla y está agrupada por subcategoría, con un solo cajón abierto por vez.
//
// Toda la redacción evita el vocabulario contable. Quien lee esto fabrica
// suplementos, no lleva libros: si tiene que buscar qué significa
// "contribución marginal", la pantalla falló.

function pesos(v: number) {
  return v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function enteros(v: number) {
  return Math.round(v).toLocaleString("es-AR");
}
function pct1(v: number) {
  return (Math.round(v * 10) / 10).toLocaleString("es-AR");
}
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fechaCorta(iso: string | null) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

/** Debajo del mínimo que WiiGo quiere tener siempre, o directamente en cero. */
function faltaStock(p: ProductoConMargen) {
  return p.stock === 0 || p.stock < p.stockMinimo;
}

type Filtro = "falta" | "sinstock" | "hechos" | "todos";

export default function PortalMisProductos({ datos }: { datos: MisCostosPortal }) {
  const [filtro, setFiltro] = useState<Filtro>(datos.sinCosto > 0 ? "falta" : "todos");
  const [busca, setBusca] = useState("");
  const [sub, setSub] = useState<string | null>(null);
  // Un cajón abierto por vez, y ninguno al entrar: con 72 productos, todos
  // abiertos es el mismo muro de antes.
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const total = datos.productos.length;
  const hechos = total - datos.sinCosto;

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return datos.productos.filter((p) => {
      if (filtro === "falta" && p.costo != null) return false;
      if (filtro === "hechos" && p.costo == null) return false;
      if (filtro === "sinstock" && !faltaStock(p)) return false;
      if (sub && p.subcategoria !== sub) return false;
      return q === "" || `${p.nombre} ${p.subcategoria}`.toLowerCase().includes(q);
    });
  }, [datos.productos, filtro, busca, sub]);

  // Las subcategorías en el orden en que vienen los productos, con la de "sin
  // subcategoría" siempre al final: es un cajón de sobras, no una categoría.
  const subcategorias = useMemo(() => {
    const vistas = [...new Set(datos.productos.map((p) => p.subcategoria))];
    return vistas.sort((a, b) =>
      a === SIN_SUBCATEGORIA ? 1 : b === SIN_SUBCATEGORIA ? -1 : a.localeCompare(b, "es")
    );
  }, [datos.productos]);

  const gruposVisibles = useMemo(() => {
    const orden = subcategorias.filter((s) => visibles.some((p) => p.subcategoria === s));
    return orden.map((s) => ({ nombre: s, items: visibles.filter((p) => p.subcategoria === s) }));
  }, [subcategorias, visibles]);

  /** Buscar o filtrar por subcategoría abre sola la que corresponde: nadie
      escribe "creatina" para después tener que abrir el cajón a mano. */
  function estaAbierto(nombre: string) {
    if (busca.trim() !== "") return true;
    if (sub) return true;
    if (gruposVisibles.length === 1) return true;
    return grupoAbierto === nombre;
  }

  function tocarGrupo(nombre: string) {
    // Abrir uno cierra el anterior, y con él el producto desplegado: si no,
    // quedaría abierto dentro de un cajón que ya no se ve.
    setGrupoAbierto((g) => (g === nombre ? null : nombre));
    setAbierta(null);
  }

  return (
    <main className="portal-lienzo">
      <section className="modulo">
        <div className="enc-productos">
          <div>
            <h2>Mis productos</h2>
            <p className="desc">
              Los que WiiGo tiene a la venta, con lo que te cuesta a vos cada uno. Tu costo solo lo
              vemos WiiGo y vos.
            </p>
          </div>
          <div className="enc-der">
            {total > 0 && (
              <div className="progreso">
                <div className="cifras">
                  <span>Costos cargados</span>
                  <span>
                    <b>{hechos}</b> de {total}
                  </span>
                </div>
                <div className="riel">
                  <span style={{ width: `${total > 0 ? (hechos / total) * 100 : 0}%` }} />
                </div>
              </div>
            )}
            {/* El alta la hace WiiGo: la marca pide y nosotros aprobamos. El
                formulario ya vive en "Pedir un cambio" — acá va el atajo,
                porque es donde se le ocurre buscarlo. */}
            <Link className="boton-portal" href="/portal/cambios?nuevo=1">
              + Pedir un producto nuevo
            </Link>
          </div>
        </div>

        {total === 0 ? (
          <p className="vacio">Todavía no tenés productos cargados en WiiGo.</p>
        ) : (
          <>
            <div className="filtros-prod">
              <div className="buscador">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <circle cx="7" cy="7" r="4.6" />
                  <path d="M10.4 10.4 14 14" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar un producto…"
                  aria-label="Buscar un producto"
                />
              </div>
              <div className="pestanas" role="group" aria-label="Filtrar">
                <Pestana activa={filtro} valor="falta" onClick={setFiltro} n={datos.sinCosto}>
                  Falta el costo
                </Pestana>
                <Pestana activa={filtro} valor="sinstock" onClick={setFiltro} n={datos.sinStock}>
                  Sin stock
                </Pestana>
                <Pestana activa={filtro} valor="hechos" onClick={setFiltro} n={hechos}>
                  Ya cargados
                </Pestana>
                <Pestana activa={filtro} valor="todos" onClick={setFiltro} n={total}>
                  Todos
                </Pestana>
              </div>
            </div>

            <div className="chips-sub">
              <button className="chip" aria-pressed={sub === null} onClick={() => setSub(null)}>
                Todas las subcategorías <span className="c">{total}</span>
              </button>
              {subcategorias.map((s) => {
                const en = datos.productos.filter((p) => p.subcategoria === s);
                const faltan = en.filter((p) => p.costo == null).length;
                return (
                  <button
                    key={s}
                    className="chip"
                    aria-pressed={sub === s}
                    onClick={() => setSub((v) => (v === s ? null : s))}
                  >
                    {faltan > 0 && <span className="pendiente" />}
                    {s} <span className="c">{en.length}</span>
                  </button>
                );
              })}
            </div>

            {gruposVisibles.length === 0 ? (
              <p className="vacio">
                No hay productos que coincidan{busca.trim() ? ` con «${busca.trim()}»` : ""}.
              </p>
            ) : (
              gruposVisibles.map((g) => {
                const todosEn = datos.productos.filter((p) => p.subcategoria === g.nombre);
                const faltan = todosEn.filter((p) => p.costo == null).length;
                const ab = estaAbierto(g.nombre);
                return (
                  <div className="grupo-prod" key={g.nombre} data-abierto={ab ? "si" : "no"}>
                    <button className="grupo-cab" onClick={() => tocarGrupo(g.nombre)} aria-expanded={ab}>
                      <svg className="flecha" width="12" height="12" viewBox="0 0 12 12" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.5 4.5 6 8l3.5-3.5" />
                      </svg>
                      <h3>{g.nombre}</h3>
                      <span className="cuantos">
                        {g.items.length} de {todosEn.length}
                      </span>
                      {faltan > 0 ? (
                        <span className="pill-faltan">faltan {faltan}</span>
                      ) : (
                        <span className="pill-listo">completa</span>
                      )}
                    </button>
                    {ab && (
                      <div className="grupo-cuerpo">
                        <table className="tabla-prod">
                          <thead>
                            <tr>
                              <th>Producto</th>
                              <th className="num">En góndola</th>
                              <th className="num">Precio al público</th>
                              <th className="num">Mi costo</th>
                              <th className="num">Te queda por venta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.items.map((p) => (
                              <Fila
                                key={p.idProducto}
                                p={p}
                                abierta={abierta === p.idProducto}
                                onAbrir={() =>
                                  setAbierta((a) => (a === p.idProducto ? null : p.idProducto))
                                }
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            <div className="pie-prod">
              <span>
                Tocá una subcategoría para abrirla. Escribí el costo y apretá <kbd>Enter</kbd>. Tocá el
                nombre de un producto para ver la cuenta completa.
              </span>
              <span>{datos.sinCosto > 0 ? `Te faltan ${datos.sinCosto}` : "¡Están todos!"}</span>
            </div>

            {datos.sinCosto > 0 && (
              <div className="nota-ocre">
                Te faltan <b>{datos.sinCosto}</b> de {total} productos. Hasta que los cargues no te
                podemos decir cuánto ganás con ellos — solo cuánto cobrás.
              </div>
            )}
          </>
        )}
      </section>

      <p className="nota-pie">
        La cuenta que se abre en cada producto es por <b>una unidad</b>. La del mes entero está en el{" "}
        <Link href="/portal">Tablero</Link>, en «Lo que te queda este mes».
      </p>
    </main>
  );
}

function Pestana({
  activa,
  valor,
  onClick,
  n,
  children,
}: {
  activa: Filtro;
  valor: Filtro;
  onClick: (f: Filtro) => void;
  n: number;
  children: React.ReactNode;
}) {
  return (
    <button aria-pressed={activa === valor} onClick={() => onClick(valor)}>
      {children} <span className="n">{n}</span>
    </button>
  );
}

/** Las unidades en góndola, con el aviso cuando están por debajo del mínimo.
    Es el dato por el que una marca entra al portal: lo que no está en la
    góndola no se vende. */
function Stock({ p }: { p: ProductoConMargen }) {
  if (p.stock === 0) return <span className="stock-agotado">sin stock</span>;
  if (p.stock < p.stockMinimo)
    return (
      <span className="stock bajo">
        {p.stock} u.<small>queda poco</small>
      </span>
    );
  return <span className="stock">{p.stock} u.</span>;
}

function Fila({
  p,
  abierta,
  onAbrir,
}: {
  p: ProductoConMargen;
  abierta: boolean;
  onAbrir: () => void;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(p.costo != null ? String(p.costo) : "");
  const [guardando, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [recienGuardado, setRecienGuardado] = useState(false);

  // El peor caso: con crédito es cuando menos le queda, así que la columna
  // nunca le promete de más.
  const peor = p.porMedio.find((m) => m.medio === "CREDITO") ?? p.porMedio[0];
  const queda = p.costo != null && peor ? peor.leQueda ?? 0 : null;

  function guardar() {
    const n = Number(valor);
    if (!(n > 0) || n === p.costo) return;
    setError(null);
    empezar(async () => {
      const r = await guardarMiCosto({ idProducto: p.idProducto, costo: n, vigenteDesde: hoyISO() });
      if (r.error) setError(r.error);
      else {
        setRecienGuardado(true);
        setTimeout(() => setRecienGuardado(false), 1400);
        router.refresh();
      }
    });
  }

  /** Enter guarda y salta al costo del renglón siguiente: cargar setenta y
      pico de costos tiene que ser una sentada de tipear, no setenta modales. */
  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    guardar();
    const campos = [...document.querySelectorAll<HTMLInputElement>("input.inp-costo")];
    const sig = campos[campos.indexOf(e.currentTarget) + 1];
    if (sig) {
      sig.focus();
      sig.select();
    }
  }

  return (
    <>
      <tr className={`prod${abierta ? " abierta" : ""}`}>
        <td className="nom">
          <button onClick={onAbrir} aria-expanded={abierta}>
            <svg className="ch" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 2.5 8 6l-4 3.5" />
            </svg>
            <span>
              {p.nombre}
              {p.costo != null && (
                <small>
                  costo desde {fechaCorta(p.vigenteDesde)} · lo cargó{" "}
                  {p.cargadoPor === "MARCA" ? "tu equipo" : p.nombreQuienCargo ?? "WiiGo"}
                </small>
              )}
            </span>
          </button>
        </td>
        <td className="num">
          <Stock p={p} />
        </td>
        <td className="num mono tenue">${enteros(p.precio)}</td>
        <td className="num">
          <input
            className={`inp-costo${p.costo != null ? " cargado" : ""}`}
            type="number"
            inputMode="numeric"
            step="0.01"
            value={valor}
            placeholder="falta"
            aria-label={`Costo de ${p.nombre}`}
            disabled={guardando}
            onChange={(e) => setValor(e.target.value)}
            onBlur={guardar}
            onKeyDown={alTeclear}
          />
          {recienGuardado && <span className="guardado">guardado ✓</span>}
          {error && <span className="err-costo">{error}</span>}
        </td>
        <td className="num">
          {queda != null ? (
            <span className="queda-col">
              ${enteros(queda)}
              <small>{pct1((queda / p.precio) * 100)}% de la venta</small>
            </span>
          ) : (
            <span className="sin-dato">—</span>
          )}
        </td>
      </tr>
      {abierta && (
        <tr className="detalle">
          <td colSpan={5}>
            <Reparto p={p} />
          </td>
        </tr>
      )}
    </>
  );
}

const COLORES = {
  prod: "#8a9a78",
  wiigo: "#536243",
  banco: "#bd8f3e",
  sircreb: "#b4bcc6",
  queda: "#4c8459",
} as const;

type Parte = { etiqueta: string; color: string; monto: number };

/** Los cinco pedazos, y suman el precio exacto. Sin pedazo de IVA: WiiGo le
    factura a ELLA la comisión, así que cuánto IVA le toca depende de cómo
    facture — restarle uno supuesto sería mostrarle una ganancia más chica que
    la real por una cuenta que nadie hizo. */
function partes(m: MargenSimulado, costo: number): Parte[] {
  return [
    { etiqueta: "Costo mercadería", color: COLORES.prod, monto: costo },
    { etiqueta: "Comisión WiiGo + IVA", color: COLORES.wiigo, monto: m.comisionWiigo + m.ivaComision },
    { etiqueta: "Otros costos", color: COLORES.banco, monto: m.comisionMp + m.impCreditos + m.impDebitos },
    { etiqueta: "SIRCREB", color: COLORES.sircreb, monto: m.sircreb },
    { etiqueta: "Te queda a vos", color: COLORES.queda, monto: m.leQueda ?? 0 },
  ];
}

/**
 * El mismo panel que ve WiiGo del lado de adentro: las dos formas de cobro
 * lado a lado, con la dona, la tabla de comparación y el cierre.
 *
 * Antes acá había una barra de $100 con botones para cambiar el medio de pago
 * — otro dibujo para la misma cuenta, que obligaba a tocar para comparar en
 * vez de ver las dos juntas. Mismo dibujo de los dos lados: cuando la marca y
 * WiiGo discuten un precio, discuten mirando lo mismo.
 */
function Reparto({ p }: { p: ProductoConMargen }) {
  const credito = p.porMedio.find((m) => m.medio === "CREDITO");
  const efectivo = p.porMedio.find((m) => m.medio === "EFECTIVO");
  if (!credito || !efectivo) return null;

  if (p.costo == null) {
    return (
      <div className="caja-det">
        <div className="nota-ocre" style={{ marginTop: 0 }}>
          Cargale el costo acá arriba y te mostramos cuánto ganás con cada venta, igual que lo ve
          WiiGo. Por ahora solo sabemos cuánto te transferimos:{" "}
          <b>${pesos(credito.leTransferimos)}</b> pagando con tarjeta de crédito.
        </div>
      </div>
    );
  }

  const qC = credito.leQueda ?? 0;
  const qE = efectivo.leQueda ?? 0;
  const ganaEfectivo = qE > qC;
  const izq = partes(credito, p.costo);
  const der = partes(efectivo, p.costo);

  return (
    <div className="caja-det">
      <div className="panel-rep">
        <p className="panel-tit">A dónde va cada peso que paga el cliente</p>
        <div className="duo">
          <Columna m={credito} costo={p.costo} corto="Crédito" gana={!ganaEfectivo} />
          <Columna m={efectivo} costo={p.costo} corto="Efectivo" gana={ganaEfectivo} />
        </div>

        <table className="tabla-panel">
          <thead>
            <tr>
              <th>Cada peso va a</th>
              <th>Crédito</th>
              <th>Efectivo</th>
            </tr>
          </thead>
          <tbody>
            {izq.map((x, i) => {
              const y = der[i];
              const esQueda = i === izq.length - 1;
              return (
                <tr key={x.etiqueta} className={esQueda ? "queda" : ""}>
                  <td>
                    <span className="k">
                      <i className="llave" style={{ background: x.color }} />
                      {x.etiqueta}
                    </span>
                  </td>
                  {[x.monto, y.monto].map((v, j) => (
                    <td key={j}>
                      ${pesos(v)}
                      <span className="pc">{pct1(p.precio > 0 ? (v / p.precio) * 100 : 0)}%</span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="panel-pie">
          Por cada unidad te quedan <b className="verde">${pesos(qE)}</b> en efectivo y{" "}
          <b>${pesos(qC)}</b> con crédito
          {Math.abs(qE - qC) > 0.5 && <> —<b>${pesos(Math.abs(qE - qC))}</b> de diferencia</>}.
          <span className="chico">
            Ya tiene descontado todo lo de arriba. De ahí todavía salen{" "}
            <b>tus impuestos y tus gastos</b> —tu IVA según cómo facturás, Ingresos Brutos, alquiler,
            sueldos— que WiiGo no conoce y no calcula.
          </span>
        </div>
      </div>
    </div>
  );
}

function Columna({
  m,
  costo,
  corto,
  gana,
}: {
  m: MargenSimulado;
  costo: number;
  corto: string;
  gana: boolean;
}) {
  const queda = m.leQueda ?? 0;
  const margen = m.leTransferimos > 0 ? (queda / m.leTransferimos) * 100 : 0;
  const esEfectivo = corto === "Efectivo";

  return (
    <div className={gana ? "gana" : undefined}>
      <span className="sello">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          {esEfectivo ? (
            <>
              <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
              <circle cx="8" cy="8" r="1.9" />
            </>
          ) : (
            <>
              <rect x="1.5" y="3.5" width="13" height="9" rx="2" />
              <path d="M1.5 6.75h13" />
            </>
          )}
        </svg>
        {corto}
        {gana && (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6.4l2.4 2.4 4.6-5" />
          </svg>
        )}
      </span>
      <Dona partes={partes(m, costo)} centro={`$${enteros(queda)}`} />
      <p className="cobra">el cliente paga ${pesos(m.precio)}</p>
      <p className="marg">margen {Math.round(margen)}% de lo que recibís</p>
    </div>
  );
}

/**
 * La dona: un arco por pedazo, con un hueco entre ellos y las puntas
 * redondeadas. Pegados se leían como un solo anillo partido en vez de como
 * cinco cosas distintas; el aro gris de atrás sostiene el círculo cuando algún
 * pedazo da cero.
 */
function Dona({ partes, centro }: { partes: Parte[]; centro: string }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const HUECO = C * (2.2 / 360);
  const total = partes.reduce((a, p) => a + Math.max(p.monto, 0), 0);
  let acumulado = 0;

  return (
    <div className="dona-rep">
      <svg viewBox="0 0 126 126" width="126" height="126" aria-hidden="true">
        <circle cx="63" cy="63" r={R} fill="none" stroke="#eef0e9" strokeWidth="15" />
        {/* Arranca arriba y gira como un reloj: es como se lee una torta. */}
        <g transform="rotate(-90 63 63)">
          {partes.map((p, i) => {
            const porcion = total > 0 ? Math.max(p.monto, 0) / total : 0;
            const largo = Math.max(porcion * C - HUECO, 0.1);
            const offset = -(acumulado * C + HUECO / 2);
            acumulado += porcion;
            return (
              <circle
                key={i}
                cx="63"
                cy="63"
                r={R}
                fill="none"
                stroke={p.color}
                strokeWidth="15"
                strokeLinecap="round"
                strokeDasharray={`${largo} ${C - largo}`}
                strokeDashoffset={offset}
              />
            );
          })}
        </g>
      </svg>
      <div className="centro">
        <b>{centro}</b>
        <span>te queda</span>
      </div>
    </div>
  );
}
