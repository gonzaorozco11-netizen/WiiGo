"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  guardarMiCosto,
  proponerEnvio,
  type MisCostosPortal,
  type ProductoConMargen,
} from "@/app/portal/actions";
import { pedirBaja } from "@/app/portal/cambios/actions";
import { SIN_SUBCATEGORIA } from "@/lib/costosMarca";
import PanelReparto, { PanelSinCosto } from "@/components/PanelReparto";

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

function enteros(v: number) {
  return Math.round(v).toLocaleString("es-AR");
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
  // Un cajón abierto por vez, y ninguno al entrar: con 72 productos, todos
  // abiertos es el mismo muro de antes.
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [proponiendo, setProponiendo] = useState(false);
  const [propuestaHecha, setPropuestaHecha] = useState<string | null>(null);

  const total = datos.productos.length;
  const hechos = total - datos.sinCosto;

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return datos.productos.filter((p) => {
      if (filtro === "falta" && p.costo != null) return false;
      if (filtro === "hechos" && p.costo == null) return false;
      if (filtro === "sinstock" && !faltaStock(p)) return false;
      return q === "" || `${p.nombre} ${p.subcategoria}`.toLowerCase().includes(q);
    });
  }, [datos.productos, filtro, busca]);

  /**
   * Plana solo cuando se está buscando: ahí la lista ya quedó corta y los
   * encabezados sobran.
   *
   * Antes también iba plana con el filtro de "lo que falta", con la idea de
   * que cargar setenta costos seguidos no quiere cajones que abrir y cerrar.
   * Pero cuando falta TODO —que es el estado de una marca recién cargada—
   * eso dejaba setenta y dos filas de corrido y sin una sola góndola a la
   * vista. La solución no era sacar los encabezados: es dejarlos abiertos.
   */
  const plano = busca.trim() !== "";

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

  /**
   * Cuál cajón está abierto.
   *
   * Si no tocó ninguno, se abre solo el primero que tiene costos sin cargar:
   * entrar y ver diez cajones cerrados obliga a adivinar por dónde empezar, y
   * lo que hay que hacer siempre es lo que falta.
   */
  const primeroConFaltantes = useMemo(
    () =>
      gruposVisibles.find((g) =>
        datos.productos.some((p) => p.subcategoria === g.nombre && p.costo == null)
      )?.nombre ?? gruposVisibles[0]?.nombre ?? null,
    [gruposVisibles, datos.productos]
  );

  function estaAbierto(nombre: string) {
    if (gruposVisibles.length === 1) return true;
    // Cargando costos van todos abiertos: ahí la lista se recorre entera de
    // arriba abajo y los encabezados son separadores, no cajones. Abrir y
    // cerrar setenta veces es la fricción que esto venía a evitar.
    if (filtro === "falta" && grupoAbierto === null) return true;
    if (grupoAbierto === null) return nombre === primeroConFaltantes;
    return grupoAbierto === nombre;
  }

  function tocarGrupo(nombre: string) {
    // Abrir uno cierra el anterior, y con él el producto desplegado: si no,
    // quedaría abierto dentro de un cajón que ya no se ve.
    //
    // "" es "los cerré yo", distinto de null, que es "todavía no toqué nada" y
    // deja abierto el primero con faltantes.
    setGrupoAbierto(estaAbierto(nombre) ? "" : nombre);
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
            {/* Acá y en ningún otro lado. Antes estaba también arriba de
                "Cambios y altas", que es donde no se le ocurre buscarlo a
                nadie: una marca que va a sumar un producto entra a Mis
                productos, porque ahí están los suyos. El alta sigue siendo una
                solicitud —la marca nunca escribe en `productos`— pero eso se
                le dice en el formulario, no en el botón. */}
            <Link className="boton-portal" href="/portal/cambios?nuevo=1">
              + Añadir nuevo producto
            </Link>
            {/* Sigue acá, pero como atajo: lo normal es que el envío salga de
                Reponer, donde la orden ya viene armada con lo que se vendió.
                Esta puerta queda para mandar algo que la sugerencia no pide
                —un lanzamiento, una promo— que si no se arregla por WhatsApp
                y la mercadería llega sin papel. */}
            <button className="boton-portal sec" onClick={() => setProponiendo(true)}>
              ↑ Mandar algo que no está en Reponer
            </button>
          </div>
        </div>

        {propuestaHecha && <div className="nota-verde">{propuestaHecha}</div>}

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

            {/* Los chips de subcategoría que había acá eran la misma lista que
                los encabezados de abajo, con el mismo contador: dos controles
                para lo mismo, y el usuario sin saber cuál usar. Quedan los
                encabezados, que además dicen cuántos faltan en cada uno. */}

            {visibles.length === 0 ? (
              <p className="vacio">
                No hay productos que coincidan{busca.trim() ? ` con «${busca.trim()}»` : ""}.
              </p>
            ) : plano ? (
              <div className="grupo-cuerpo plano">
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
                    {visibles.map((p) => (
                      <Fila
                        key={p.idProducto}
                        p={p}
                        conSubcategoria
                        abierta={abierta === p.idProducto}
                        onAbrir={() => setAbierta((a) => (a === p.idProducto ? null : p.idProducto))}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
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
                {plano ? (
                  <>
                    Escribí el costo y apretá <kbd>Enter</kbd> para saltar al siguiente.
                  </>
                ) : (
                  <>
                    Tocá una subcategoría para abrirla. Escribí el costo y apretá <kbd>Enter</kbd>.
                  </>
                )}{" "}
                Tocá el nombre de un producto para ver la cuenta completa.
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

      {proponiendo && (
        <ProponerEnvio
          productos={datos.productos}
          onCerrar={() => setProponiendo(false)}
          onListo={(msg) => {
            setProponiendo(false);
            setPropuestaHecha(msg);
          }}
        />
      )}
    </main>
  );
}

/**
 * La marca arma lo que quiere mandar y lo propone.
 *
 * Vienen precargados los que están sin stock: si la góndola está vacía, eso
 * es lo que hay que mandar, y es la razón por la que entró a esta pantalla.
 */
function ProponerEnvio({
  productos,
  onCerrar,
  onListo,
}: {
  productos: ProductoConMargen[];
  onCerrar: () => void;
  onListo: (msg: string) => void;
}) {
  const router = useRouter();
  const [cantidades, setCantidades] = useState<Record<string, number>>(() =>
    Object.fromEntries(productos.filter((p) => p.stock === 0).map((p) => [p.idProducto, 12]))
  );
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, empezar] = useTransition();

  // Primero los que están sin stock: es lo que hay que resolver.
  const orden = useMemo(
    () => [...productos].sort((a, b) => a.stock - b.stock || a.nombre.localeCompare(b.nombre, "es")),
    [productos]
  );

  const elegidos = orden.filter((p) => (cantidades[p.idProducto] ?? 0) > 0);
  const total = elegidos.reduce((a, p) => a + cantidades[p.idProducto], 0);

  function enviar() {
    setError(null);
    empezar(async () => {
      const r = await proponerEnvio({
        items: elegidos.map((p) => ({ idProducto: p.idProducto, cantidad: cantidades[p.idProducto] })),
        observaciones: motivo,
      });
      if (r.error) setError(r.error);
      else {
        router.refresh();
        const cuanto = `${total} unidades de ${elegidos.length} producto${
          elegidos.length === 1 ? "" : "s"
        }`;
        // Decirle que entró sola importa: si no, la marca espera una respuesta
        // que nunca va a llegar y no manda la mercadería.
        onListo(
          r.automatica
            ? `Aprobado: ${cuanto}. Entra dentro de lo esperado, así que no hace falta que lo revisemos — ya podés mandarlo el próximo día de recepción.`
            : `Propuesta enviada: ${cuanto}. Es más de lo que la góndola necesita, así que lo mira WiiGo y te avisa.`
        );
      }
    });
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal-caja grande" onClick={(e) => e.stopPropagation()}>
        <h3>Proponer un envío</h3>
        <p className="desc">Elegí qué querés mandar. WiiGo lo revisa y te avisa si lo acepta.</p>

        <div className="nota-ocre">
          No mandes nada hasta que te lo aprobemos. Si llega sin aprobar, queda frenado en el depósito
          hasta que alguien lo revise.
        </div>

        <div className="tabla-scroll">
          <table className="tabla-proponer">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">En góndola</th>
                <th className="num">Quiero mandar</th>
              </tr>
            </thead>
            <tbody>
              {orden.map((p) => (
                <tr key={p.idProducto}>
                  <td>
                    {p.nombre}
                    <small>{p.subcategoria}</small>
                  </td>
                  <td className="num">
                    <Stock p={p} />
                  </td>
                  <td className="num">
                    <input
                      className="inp-costo"
                      style={{ width: 84 }}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={cantidades[p.idProducto] ?? ""}
                      placeholder="0"
                      disabled={enviando}
                      aria-label={`Unidades a mandar de ${p.nombre}`}
                      onChange={(e) =>
                        setCantidades((prev) => ({
                          ...prev,
                          [p.idProducto]: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <label className="campo-portal">
          <span className="et">¿Por qué?</span>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Lanzamiento, promo, reposición de lo que se agotó…"
          />
          <span className="ay">Ayuda a que te lo aprueben más rápido.</span>
        </label>

        {error && <div className="nota-roja">{error}</div>}

        <div className={total > 0 ? "nota-verde" : "nota-gris"}>
          {total > 0
            ? `Vas a proponer ${total} unidades de ${elegidos.length} producto${elegidos.length === 1 ? "" : "s"}.`
            : "Poné cuántas unidades querés mandar de cada uno."}
        </div>

        <div className="modal-pie">
          <button className="boton-portal sec" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </button>
          <button className="boton-portal" onClick={enviar} disabled={enviando || total <= 0}>
            {enviando ? "Enviando…" : "Mandar la propuesta"}
          </button>
        </div>
      </div>
    </div>
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
  conSubcategoria,
}: {
  p: ProductoConMargen;
  abierta: boolean;
  onAbrir: () => void;
  /** En la lista plana, porque no hay encabezado que lo diga. */
  conSubcategoria?: boolean;
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
              {/* Sin los encabezados de subcategoría arriba, el renglón tiene
                  que decir de qué cajón es. Agrupada no hace falta: ya lo dice
                  el encabezado. */}
              {conSubcategoria && p.costo == null && <small>{p.subcategoria}</small>}
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
            // Solo los pesos. El "% de la venta" leído solo, sin el desglose
            // al lado, parece que la marca se queda con menos de la mitad —
            // sin decir que de ahí salen su propio costo, la comisión y los
            // impuestos. Eso está explicado a un clic, abriendo el producto.
            <span className="queda-col">${enteros(queda)}</span>
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

/**
 * El mismo panel que ve WiiGo del lado de adentro, y el mismo que sale en
 * Precios: las dos formas de cobro lado a lado, con la dona y el detalle.
 *
 * Antes acá había una barra de $100 con botones para cambiar el medio de pago
 * — otro dibujo para la misma cuenta, que obligaba a tocar para comparar en
 * vez de ver las dos juntas. Mismo dibujo de los dos lados: cuando la marca y
 * WiiGo discuten un precio, discuten mirando lo mismo. Por eso el panel vive
 * en components/PanelReparto.tsx y no acá.
 */
function Reparto({ p }: { p: ProductoConMargen }) {
  const credito = p.porMedio.find((m) => m.medio === "CREDITO");
  const efectivo = p.porMedio.find((m) => m.medio === "EFECTIVO");
  if (!credito || !efectivo) return null;

  return (
    <div className="caja-det">
      {p.costo == null ? (
        <PanelSinCosto credito={credito} efectivo={efectivo} donde="la columna «Mi costo» de arriba" />
      ) : (
        <PanelReparto credito={credito} efectivo={efectivo} costo={p.costo} />
      )}
      <PedirBaja p={p} />
    </div>
  );
}

/**
 * Sacar un producto de la góndola.
 *
 * Acá adentro y no como un botón de la fila: dar de baja es lo último que se
 * hace con un producto y no tiene que estar al alcance del dedo mientras se
 * cargan costos. Abre un paso de confirmación antes de mandar nada.
 *
 * Con stock en el local no se puede: lo frena el servidor, porque esa
 * mercadería es de la marca y hay que sacarla antes de borrar el producto que
 * la sostiene.
 */
function PedirBaja({ p }: { p: ProductoConMargen }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mandando, empezar] = useTransition();

  if (listo) {
    return (
      <p className="baja-ok">
        Pedido mandado. WiiGo lo revisa y lo saca de la góndola si está de acuerdo.
      </p>
    );
  }

  if (!confirmando) {
    return (
      <div className="baja-pie">
        <button className="baja-link" onClick={() => setConfirmando(true)}>
          Pedir la baja de este producto
        </button>
      </div>
    );
  }

  return (
    <div className="baja-caja">
      <p>
        ¿Sacamos <b>{p.nombre}</b> de la góndola? Deja de venderse, pero tus ventas anteriores y tus
        liquidaciones quedan intactas.
      </p>
      {p.stock > 0 && (
        <p className="baja-aviso">
          Ojo: todavía hay <b>{p.stock} unidades</b> en el local. Hay que retirarlas antes.
        </p>
      )}
      {error && <p className="baja-error">{error}</p>}
      <div className="baja-botones">
        <button
          className="boton-portal sec"
          disabled={mandando}
          onClick={() => {
            setConfirmando(false);
            setError(null);
          }}
        >
          No, dejalo
        </button>
        <button
          className="boton-portal peligro"
          disabled={mandando}
          onClick={() => {
            setError(null);
            empezar(async () => {
              const r = await pedirBaja(p.idProducto);
              if (r.error) setError(r.error);
              else {
                setListo(true);
                router.refresh();
              }
            });
          }}
        >
          {mandando ? "Mandando…" : "Sí, pedir la baja"}
        </button>
      </div>
    </div>
  );
}

