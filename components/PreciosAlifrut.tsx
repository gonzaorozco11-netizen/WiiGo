"use client";

import { useMemo, useState } from "react";
import { calcularPrecio, costoPorKg, type ConfigPrecios, type Envase, type Granel } from "@/lib/calculoPrecio";
import type { GranelDelModulo, ProductoDelModulo, RubroDelModulo } from "@/lib/datosPrecios";
import { granelDesdeItem, type EstadoAlifrut, type ItemCatalogo } from "@/lib/catalogoProveedor";
import { normalizar, type UnidadLista } from "@/lib/listaAlifrut";
import { aplicarCambiosAlifrut, guardarUnidadItem, importarListaAlifrut, vincularItem, type ResumenLista } from "@/app/(app)/precios/alifrut-actions";

// La lista exclusiva de Alifrut adentro de Precios (Gonzalo, 2026-10-29).
// Lo que cambia la base recarga la página al cerrar la ventana: son cosas de
// una vez por día y así todo lo de abajo (lista, costos) queda al día.

const pesos = (n: number | null | undefined, dec = 0) =>
  n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
const pctCambio = (nuevo: number, viejo: number) => {
  const v = (nuevo / viejo - 1) * 100;
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;
};
const fechaCorta = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) : "—");
const DIA = 86400000;

export type Pendiente = {
  granel: GranelDelModulo;
  item: ItemCatalogo;
  nuevo: Omit<Granel, "id">;
  afectados: { p: ProductoDelModulo; antes: number | null; despues: number | null }[];
};

/** Lo que Alifrut cambió y todavía no se pasó a lo que usa WiiGo, con el precio que daría cada producto. */
export function calcularPendientes(
  items: ItemCatalogo[],
  granel: GranelDelModulo[],
  productos: ProductoDelModulo[],
  cfg: ConfigPrecios,
  envases: Map<string, Envase>,
  conRubro: (p: ProductoDelModulo) => ProductoDelModulo
): Pendiente[] {
  const porId = new Map(items.map((i) => [i.id, i]));
  const salida: Pendiente[] = [];
  for (const g of granel) {
    const item = g.idItem ? porId.get(g.idItem) : undefined;
    if (!item) continue;
    const nuevo = granelDesdeItem({ costo_neto: item.costo, unidad: item.unidad, cantidad: item.cantidad, nombre: g.nombre });
    if (Math.abs(nuevo.costo - g.costo) < 0.01 && nuevo.unidad === g.unidad && (nuevo.kgBulto ?? null) === (g.kgBulto ?? null)) continue;
    const mapa = new Map<string, Granel>([[g.id, { ...nuevo, id: g.id }]]);
    const afectados = productos
      .filter((p) => p.idGranel === g.id)
      .map((p) => {
        const r = calcularPrecio(conRubro(p), cfg, mapa, envases);
        return { p, antes: p.precioHoy, despues: r.ok ? r.publico : null };
      });
    salida.push({ granel: g, item, nuevo, afectados });
  }
  return salida;
}

// ---------- Aviso de arriba ----------

export function AvisoAlifrut(props: { estado: EstadoAlifrut; pendientes: Pendiente[]; onCambios: () => void; onTraer: () => void }) {
  const { estado, pendientes } = props;
  const productos = new Set(pendientes.flatMap((x) => x.afectados.filter((a) => a.antes).map((a) => a.p.id))).size;
  const traida = estado.traidaEl ? new Date(estado.traidaEl).getTime() : 0;
  const huella = estado.huellaCambioEl ? new Date(estado.huellaCambioEl).getTime() : 0;
  // "Ahora", tomado una vez al abrir la pantalla.
  const [ahora] = useState(() => Date.now());

  let aviso: React.ReactNode = null;
  if (pendientes.length) {
    const suben = pendientes.filter((x) => x.nuevo.costo > x.granel.costo).length;
    aviso = (
      <div className="pr-alerta">
        <div>
          <b>Alifrut cambió {pendientes.length === 1 ? "1 costo" : `${pendientes.length} costos`} de lo que vendés</b>
          <small>
            {suben ? `${suben} ${suben === 1 ? "subió" : "subieron"}` : ""}
            {suben && pendientes.length - suben ? " y " : ""}
            {pendientes.length - suben ? `${pendientes.length - suben} ${pendientes.length - suben === 1 ? "bajó" : "bajaron"}` : ""}
            {productos ? `. Mueven el precio de ${productos === 1 ? "1 producto tuyo" : `${productos} productos tuyos`}.` : "."}
          </small>
        </div>
        <button type="button" className="pr-btn ojo" onClick={props.onCambios}>
          Ver cambios y actualizar
        </button>
      </div>
    );
  } else if (!traida) {
    aviso = (
      <div className="pr-alerta suave">
        <div>
          <b>Traé tu lista de Alifrut</b>
          <small>Con tus precios cargados, el sistema te avisa cada vez que algo sube o baja.</small>
        </div>
        <button type="button" className="pr-btn prim" onClick={props.onTraer}>
          Traer mis precios
        </button>
      </div>
    );
  } else if (huella > traida || ahora - traida > 7 * DIA) {
    aviso = (
      <div className="pr-alerta suave">
        <div>
          <b>{huella > traida ? `Alifrut actualizó su lista el ${fechaCorta(estado.huellaCambioEl)}` : `Tu lista de Alifrut es del ${fechaCorta(estado.listaDel)}`}</b>
          <small>Traé tus precios para ver si cambió algo de lo que vendés.</small>
        </div>
        <button type="button" className="pr-btn prim" onClick={props.onTraer}>
          Traer mis precios
        </button>
      </div>
    );
  }
  return (
    <>
      {aviso}
      <p className="pr-estado">
        <span>
          <i className={traida && ahora - traida < 2 * DIA ? "ok" : "ojo"} />
          Tu lista de Alifrut: {traida ? `del ${fechaCorta(estado.listaDel)}, traída el ${fechaCorta(estado.traidaEl)}` : "todavía no la trajiste"}
        </span>
        {huella > 0 && (
          <span>
            <i className="ok" />
            Alifrut cambió algo por última vez el {fechaCorta(estado.huellaCambioEl)} (se revisa solo cada mañana)
          </span>
        )}
      </p>
    </>
  );
}

// ---------- Traer mis precios ----------

export function TraerLista({ onCerrar }: { onCerrar: (recargar: boolean) => void }) {
  const [texto, setTexto] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<ResumenLista | null>(null);

  async function leer(t: string) {
    if (!t.trim()) return;
    setLeyendo(true);
    setError(null);
    const r = await importarListaAlifrut(t).catch(() => ({ error: "No se pudo leer. Revisá la conexión y probá de nuevo.", resumen: undefined }));
    setLeyendo(false);
    if (r.error) setError(r.error);
    else setResumen(r.resumen ?? null);
  }

  return (
    <Modal titulo="Traer mis precios de Alifrut" bajada="Tus precios son solo tuyos: hasta que Alifrut te pase un link privado, se traen así." onCerrar={() => onCerrar(Boolean(resumen))}>
      <div className="pr-m-cuerpo">
        <ol className="pr-m-pasos">
          <li>
            Entrá a{" "}
            <a href="https://www.alifrut-distribuidora.com.ar/productos" target="_blank" rel="noreferrer">
              alifrut-distribuidora.com.ar
            </a>{" "}
            con tu usuario y abrí <b>Lista de precios</b>.
          </li>
          <li>
            Apretá <b>Ctrl+A</b> y después <b>Ctrl+C</b>.
          </li>
          <li>
            Volvé acá y pegá con <b>Ctrl+V</b> en el recuadro. Se lee solo.
          </li>
        </ol>
        <textarea
          id="pr-lista-alifrut"
          className="pr-pegar"
          value={texto}
          placeholder="Pegá acá tu lista de Alifrut"
          aria-label="Pegá acá tu lista de Alifrut"
          onChange={(e) => setTexto(e.target.value)}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            setTimeout(() => leer(t), 0);
          }}
          disabled={leyendo}
        />
        {leyendo && <p className="pr-nota">Leyendo la lista…</p>}
        {error && <p className="pr-nota mal">{error}</p>}
        {resumen && (
          <p className="pr-nota ok">
            Leí {resumen.leidos} productos de tu lista{resumen.fecha ? ` del ${fechaCorta(resumen.fecha)}` : ""}.{" "}
            {resumen.cambiaron ? `Cambiaron ${resumen.cambiaron} costos${resumen.cambiaronQueUsas ? `, ${resumen.cambiaronQueUsas} de lo que vendés` : ", ninguno de lo que vendés"}.` : "No cambió ningún costo."}
            {resumen.nuevos ? ` Hay ${resumen.nuevos} productos nuevos.` : ""}
          </p>
        )}
      </div>
      <footer className="pr-m-pie">
        {!resumen && (
          <button type="button" className="pr-btn" disabled={leyendo || !texto.trim()} onClick={() => leer(texto)}>
            Leer lo pegado
          </button>
        )}
        <button type="button" className="pr-btn prim" onClick={() => onCerrar(Boolean(resumen))}>
          {resumen ? "Listo" : "Cerrar"}
        </button>
      </footer>
    </Modal>
  );
}

// ---------- Ver cambios y actualizar ----------

export function CambiosAlifrut({ pendientes, onCerrar }: { pendientes: Pendiente[]; onCerrar: (recargar: boolean) => void }) {
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(pendientes.map((x) => x.granel.id)));
  const [pasando, setPasando] = useState(false);
  const [resultado, setResultado] = useState<{ texto: string; mal?: boolean } | null>(null);

  async function aplicar() {
    setPasando(true);
    const r = await aplicarCambiosAlifrut([...elegidos]).catch(() => ({ error: "No se pudo actualizar. Revisá la conexión.", costos: 0, precios: 0 }));
    setPasando(false);
    setResultado(
      r.error
        ? { texto: r.error, mal: true }
        : { texto: `Listo: ${r.costos === 1 ? "1 costo actualizado" : `${r.costos} costos actualizados`} y ${r.precios === 1 ? "1 precio nuevo" : `${r.precios} precios nuevos`} en la caja, el tótem y la pantalla asesora. Te quedaron las tareas de cambiar los carteles.` }
    );
  }

  return (
    <Modal titulo="Cambios de Alifrut" bajada="Tildá lo que querés actualizar. Se cambia el costo, se recalcula el precio de cada tamaño y pasa a la venta." onCerrar={() => onCerrar(Boolean(resultado && !resultado.mal))}>
      {pendientes.map((x) => (
        <div className="pr-m-cambio" key={x.granel.id}>
          <label className="tit">
            <input
              type="checkbox"
              id={`pr-cambio-${x.granel.id}`}
              checked={elegidos.has(x.granel.id)}
              disabled={Boolean(resultado)}
              onChange={(e) =>
                setElegidos((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.add(x.granel.id);
                  else n.delete(x.granel.id);
                  return n;
                })
              }
            />
            <b>{x.item.nombre}</b>
            <span className="n pr-tenue">
              {pesos(x.granel.costo, 2)} → {pesos(x.nuevo.costo, 2)}
            </span>
            <span className={`pr-delta ${x.nuevo.costo > x.granel.costo ? "sube" : "baja"}`}>{pctCambio(x.nuevo.costo, x.granel.costo)}</span>
          </label>
          <div className="afecta">
            {x.afectados.length === 0 && <span className="pr-tenue">Todavía no lo usa ningún producto.</span>}
            {x.afectados.map((a) => (
              <div key={a.p.id}>
                <span>{a.p.nombre}</span>
                {a.antes ? (
                  <span className="n">
                    {pesos(a.antes)} → {pesos(a.despues)}
                  </span>
                ) : (
                  <span className="pr-sinprecio">Sin precio: no se pasa solo</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {resultado && <p className={`pr-nota ${resultado.mal ? "mal" : "ok"}`} style={{ margin: "12px 20px 0" }}>{resultado.texto}</p>}
      <footer className="pr-m-pie">
        <button type="button" className="pr-btn" onClick={() => onCerrar(Boolean(resultado && !resultado.mal))}>
          {resultado ? "Cerrar" : "Ahora no"}
        </button>
        {!resultado && (
          <button type="button" className="pr-btn prim" disabled={pasando || elegidos.size === 0} onClick={aplicar}>
            {pasando ? "Actualizando…" : "Actualizar y pasar a la venta"}
          </button>
        )}
      </footer>
    </Modal>
  );
}

// ---------- Pestaña Productos Alifrut ----------

const NOMBRE_UNIDAD: Record<UnidadLista, string> = { KG: "por kg", BOLSA: "bolsa", CAJA: "caja", UNIDAD: "de a una" };

export function CatalogoAlifrut(props: {
  items: ItemCatalogo[];
  estado: EstadoAlifrut;
  granel: GranelDelModulo[];
  productos: ProductoDelModulo[];
  rubros: RubroDelModulo[];
  envases: Envase[];
  avisar: (t: string, mal?: boolean) => void;
  onTraer: () => void;
}) {
  const [items, setItems] = useState(props.items);
  const [cat, setCat] = useState<string>("*");
  const [buscar, setBuscar] = useState("");
  const [vinculando, setVinculando] = useState<ItemCatalogo | null>(null);
  const [ahora] = useState(() => Date.now());

  const usosPorItem = useMemo(() => {
    const m = new Map<string, ProductoDelModulo[]>();
    for (const g of props.granel) {
      if (!g.idItem) continue;
      const lista = m.get(g.idItem) ?? [];
      lista.push(...props.productos.filter((p) => p.idGranel === g.id));
      m.set(g.idItem, lista);
    }
    return m;
  }, [props.granel, props.productos]);

  const traida = props.estado.traidaEl ? new Date(props.estado.traidaEl).getTime() : 0;
  const yaNoEsta = (i: ItemCatalogo) => traida > 0 && new Date(i.vistoEl).getTime() < traida - 60000;
  const cambioReciente = (i: ItemCatalogo) => i.costoAnterior != null && i.cambioEl != null && ahora - new Date(i.cambioEl).getTime() < 30 * DIA;

  const categorias = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.categoria ?? "Sin categoría", (m.get(i.categoria ?? "Sin categoría") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  }, [items]);

  const q = normalizar(buscar);
  const filas = items.filter((i) => {
    if (cat === "uso" && !usosPorItem.get(i.id)?.length) return false;
    if (cat === "cambio" && !cambioReciente(i)) return false;
    if (cat !== "*" && cat !== "uso" && cat !== "cambio" && (i.categoria ?? "Sin categoría") !== cat) return false;
    return !q || normalizar(`${i.nombre} ${i.marca ?? ""}`).includes(q);
  });

  async function cambiarUnidad(i: ItemCatalogo, unidad: UnidadLista, cantidad: number) {
    setItems((xs) => xs.map((x) => (x.id === i.id ? { ...x, unidad, cantidad, revisada: true } : x)));
    const r = await guardarUnidadItem(i.id, unidad, cantidad).catch(() => ({ error: "No se pudo guardar. Revisá la conexión." }));
    props.avisar(r.error ?? "Guardado", Boolean(r.error));
  }

  if (!items.length) {
    return (
      <section className="pr-tarjeta pr-vacio">
        <h2>Todavía no trajiste tu lista de Alifrut</h2>
        <p className="baj">La traés una vez y quedan acá todos sus productos, con tus precios, por categoría.</p>
        <button type="button" className="pr-btn prim" onClick={props.onTraer}>
          Traer mis precios
        </button>
      </section>
    );
  }

  return (
    <div className="pr-cat">
      <nav className="pr-tarjeta pr-cats" aria-label="Categorías de Alifrut">
        <button type="button" aria-pressed={cat === "*"} onClick={() => setCat("*")}>
          Todas<span>{items.length}</span>
        </button>
        <button type="button" aria-pressed={cat === "uso"} onClick={() => setCat("uso")}>
          Los que uso<span>{items.filter((i) => usosPorItem.get(i.id)?.length).length}</span>
        </button>
        <button type="button" aria-pressed={cat === "cambio"} onClick={() => setCat("cambio")}>
          Cambiaron este mes<span>{items.filter(cambioReciente).length}</span>
        </button>
        <hr />
        {categorias.map(([c, n]) => (
          <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>
            {c}
            <span>{n}</span>
          </button>
        ))}
      </nav>
      <section className="pr-tarjeta" style={{ padding: 0, minWidth: 0 }}>
        <div className="pr-cat-filtros">
          <input id="pr-buscar-alifrut" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar en Alifrut: almendra, granola, avena…" aria-label="Buscar en el catálogo de Alifrut" />
        </div>
        <div className="pr-env">
          <table className="pr-tabla pr-tabla-ali">
            <colgroup>
              <col />
              <col style={{ width: 146 }} />
              <col style={{ width: 116 }} />
              <col style={{ width: 134 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 124 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Producto de Alifrut</th>
                <th>Viene</th>
                <th style={{ textAlign: "right" }}>Costo sin IVA</th>
                <th style={{ textAlign: "right" }}>Por kg o c/u</th>
                <th>Cambio</th>
                <th>Lo usás en</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr>
                  <td colSpan={6} className="pr-tenue" style={{ textAlign: "center", padding: 24 }}>
                    No hay productos con ese filtro.
                  </td>
                </tr>
              )}
              {filas.map((i) => {
                const g = granelDesdeItem({ costo_neto: i.costo, unidad: i.unidad, cantidad: i.cantidad });
                const base = costoPorKg({ ...g, id: i.id });
                const usos = usosPorItem.get(i.id) ?? [];
                return (
                  <tr key={i.id} className={yaNoEsta(i) ? "pr-gris" : undefined}>
                    <td className="pr-prod">
                      <b>{i.nombre}</b>
                      <small>
                        {i.marca ? `${i.marca} · ` : ""}
                        {i.categoria ?? "Sin categoría"}
                        {yaNoEsta(i) ? " · ya no está en la lista" : ""}
                      </small>
                    </td>
                    <td>
                      <span className="pr-viene">
                        <select
                          value={i.unidad}
                          onChange={(e) => {
                            const u = e.target.value as UnidadLista;
                            cambiarUnidad(i, u, u === "KG" || u === "UNIDAD" ? 1 : i.cantidad > 1 ? i.cantidad : u === "CAJA" ? 12 : 2);
                          }}
                          aria-label={`Cómo viene ${i.nombre}`}
                        >
                          {(Object.keys(NOMBRE_UNIDAD) as UnidadLista[]).map((u) => (
                            <option key={u} value={u}>
                              {NOMBRE_UNIDAD[u]}
                            </option>
                          ))}
                        </select>
                        {(i.unidad === "BOLSA" || i.unidad === "CAJA") && (
                          <input
                            className="pr-in"
                            inputMode="decimal"
                            defaultValue={i.cantidad}
                            onBlur={(e) => {
                              const n = Number(e.target.value.replace(",", "."));
                              if (n > 0 && n !== i.cantidad) cambiarUnidad(i, i.unidad, n);
                            }}
                            aria-label={i.unidad === "CAJA" ? "Unidades de la caja" : "Kg de la bolsa"}
                          />
                        )}
                        {i.unidad === "BOLSA" && <span className="pr-tenue">kg</span>}
                        {i.unidad === "CAJA" && <span className="pr-tenue">u.</span>}
                      </span>
                      {!i.revisada && <small className="pr-falta">revisá cómo viene</small>}
                    </td>
                    <td className="n" style={{ textAlign: "right" }}>
                      {pesos(i.costo, 2)}
                    </td>
                    <td className="n" style={{ textAlign: "right" }}>
                      {pesos(base, 2)} <span className="pr-tenue">{g.unidad === "CAJA" ? "c/u" : "/kg"}</span>
                    </td>
                    <td>
                      {cambioReciente(i) ? (
                        <span className={`pr-delta ${i.costo > (i.costoAnterior as number) ? "sube" : "baja"}`} title={`Antes ${pesos(i.costoAnterior, 2)}, cambió el ${fechaCorta(i.cambioEl)}`}>
                          {pctCambio(i.costo, i.costoAnterior as number)}
                        </span>
                      ) : (
                        <span className="pr-tenue">—</span>
                      )}
                    </td>
                    <td>
                      {usos.map((p) => (
                        <span key={p.id} className="pr-vinc">
                          {p.nombre}
                        </span>
                      ))}
                      <button type="button" className="pr-btn chico" onClick={() => setVinculando(i)}>
                        {usos.length ? "+ Otro tamaño" : "Vincular"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {vinculando && (
        <Vincular
          item={vinculando}
          rubros={props.rubros}
          envases={props.envases}
          productos={props.productos.filter((p) => !usosPorItem.get(vinculando.id)?.some((u) => u.id === p.id))}
          granel={props.granel}
          onCerrar={(recargar) => (recargar ? window.location.reload() : setVinculando(null))}
        />
      )}
    </div>
  );
}

// ---------- Vincular ----------

function Vincular(props: { item: ItemCatalogo; rubros: RubroDelModulo[]; envases: Envase[]; productos: ProductoDelModulo[]; granel: GranelDelModulo[]; onCerrar: (recargar: boolean) => void }) {
  const { item } = props;
  const porUnidad = item.unidad === "CAJA" || item.unidad === "UNIDAD";
  const chica = props.envases.find((e) => /chica/i.test(e.nombre)) ?? props.envases[0];
  const grande = props.envases.find((e) => /grande/i.test(e.nombre)) ?? props.envases[props.envases.length - 1];
  const opciones = porUnidad ? [null] : [100, 200, 250, 500, 1000];
  const [tamanos, setTamanos] = useState<Map<number | null, string>>(() => new Map(porUnidad ? [[null, ""]] : []));
  const rubroParecido = props.rubros.find((r) => item.categoria && normalizar(r.nombre).includes(normalizar(item.categoria).split(" ")[0]));
  const [rubro, setRubro] = useState(rubroParecido?.id ?? "");
  const [existente, setExistente] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const r = await vincularItem(item.id, {
      tamanos: [...tamanos.entries()].map(([gramos, idEnvase]) => ({ gramos, idEnvase: idEnvase || null })),
      idSubcategoria: rubro || null,
      idProductoExistente: existente || null,
    }).catch(() => ({ error: "No se pudo guardar. Revisá la conexión.", creados: 0 }));
    setGuardando(false);
    if (r.error) return setError(r.error);
    setListo(
      `${r.creados ? `Creé ${r.creados === 1 ? "1 producto" : `${r.creados} productos`} en Productos, «Sin precio». ` : ""}${existente ? "Quedó vinculado tu producto. " : ""}Revisalos en la Lista de precios y pasalos a la venta.`
    );
  }

  return (
    <Modal titulo={`Vincular «${item.nombre}»`} bajada={porUnidad ? `Se vende de a una. Costo por unidad: ${pesos(granelDesdeItem({ costo_neto: item.costo, unidad: item.unidad, cantidad: item.cantidad }).costo / (item.unidad === "CAJA" ? item.cantidad : 1), 2)}.` : `Costo ${pesos(costoPorKg({ ...granelDesdeItem({ costo_neto: item.costo, unidad: item.unidad, cantidad: item.cantidad }), id: "" }), 2)} el kg, sin IVA.`} onCerrar={() => props.onCerrar(Boolean(listo))}>
      <div className="pr-m-cuerpo">
        <b>Crear tus tamaños</b>
        <span className="pr-tenue" style={{ fontSize: 13 }}>
          Se crean en Productos con su código de barras, «Sin precio», listos para revisar y pasar a la venta. Después les agregás foto y rótulo.
        </span>
        <div className="pr-m-tamanos">
          {opciones.map((g) => {
            const marcado = tamanos.has(g);
            const defecto = g == null ? "" : g === 1000 ? "" : g <= 250 ? chica?.id ?? "" : grande?.id ?? "";
            return (
              <div key={String(g)} className={marcado ? "sel" : undefined}>
                <label>
                  <input
                    type="checkbox"
                    id={`pr-tam-${g ?? "u"}`}
                    checked={marcado}
                    onChange={(e) =>
                      setTamanos((m) => {
                        const n = new Map(m);
                        if (e.target.checked) n.set(g, defecto);
                        else n.delete(g);
                        return n;
                      })
                    }
                  />
                  {g == null ? "Por unidad, como viene" : g >= 1000 ? "1 kg" : `${g} g`}
                </label>
                {marcado && (
                  <select value={tamanos.get(g) ?? ""} onChange={(e) => setTamanos((m) => new Map(m).set(g, e.target.value))} aria-label="Bolsita">
                    <option value="">Sin bolsita</option>
                    {props.envases.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
        {tamanos.size > 0 && (
          <label className="pr-m-campo">
            Rubro
            <select value={rubro} onChange={(e) => setRubro(e.target.value)}>
              <option value="">Sin rubro</option>
              {props.rubros.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="pr-m-campo">
          O unirlo a un producto que ya tenés
          <select value={existente} onChange={(e) => setExistente(e.target.value)}>
            <option value="">—</option>
            {props.productos.map((p) => {
              const hoy = p.idGranel ? props.granel.find((g) => g.id === p.idGranel)?.nombre : null;
              return (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {hoy ? ` · hoy sale de ${hoy}` : ""}
                </option>
              );
            })}
          </select>
        </label>
        {existente && props.productos.find((p) => p.id === existente)?.idGranel && (
          <p className="pr-nota">
            Lo cambiás de proveedor: desde ahora su costo sale de este. El stock que ya tenés se sigue vendiendo con el mismo producto y al precio nuevo.
          </p>
        )}
        {error && <p className="pr-nota mal">{error}</p>}
        {listo && <p className="pr-nota ok">{listo}</p>}
      </div>
      <footer className="pr-m-pie">
        <button type="button" className="pr-btn" onClick={() => props.onCerrar(Boolean(listo))}>
          {listo ? "Listo" : "Cancelar"}
        </button>
        {!listo && (
          <button type="button" className="pr-btn prim" disabled={guardando || (tamanos.size === 0 && !existente)} onClick={guardar}>
            {guardando ? "Guardando…" : "Vincular"}
          </button>
        )}
      </footer>
    </Modal>
  );
}

function Modal(props: { titulo: string; bajada: string; onCerrar: () => void; children: React.ReactNode }) {
  return (
    <div className="pr-fondo" onClick={(e) => e.target === e.currentTarget && props.onCerrar()} onKeyDown={(e) => e.key === "Escape" && props.onCerrar()}>
      <div className="pr-modal pr-modal-ali" role="dialog" aria-modal="true" aria-label={props.titulo}>
        <header>
          <h2>{props.titulo}</h2>
          <p>{props.bajada}</p>
        </header>
        {props.children}
      </div>
    </div>
  );
}
