"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { COMERCIOS, diferencia, mismoTamano, precioATuTamano, precioNormalATuTamano, tamanoComparable, type Comercio, type ItemCompetencia } from "@/lib/competencia";
import type { DatosCompetencia, VinculoCompetencia } from "@/lib/competenciaLeer";
import type { ProductoDelModulo, RubroDelModulo } from "@/lib/datosPrecios";
import { colorDeRubro } from "@/lib/coloresRubro";
import {
  actualizarCompetenciaAhora,
  confirmarEquivalente,
  descartarEquivalente,
  deshacerNoLoTrabaja,
  elegirEquivalente,
  opcionesEquivalente,
  quitarEquivalente,
  type OpcionEquivalente,
} from "@/app/(app)/precios/competencia-actions";

// Pestaña "Competencia" de Precios: los precios de Mendoza, leídos solos cada
// lunes, al lado de cada producto de WiiGo y llevados a su tamaño. Lo único
// que hace Gonzalo es confirmar (✓) o descartar (✗) el equivalente propuesto.

const pesos = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${Math.round(n).toLocaleString("es-AR")}`);
const fechaHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";
const nombreDe = (c: Comercio) => COMERCIOS.find((x) => x.clave === c)?.nombre ?? c;
/**
 * Sin bolsita de WiiGo = viene cerrado (miel, aceite de coco, botellas): se
 * compara solo con el mismo tamaño, no dividiendo uno más grande (Gonzalo, 2026-11-07).
 */
const esCerrado = (p: { idEnvase: string | null }) => !p.idEnvase;
const otroTamano = (it: ItemCompetencia, p: { idEnvase: string | null; gramos: number | null }) => esCerrado(p) && !mismoTamano(it.gramos, p.gramos);
const legible = (g: number | null) => (g == null ? "?" : g >= 1000 ? `${(g / 1000).toLocaleString("es-AR")} kg` : `${g} g`);

// sinIgual: los comercios que Gonzalo desvinculó a mano («no lo tienen igual»).
type Fila = { p: ProductoDelModulo; v: Partial<Record<Comercio, VinculoCompetencia>>; dif: number | null; contra: Comercio | null; sinIgual: Comercio[] };

function chip(dif: number | null) {
  if (dif == null) return <span className="pr-dif nada">Sin comparar</span>;
  const pct = Math.round(Math.abs(dif) * 100);
  if (dif > 0.08) return <span className="pr-dif caro">{pct}% más caro</span>;
  if (dif < -0.08) return <span className="pr-dif barato">{pct}% más barato</span>;
  return <span className="pr-dif parejo">Parejo ({dif >= 0 ? "+" : "−"}{pct}%)</span>;
}

/** "Llevarlo a $1.800": el margen que da ese precio, y ponerlo (abre "Pasar a la venta"). Viven en PreciosApp. */
type Llevar = { margenPara: (id: string, precio: number) => number | null; llevarA: (id: string, precio: number) => void; minimo: number };

export default function PreciosCompetencia(
  props: {
    productos: ProductoDelModulo[];
    rubros: RubroDelModulo[];
    datos: DatosCompetencia | null;
    avisar: (t: string, mal?: boolean) => void;
    /** id_producto → marca de fábrica, para mostrar al lado del nombre (lib/marcaFabrica.ts). */
    marcasFabrica?: Record<string, string>;
  } & Llevar
) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [pendiente, startTransition] = useTransition();

  if (!props.datos) {
    return (
      <section className="pr-tarjeta pr-vacio">
        <h2>Falta un paso</h2>
        <p className="baj">Para ver la competencia, corré sql/precios-competencia.sql en Supabase.</p>
      </section>
    );
  }
  const datos = props.datos;

  function actualizar() {
    startTransition(async () => {
      const r = await actualizarCompetenciaAhora().catch(() => ({ error: "No se pudo actualizar. Revisá la conexión.", texto: undefined }));
      props.avisar(r.error ?? r.texto ?? "Listo", Boolean(r.error));
      router.refresh();
    });
  }
  function responder(idProducto: string, comercio: Comercio, si: boolean) {
    startTransition(async () => {
      const r = await (si ? confirmarEquivalente(idProducto, comercio) : descartarEquivalente(idProducto, comercio)).catch(() => ({ error: "No se pudo guardar." }));
      if (r.error) props.avisar(r.error, true);
      router.refresh();
    });
  }
  /** «Desvincular» / «No lo trabaja»: ese comercio queda sin equivalente y no se propone otro solo. */
  function quitar(idProducto: string, comercio: Comercio) {
    startTransition(async () => {
      const r = await quitarEquivalente(idProducto, comercio).catch(() => ({ error: "No se pudo guardar." }));
      props.avisar(r.error ?? `Listo: ${nombreDe(comercio)} no lo trabaja.`, Boolean(r.error));
      router.refresh();
    });
  }
  /** Sacar el «No lo trabaja»: el sistema vuelve a proponer el más parecido. */
  function deshacer(idProducto: string, comercio: Comercio) {
    startTransition(async () => {
      const r = await deshacerNoLoTrabaja(idProducto, comercio).catch(() => ({ error: "No se pudo guardar." }));
      props.avisar(r.error ?? `Listo: ${nombreDe(comercio)} vuelve a compararse.`, Boolean(r.error));
      router.refresh();
    });
  }

  // Se compara contra el precio normal; la oferta va aparte, de referencia (puede ser algo por vencer).
  const conPrecio = (v: VinculoCompetencia | undefined, p: { gramos: number | null; idEnvase: string | null }) =>
    v?.item && p.gramos ? precioNormalATuTamano(v.item, p.gramos, esCerrado(p)) : null;
  const filas: Fila[] = props.productos.map((p0) => {
    // Para comparar: su peso neto o, si no lo tiene, el tamaño del nombre (x200cc). Solo acá, no se guarda.
    const p = { ...p0, gramos: tamanoComparable(p0) };
    const v: Fila["v"] = {};
    for (const x of datos.vinculos[p.id] ?? []) if (x.item) v[x.comercio] = x;
    // Contra la dietética principal (Sabor y Gran, desde que se sacó Bela Vita el
    // 2026-11-04); si no la tiene, contra el más barato de los otros.
    // Alifrut no entra: es el proveedor, su precio al público va solo de referencia.
    const otros = (Object.keys(v) as Comercio[])
      .filter((c) => c !== "ALIFRUT")
      .map((c) => ({ c, precio: conPrecio(v[c], p) }))
      .filter((x) => x.precio);
    const principal = COMERCIOS.find((c) => c.principal)?.clave;
    const contra: Comercio | null =
      principal && v[principal] && conPrecio(v[principal], p) ? principal : otros.sort((a, b) => (a.precio as number) - (b.precio as number))[0]?.c ?? null;
    const dif = contra && p.precioHoy ? diferencia(p.precioHoy, conPrecio(v[contra], p)) : null;
    const sinIgual = (datos.vinculos[p.id] ?? []).filter((x) => !x.item && x.estado === "CONFIRMADO").map((x) => x.comercio);
    return { p, v, dif, contra, sinIgual };
  });
  const columnas = COMERCIOS.filter((c) => filas.some((f) => f.v[c.clave]));
  // Buscador: por tu producto o por el nombre que tiene en la competencia, sin importar tildes.
  const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = sinTildes(buscar.trim());
  const visibles = q
    ? filas.filter((f) => sinTildes(f.p.nombre).includes(q) || Object.values(f.v).some((x) => x?.item && sinTildes(x.item.nombre).includes(q)))
    : filas;
  // Separado por rubro, como la Lista de precios y con los mismos colores
  // (Gonzalo, 2026-11-05: «que se separe en subcategorías»). Rubros por nombre,
  // lo que no tiene rubro al final; adentro, del más caro al más barato.
  const rubroPorId = new Map(props.rubros.map((r, i) => [r.id, { r, i }]));
  const idsRubro = [...new Set(visibles.map((f) => (f.p.idSubcategoria && rubroPorId.has(f.p.idSubcategoria) ? f.p.idSubcategoria : "")))].sort((a, b) => {
    const na = rubroPorId.get(a)?.r.nombre;
    const nb = rubroPorId.get(b)?.r.nombre;
    if (!na || !nb) return na ? -1 : nb ? 1 : 0;
    return na.localeCompare(nb, "es");
  });
  const grupos = idsRubro.map((id) => ({
    id,
    titulo: rubroPorId.get(id)?.r.nombre ?? "Sin rubro",
    color: colorDeRubro(rubroPorId.get(id)?.i ?? -1),
    filas: visibles
      .filter((f) => (f.p.idSubcategoria && rubroPorId.has(f.p.idSubcategoria) ? f.p.idSubcategoria : "") === id)
      .sort((a, b) => (b.dif ?? -9) - (a.dif ?? -9)),
  }));
  const caros = filas.filter((f) => f.dif != null && f.dif > 0.08);
  const baratos = filas.filter((f) => f.dif != null && f.dif < -0.08);
  const parejos = filas.filter((f) => f.dif != null && Math.abs(f.dif) <= 0.08);
  const muyCaros = caros.filter((f) => (f.dif as number) > 0.5).map((f) => f.p.nombre);
  const porConfirmar = filas.reduce((t, f) => t + Object.values(f.v).filter((x) => x?.estado === "PROPUESTO").length, 0);
  const enLista = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} y ${l[l.length - 1]}` : l[0]);
  // Lo que la competencia tiene en oferta: se avisa aparte para tenerlo en cuenta al comparar (Gonzalo, 2026-10-29).
  const conOferta = filas
    .map((f) => ({ f, de: (Object.keys(f.v) as Comercio[]).filter((c) => f.v[c]?.item?.precioAntes) }))
    .filter((x) => x.de.length > 0);

  return (
    <div className="pr-comp">
      <div className="pr-comp-cab">
        <p>
          Todo de Mendoza: {COMERCIOS.map((c) => c.nombre).join(", ")}. Leído el <b>{fechaHora(datos.leidaEl)}</b> · se lee solo cada lunes.
          {porConfirmar > 0 && <> · <b>{porConfirmar}</b> equivalentes para confirmar.</>}
        </p>
        <button type="button" className="pr-btn chico" onClick={actualizar} disabled={pendiente}>
          {pendiente ? "Leyendo…" : "Actualizar ahora"}
        </button>
      </div>

      {muyCaros.length > 0 && (
        <p className="pr-alerta-comp">
          <b>{enLista(muyCaros)}: más de 50% arriba.</b> Seguramente tienen el margen mal cargado: abrilos en la Lista de precios y revisalo.
        </p>
      )}

      {conOferta.length > 0 && (
        <div className="pr-alerta-oferta">
          <b>
            🏷️ La competencia tiene {conOferta.length === 1 ? "1 producto tuyo" : `${conOferta.length} productos tuyos`} en oferta
          </b>
          <ul>
            {conOferta.map(({ f, de }) => (
              <li key={f.p.id}>
                <button type="button" onClick={() => setAbierto(f.p.id)}>
                  {f.p.nombre}
                </button>
                {": "}
                {de
                  .map((c) => {
                    const it = f.v[c]!.item!;
                    const a = f.p.gramos ? precioATuTamano(it, f.p.gramos, esCerrado(f.p)) : null;
                    return `${nombreDe(c)} a ${pesos(a)} a tus ${f.p.gramos ?? "?"} g${it.nota ? ` (${it.nota})` : ""}`;
                  })
                  .join(" · ")}
              </li>
            ))}
          </ul>
          <small>La comparación de más caro / más barato es contra su precio normal: la oferta puede ser algo por vencer o de pocos días.</small>
        </div>
      )}

      <section className="pr-kpis" aria-label="Resumen contra la competencia">
        <div className="pr-kpi mal"><span>Más caro</span><b>{caros.length}</b><small>más de 8% arriba</small></div>
        <div className="pr-kpi ojo"><span>Parejo</span><b>{parejos.length}</b><small>dentro de ±8%</small></div>
        <div className="pr-kpi ok"><span>Más barato</span><b>{baratos.length}</b><small>margen para subir</small></div>
        <div className="pr-kpi azul"><span>Sin comparar</span><b>{filas.filter((f) => f.dif == null).length}</b><small>nadie lo vende igual, o sin precio</small></div>
      </section>

      <section className="pr-tarjeta" style={{ padding: 0 }}>
        <div className="pr-filtros pr-comp-buscar">
          <input
            id="buscar-competencia"
            type="search"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar producto (ej: almendra, maní)"
            aria-label="Buscar producto en la competencia"
          />
          {q && (
            <span className="info">
              {visibles.length} de {filas.length}
            </span>
          )}
        </div>
        <div className="pr-env">
          <table className="pr-tabla pr-tabla-comp">
            <thead>
              <tr>
                <th>Tu producto</th>
                <th>Tu precio</th>
                {columnas.map((c) => <th key={c.clave}>{c.nombre}</th>)}
                <th>Contra la competencia</th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={3 + columnas.length} className="pr-tenue" style={{ padding: "18px 14px" }}>
                    Ningún producto coincide con “{buscar.trim()}”.
                  </td>
                </tr>
              )}
              {grupos.flatMap((g) => {
                const [rc, rt, ro] = g.color;
                const nCaros = g.filas.filter((f) => f.dif != null && f.dif > 0.08).length;
                const nParejos = g.filas.filter((f) => f.dif != null && Math.abs(f.dif) <= 0.08).length;
                const nBaratos = g.filas.filter((f) => f.dif != null && f.dif < -0.08).length;
                const cab = (
                  <tr key={`g-${g.id}`} className="pr-comp-grupo" style={{ "--rc": rc, "--rt": rt, "--ro": ro } as CSSProperties}>
                    <td colSpan={3 + columnas.length}>
                      <span className="nom">{g.titulo}</span>
                      <span className="cuantos">
                        {g.filas.length} {g.filas.length === 1 ? "producto" : "productos"}
                      </span>
                      {nCaros > 0 && <span className="pr-dif caro">{nCaros} más caro{nCaros === 1 ? "" : "s"}</span>}
                      {nParejos > 0 && <span className="pr-dif parejo">{nParejos} parejo{nParejos === 1 ? "" : "s"}</span>}
                      {nBaratos > 0 && <span className="pr-dif barato">{nBaratos} más barato{nBaratos === 1 ? "" : "s"}</span>}
                    </td>
                  </tr>
                );
                return [cab, ...g.filas.flatMap((f) => {
                  const abiertaEsta = abierto === f.p.id;
                  const fila = (
                    <tr key={f.p.id} className={`fila${abiertaEsta ? " abierta" : ""}`} onClick={() => setAbierto(abiertaEsta ? null : f.p.id)}>
                      <td className="pr-prod">
                        <b>
                          {f.p.nombre}
                          {props.marcasFabrica?.[f.p.id] && <span style={{ fontWeight: 500, color: "var(--tinta-3)" }}> ({props.marcasFabrica[f.p.id]})</span>}
                        </b>
                        <small>{Object.keys(f.v).length} comercios de Mendoza</small>
                      </td>
                      <td className="n" style={{ fontSize: 15 }}>{f.p.precioHoy ? pesos(f.p.precioHoy) : <span className="pr-sinprecio">Sin precio</span>}</td>
                      {columnas.map((c) => {
                        const x = f.v[c.clave];
                        return (
                          // Lo que ya confirmaste (✓) queda en verde: así se ve qué falta revisar (Gonzalo, 2026-11-05).
                          <td key={c.clave} className={x?.item && x.estado === "CONFIRMADO" ? "pr-comp-ok" : undefined}>
                            {x?.item ? (
                              <span className="pr-comp-celda">
                                {otroTamano(x.item, f.p) ? (
                                  <span className="pr-tenue" title="Lo tuyo viene cerrado: se compara solo con el mismo tamaño">otro tamaño</span>
                                ) : (
                                  <span className="n">{pesos(conPrecio(x, f.p))}</span>
                                )}
                                <Oferta it={x.item} g={f.p.gramos} cerrado={esCerrado(f.p)} />
                                <small>
                                  {x.item.nombre}
                                  {x.item.porKilo ? " · por kilo" : ""}
                                  {x.estado === "PROPUESTO" ? " · sin confirmar" : ""}
                                </small>
                                {x.estado === "CONFIRMADO" && <span className="pr-comp-visto">✓ confirmado</span>}
                              </span>
                            ) : f.sinIgual.includes(c.clave) ? (
                              // «No lo trabaja» (Gonzalo, 2026-11-07), y se puede sacar.
                              <span className="pr-comp-celda" onClick={(e) => e.stopPropagation()}>
                                <span className="pr-tenue">No lo trabaja</span>
                                <button type="button" className="pr-comp-otro" disabled={pendiente} onClick={() => deshacer(f.p.id, c.clave)}>
                                  deshacer
                                </button>
                              </span>
                            ) : (
                              <span className="pr-comp-celda" onClick={(e) => e.stopPropagation()}>
                                <span className="pr-tenue">—</span>
                                <button type="button" className="pr-comp-otro no" disabled={pendiente} onClick={() => quitar(f.p.id, c.clave)}>
                                  No lo trabaja
                                </button>
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td>
                        {chip(f.dif)}
                        {f.contra && f.dif != null && <small className="pr-comp-contra">contra {nombreDe(f.contra)}</small>}
                        {(Object.keys(f.v) as Comercio[]).some((c) => f.v[c]?.item?.precioAntes) && <span className="pr-comp-chip oferta">🏷️ hay oferta</span>}
                      </td>
                    </tr>
                  );
                  if (!abiertaEsta) return [fila];
                  return [fila, (
                    <tr key={`${f.p.id}-d`} className="detalle">
                      <td colSpan={3 + columnas.length}>
                        <Detalle
                          f={f}
                          responder={responder}
                          quitar={quitar}
                          pendiente={pendiente}
                          margenPara={props.margenPara}
                          llevarA={props.llevarA}
                          minimo={props.minimo}
                          avisar={props.avisar}
                          alElegir={() => router.refresh()}
                        />
                      </td>
                    </tr>
                  )];
                })];
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/**
 * «Elegir otro» / «Buscar en …» (Gonzalo, 2026-11-06: «que me muestre las
 * opciones o que yo pueda elegirla directamente»). Arranca con lo más parecido
 * de ese comercio, sin las reglas estrictas; con el buscador se escribe lo que
 * sea. «Es este» lo deja confirmado.
 */
function ElegirEquivalente({
  idProducto,
  comercio,
  nombreComercio,
  gramos,
  cerrado,
  onCerrar,
  onElegido,
  avisar,
}: {
  idProducto: string;
  comercio: Comercio;
  nombreComercio: string;
  gramos: number | null;
  cerrado: boolean;
  onCerrar: () => void;
  onElegido: () => void;
  avisar: (t: string, mal?: boolean) => void;
}) {
  const [texto, setTexto] = useState("");
  const [opciones, setOpciones] = useState<OpcionEquivalente[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pedido = useRef(0);

  // Pide las opciones; si mientras tanto escribió otra cosa, la respuesta vieja se ignora.
  function pedir(q: string) {
    const n = ++pedido.current;
    opcionesEquivalente(idProducto, comercio, q)
      .then((r) => {
        if (n !== pedido.current) return;
        if (r.error) avisar(r.error, true);
        setOpciones(r.opciones ?? []);
      })
      .catch(() => n === pedido.current && avisar("No se pudo buscar. Revisá la conexión.", true))
      .finally(() => n === pedido.current && setCargando(false));
  }
  // Al abrir, lo más parecido, sin esperar a que escriba.
  useEffect(() => {
    pedir("");
    return () => {
      if (espera.current) clearTimeout(espera.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idProducto, comercio]);

  function escribir(q: string) {
    setTexto(q);
    setCargando(true);
    if (espera.current) clearTimeout(espera.current);
    espera.current = setTimeout(() => pedir(q), 350);
  }

  function elegir(o: OpcionEquivalente) {
    setGuardando(o.id);
    elegirEquivalente(idProducto, comercio, o.id)
      .then((r) => (r.error ? avisar(r.error, true) : onElegido()))
      .catch(() => avisar("No se pudo guardar.", true))
      .finally(() => setGuardando(null));
  }

  const tamano = (o: OpcionEquivalente) => (o.gramos >= 1000 ? (o.gramos === 1000 ? "1 kg" : `${(o.gramos / 1000).toLocaleString("es-AR")} kg`) : `${o.gramos} g`);
  return (
    <div className="pr-elegir" onClick={(e) => e.stopPropagation()}>
      <div className="pr-elegir-cab">
        <input
          type="search"
          value={texto}
          onChange={(e) => escribir(e.target.value)}
          placeholder={`Buscar en ${nombreComercio} (ej: nuez brasil)`}
          aria-label={`Buscar en ${nombreComercio}`}
          autoFocus
        />
        <button type="button" className="pr-btn chico" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
      <p className="pr-tenue pr-elegir-ayuda">{texto.trim() ? `Lo que tiene esas palabras en ${nombreComercio}` : `Lo más parecido de ${nombreComercio}. Si no está, escribí cómo lo llaman ellos.`}</p>
      {cargando && opciones === null ? (
        <p className="pr-tenue">Buscando…</p>
      ) : opciones && opciones.length === 0 ? (
        <p className="pr-tenue">No encontré nada{texto.trim() ? ` con «${texto.trim()}»` : " parecido"}. Probá con otra palabra.</p>
      ) : (
        <ul className={`pr-elegir-lista${cargando ? " cargando" : ""}`}>
          {(opciones ?? []).map((o) => (
            <li key={o.id} className={o.elegido ? "elegido" : undefined}>
              <span className="nom">
                {o.url ? (
                  <a href={o.url} target="_blank" rel="noopener noreferrer">
                    {o.nombre} ↗
                  </a>
                ) : (
                  o.nombre
                )}
                <small>
                  {pesos(o.precioAntes ?? o.precio)} {o.porKilo ? "el kg" : `por ${tamano(o)}`}
                  {o.precioAntes ? " · en oferta" : ""}
                  {!o.disponible ? " · agotado" : ""}
                  {o.descartado ? " · lo descartaste" : ""}
                </small>
              </span>
              <span className="n">
                {o.aTuTamano == null && cerrado ? <span className="pr-tenue">otro tamaño</span> : pesos(o.aTuTamano)}
                <small>{cerrado ? `tuyo: ${legible(gramos)} cerrado` : `a tus ${gramos ?? "?"} g`}</small>
              </span>
              {o.elegido ? (
                <span className="pr-comp-visto">✓ el elegido</span>
              ) : (
                <button type="button" className="pr-btn prim chico" disabled={guardando !== null} onClick={() => elegir(o)}>
                  {guardando === o.id ? "Guardando…" : "Es este"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "oferta $2.160 · VENCE 4 NOV": el precio de oferta llevado a tu tamaño, si hay. */
function Oferta({ it, g, cerrado }: { it: ItemCompetencia; g: number | null; cerrado: boolean }) {
  if (!it.precioAntes || !g) return null;
  const a = precioATuTamano(it, g, cerrado);
  if (a == null) return null;
  return (
    <span className="pr-comp-oferta">
      oferta {pesos(a)}
      {it.nota ? ` · ${it.nota}` : ""}
    </span>
  );
}

function Detalle({
  f,
  responder,
  pendiente,
  margenPara,
  llevarA,
  minimo,
  avisar,
  alElegir,
  quitar,
}: {
  f: Fila;
  responder: (id: string, c: Comercio, si: boolean) => void;
  quitar: (id: string, c: Comercio) => void;
  pendiente: boolean;
  avisar: (t: string, mal?: boolean) => void;
  alElegir: () => void;
} & Llevar) {
  const g = f.p.gramos;
  const cerrado = esCerrado(f.p);
  const lista = COMERCIOS.filter((c) => f.v[c.clave]?.item);
  // Los que figuran con «—»: se puede buscar a mano (Gonzalo, 2026-11-06).
  const sinEquivalente = COMERCIOS.filter((c) => !f.v[c.clave]?.item);
  const [eligiendo, setEligiendo] = useState<Comercio | null>(null);
  const todos = [{ q: "Vos", v: f.p.precioHoy ?? 0, yo: true }, ...lista.map((c) => ({ q: c.nombre, v: g ? precioNormalATuTamano(f.v[c.clave]!.item!, g, cerrado) ?? 0 : 0, yo: false }))].filter((t) => t.v > 0);
  const max = Math.max(1, ...todos.map((t) => t.v));
  const ref = f.contra && g ? precioNormalATuTamano(f.v[f.contra]!.item!, g, cerrado) : null;
  const tope = ref ? Math.floor((ref * 0.98) / 100) * 100 : null;
  return (
    <div className="pr-det pr-det-comp">
      <div className="pr-caja">
        <h3>Lo que encontró el sistema · {f.p.nombre}</h3>
        {lista.length === 0 && <p className="pr-tenue">Ningún comercio de Mendoza vende algo igual (todavía).</p>}
        {lista.map((c) => {
          const x = f.v[c.clave]!;
          const it = x.item!;
          return (
            <div className="pr-comp-rival" key={c.clave}>
              <div>
                <b>{c.nombre}</b>
                {it.porKilo && <span className="pr-comp-chip kilo">por kilo</span>}
                {!it.disponible && <span className="pr-comp-chip gris">agotado</span>}
                <div className="pr-tenue" style={{ fontSize: 12.5 }}>
                  {it.url ? (
                    <a className="pr-comp-link" href={it.url} target="_blank" rel="noopener noreferrer">{it.nombre} ↗</a>
                  ) : (
                    it.nombre
                  )}{" "}
                  · {pesos(it.precioAntes ?? it.precio)} {it.gramos && it.gramos >= 1000 ? (it.gramos === 1000 ? "el kg" : `por ${it.gramos / 1000} kg`) : `por ${it.gramos} g`} · {c.tipo}
                </div>
                {it.precioAntes && (
                  <div className="pr-comp-oferta" style={{ fontSize: 12.5 }}>
                    En oferta a {pesos(it.precio)} ({Math.round((1 - it.precio / it.precioAntes) * 100)}% menos){it.nota ? ` · ${it.nota}` : ""}
                  </div>
                )}
                {x.estado === "PROPUESTO" && (
                  <div className="pr-comp-preg">
                    ¿Es el mismo producto que el tuyo?
                    {it.url && (
                      <a className="ver" href={it.url} target="_blank" rel="noopener noreferrer">Ver en {c.nombre} ↗</a>
                    )}
                    <button type="button" className="si" disabled={pendiente} onClick={() => responder(f.p.id, c.clave, true)}>✓ Sí</button>
                    <button type="button" disabled={pendiente} onClick={() => responder(f.p.id, c.clave, false)}>✗ No</button>
                  </div>
                )}
                {eligiendo === c.clave ? (
                  <ElegirEquivalente
                    idProducto={f.p.id}
                    comercio={c.clave}
                    nombreComercio={c.nombre}
                    gramos={g}
                    cerrado={cerrado}
                    onCerrar={() => setEligiendo(null)}
                    onElegido={() => {
                      setEligiendo(null);
                      avisar(`Listo: quedó confirmado el de ${c.nombre}.`);
                      alElegir();
                    }}
                    avisar={avisar}
                  />
                ) : (
                  <>
                    {/* Para deshacer un vínculo mal hecho (Gonzalo, 2026-11-06: «ponerlo o sacarlo»). */}
                    <button type="button" className="pr-comp-otro no" disabled={pendiente} onClick={() => quitar(f.p.id, c.clave)}>
                      ✕ No lo trabaja
                    </button>
                    <button type="button" className="pr-comp-otro" onClick={() => setEligiendo(c.clave)}>
                      Elegir otro de {c.nombre}
                    </button>
                  </>
                )}
              </div>
              {otroTamano(it, f.p) ? (
                <div className="pr-comp-tu">
                  <span className="pr-tenue">Otro tamaño</span>
                  <small>
                    Lo tuyo viene cerrado de {legible(g)}: se compara solo con el mismo tamaño. Si tienen el de {legible(g)}, elegilo con «Elegir otro».
                  </small>
                </div>
              ) : (
                <div className="pr-comp-tu n">
                  {pesos(g ? precioNormalATuTamano(it, g, cerrado) : null)}
                  <small>{cerrado ? `mismo tamaño (${legible(g)})` : `a tus ${g ?? "?"} g`}</small>
                  {it.precioAntes && g && <small className="pr-comp-oferta">oferta {pesos(precioATuTamano(it, g, cerrado))}</small>}
                </div>
              )}
            </div>
          );
        })}
        {sinEquivalente.length > 0 && (
          <div className="pr-comp-buscar-en">
            <span className="pr-tenue">
              Sin vincular en {sinEquivalente.map((c) => `${c.nombre}${f.sinIgual.includes(c.clave) ? " (no lo trabaja)" : ""}`).join(", ")}. Si vos sabés que lo tienen:
            </span>
            <div>
              {sinEquivalente.map((c) => (
                <button key={c.clave} type="button" className={`pr-comp-otro${eligiendo === c.clave ? " on" : ""}`} onClick={() => setEligiendo(eligiendo === c.clave ? null : c.clave)}>
                  Buscar en {c.nombre}
                </button>
              ))}
            </div>
            {eligiendo && sinEquivalente.some((c) => c.clave === eligiendo) && (
              <ElegirEquivalente
                key={eligiendo}
                idProducto={f.p.id}
                comercio={eligiendo}
                nombreComercio={nombreDe(eligiendo)}
                gramos={g}
                cerrado={cerrado}
                onCerrar={() => setEligiendo(null)}
                onElegido={() => {
                  const quien = nombreDe(eligiendo);
                  setEligiendo(null);
                  avisar(`Listo: quedó confirmado el de ${quien}.`);
                  alElegir();
                }}
                avisar={avisar}
              />
            )}
          </div>
        )}
      </div>
      <div className="pr-caja">
        <h3>Cuánto salen {g ?? "?"} g en cada lado</h3>
        <div className="pr-comp-barras">
          {todos
            .sort((a, b) => a.v - b.v)
            .map((t) => (
              <div key={t.q} className={`pr-comp-barra${t.yo ? " yo" : ""}`}>
                <span>{t.q}</span>
                <span className="t"><i style={{ width: `${Math.max(4, (t.v / max) * 100)}%` }} /></span>
                <span className="n">{pesos(t.v)}</span>
              </div>
            ))}
        </div>
        {f.dif != null && tope != null && (
          f.dif > 0.08 ? (
            <p className="pr-nota mal">Estás {Math.round(f.dif * 100)}% arriba de {nombreDe(f.contra as Comercio)}. Para quedar parejo, el precio sería {pesos(tope)}.</p>
          ) : f.dif < -0.08 ? (
            <p className="pr-nota ok">Estás {Math.round(-f.dif * 100)}% abajo de {nombreDe(f.contra as Comercio)}. Podrías llevarlo a {pesos(tope)} y seguir más barato: son {pesos(tope - (f.p.precioHoy ?? 0))} más por unidad.</p>
          ) : (
            <p className="pr-nota ok">Estás parejo con {nombreDe(f.contra as Comercio)}.</p>
          )
        )}
        {/* La oferta, bien a la vista antes de decidir. */}
        {g &&
          lista
            .filter((c) => f.v[c.clave]?.item?.precioAntes)
            .map((c) => {
              const it = f.v[c.clave]!.item!;
              const enOferta = precioATuTamano(it, g, cerrado);
              if (enOferta == null) return null;
              const vs = f.p.precioHoy && enOferta ? diferencia(f.p.precioHoy, enOferta) : null;
              return (
                <p key={`of-${c.clave}`} className="pr-nota ojo">
                  🏷️ <b>{c.nombre} lo tiene en oferta</b> a {pesos(enOferta)} a tus {g} g (normal {pesos(precioNormalATuTamano(it, g, cerrado))}){it.nota ? `, ${it.nota}` : ""}.
                  {vs != null && ` Contra la oferta estás ${Math.round(Math.abs(vs) * 100)}% ${vs > 0 ? "arriba" : "abajo"}.`}
                </p>
              );
            })}
        {/* Un botón que pone el margen que da ese precio; el efectivo sigue solo con su descuento. */}
        {f.dif != null && tope != null && Math.abs(f.dif) > 0.08 && tope !== f.p.precioHoy && (() => {
          const m = margenPara(f.p.id, tope);
          if (m == null || m <= 0) return <p className="pr-nota mal">A {pesos(tope)} no se cubre el costo: no conviene bajarlo tanto.</p>;
          const bajo = m / 100 < minimo;
          return (
            <div className="pr-comp-llevar">
              <button type="button" className="pr-btn prim" onClick={() => llevarA(f.p.id, tope)}>
                Llevarlo a {pesos(tope)}
              </button>
              <span className={bajo ? "mal" : ""}>
                Queda con margen <b>{m.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %</b> con tarjeta
                {bajo ? ", debajo del mínimo" : ""}. El efectivo sigue con su descuento.
              </span>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
