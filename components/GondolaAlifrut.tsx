"use client";

import { useMemo, useState } from "react";
import { costoPorKg, type Envase } from "@/lib/calculoPrecio";
import type { GranelDelModulo, ProductoDelModulo, RubroDelModulo } from "@/lib/datosPrecios";
import { granelDesdeItem, type EstadoAlifrut, type ItemCatalogo } from "@/lib/catalogoProveedor";
import { normalizar } from "@/lib/listaAlifrut";
import { Vincular } from "@/components/PreciosAlifrut";

// Abajo de Precios → Góndola: lo que Alifrut tiene y WiiGo todavía no vende,
// por los rubros de Alifrut que se elijan (uno o varios). "Agregarlo" abre la
// misma ventana del Catálogo de Alifrut y, si hay un lugar libre elegido, lo
// deja planificado ahí (Gonzalo, 2026-11-05).

export type DatosAlifrutGondola = {
  items: ItemCatalogo[];
  estado: EstadoAlifrut;
  granel: GranelDelModulo[];
  productos: ProductoDelModulo[];
  rubros: RubroDelModulo[];
  envases: Envase[];
};

const pesos = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${Math.round(n).toLocaleString("es-AR")}`);
const GUARDADO = "wiigo.gondola.rubrosAlifrut";
// Lo que no va en la góndola de ganchos ni en las islas: queda detrás de "Ver todos los rubros".
const NO_GONDOLA = ["laboratorio", "cosmetica", "adaptogeno", "peruano", "jugo"];
const fueraDeGondola = (c: string) => NO_GONDOLA.some((w) => normalizar(c).includes(w));

export default function GondolaAlifrut(props: {
  datos: DatosAlifrutGondola;
  /** El lugar libre elegido en el mueble, si hay: ahí queda planificado lo que se agregue. */
  destino: string | null;
  /** Ubica el producto nuevo en el lugar elegido, como planificado. */
  ubicar: (producto: { id: string; nombre: string }) => void;
  /** Dónde está en la góndola un producto de WiiGo ("Mueble 2, fila manos, lugar 3"); null = sin lugar. */
  lugarDe: (idProducto: string) => { texto: string; puesto: boolean } | null;
}) {
  const { datos } = props;
  // Se acuerda de los rubros elegidos la próxima vez que entra (la pestaña se abre
  // después de cargar la página, así que acá ya hay navegador).
  const [elegidos, setElegidos] = useState<Set<string>>(() => {
    try {
      const v = typeof window === "undefined" ? [] : JSON.parse(window.localStorage.getItem(GUARDADO) ?? "[]");
      return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  });
  const [todos, setTodos] = useState(false);
  const [agregando, setAgregando] = useState<ItemCatalogo | null>(null);
  // Los que se agregan acá pasan a "Ya lo tenés" enseguida, sin esperar a recargar.
  const [recien, setRecien] = useState<Map<string, { id: string; nombre: string }[]>>(new Map());

  function tocar(c: string) {
    setElegidos((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      try {
        window.localStorage.setItem(GUARDADO, JSON.stringify([...n]));
      } catch {
        // No se pudo guardar: igual funciona en esta visita.
      }
      return n;
    });
  }

  // Los productos de WiiGo que salen de cada producto de Alifrut.
  const usosPorItem = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string }[]>();
    for (const g of datos.granel) {
      if (!g.idItem) continue;
      const hijos = datos.productos.filter((p) => p.idGranel === g.id).map((p) => ({ id: p.id, nombre: p.nombre }));
      if (hijos.length) m.set(g.idItem, [...(m.get(g.idItem) ?? []), ...hijos]);
    }
    return m;
  }, [datos.granel, datos.productos]);
  const usosDe = (id: string) => recien.get(id) ?? usosPorItem.get(id) ?? [];
  const traida = datos.estado.traidaEl ? new Date(datos.estado.traidaEl).getTime() : 0;
  // Lo que ya no está en su última lista no se propone.
  const sigue = (i: ItemCatalogo) => !(traida > 0 && new Date(i.vistoEl).getTime() < traida - 60000);
  const categoria = (i: ItemCatalogo) => i.categoria ?? "Sin categoría";

  // Cada rubro con lo que ya tenés y lo que te falta (Gonzalo, 2026-11-05: «los seleccionados por un lado y los que no por otro»).
  const porCategoria = new Map<string, { tengo: ItemCatalogo[]; falta: ItemCatalogo[] }>();
  for (const i of datos.items) {
    const tiene = usosDe(i.id).length > 0;
    if (!tiene && !sigue(i)) continue;
    const g = porCategoria.get(categoria(i)) ?? { tengo: [], falta: [] };
    (tiene ? g.tengo : g.falta).push(i);
    porCategoria.set(categoria(i), g);
  }
  // Primero los rubros donde ya vendés algo de Alifrut (lo tuyo); después el resto, por nombre.
  const categorias = [...porCategoria.keys()].sort(
    (a, b) => Number((porCategoria.get(b)?.tengo.length ?? 0) > 0) - Number((porCategoria.get(a)?.tengo.length ?? 0) > 0) || a.localeCompare(b, "es")
  );
  const visibles = categorias.filter((c) => todos || !fueraDeGondola(c) || elegidos.has(c));
  const escondidos = categorias.length - visibles.length;
  const elegidas = categorias.filter((c) => elegidos.has(c));
  const total = elegidas.reduce((t, c) => t + (porCategoria.get(c)?.falta.length ?? 0), 0);

  if (!datos.items.length) return null;

  return (
    <section className="pr-tarjeta pr-gda" aria-label="Productos de Alifrut sin agregar">
      <div className="pr-gda-cab">
        <div>
          <h2>Alifrut: lo que ya tenés y lo que te falta</h2>
          <p className="baj">
            Elegí uno o más rubros de Alifrut. De un lado lo que ya vendés (y dónde está en la góndola); del otro, lo que todavía no.
            {props.destino ? (
              <>
                {" "}
                Lo que agregues queda <b>planificado en {props.destino}</b>.
              </>
            ) : (
              " Si tocás antes un lugar libre del mueble, lo que agregues queda planificado ahí."
            )}
          </p>
        </div>
        {elegidas.length > 0 && (
          <small className="pr-tenue">
            Te faltan {total} en {elegidas.length} {elegidas.length === 1 ? "rubro" : "rubros"}
          </small>
        )}
      </div>

      <div className="pr-gda-chips" role="group" aria-label="Rubros de Alifrut">
        {visibles.map((c) => (
          <button key={c} type="button" aria-pressed={elegidos.has(c)} onClick={() => tocar(c)}>
            {c}
            <span title="ya tenés / hay en Alifrut">
              {porCategoria.get(c)?.tengo.length ?? 0}/{(porCategoria.get(c)?.tengo.length ?? 0) + (porCategoria.get(c)?.falta.length ?? 0)}
            </span>
          </button>
        ))}
        {escondidos > 0 && (
          <button type="button" className="mas" onClick={() => setTodos(true)}>
            Ver todos los rubros (+{escondidos}: laboratorio, cosmética…)
          </button>
        )}
      </div>

      {elegidas.length === 0 ? (
        <p className="pr-gda-vacio">Elegí uno o más rubros para ver qué tenés y qué te falta de Alifrut.</p>
      ) : (
        <div className="pr-gda-grupos">
          {elegidas.map((c) => {
            const { tengo, falta } = porCategoria.get(c) ?? { tengo: [], falta: [] };
            const costo = (i: ItemCatalogo) => {
              const g = granelDesdeItem({ costo_neto: i.costo, unidad: i.unidad, cantidad: i.cantidad });
              return (
                <span className="n">
                  {pesos(costoPorKg({ ...g, id: i.id }))} <small>{g.unidad === "CAJA" ? "c/u" : "/kg"}</small>
                </span>
              );
            };
            return (
              <div key={c} className="pr-gda-grupo">
                <h3>
                  {c}{" "}
                  <small>
                    tenés {tengo.length} de {tengo.length + falta.length}
                  </small>
                </h3>
                <div className="pr-gda-lados">
                  <div className="pr-gda-lado tengo">
                    <h4>Ya lo tenés ({tengo.length})</h4>
                    {tengo.length === 0 && <p className="pr-tenue">Todavía nada de este rubro.</p>}
                    {tengo.map((i) => (
                      <div key={i.id} className="pr-gda-fila">
                        <span>
                          <b>{i.nombre}</b>
                          {usosDe(i.id).map((p) => {
                            const l = props.lugarDe(p.id);
                            return (
                              <small key={p.id}>
                                {p.nombre} ·{" "}
                                <span className={`pr-gda-lugar ${l ? (l.puesto ? "ok" : "falta") : "sin"}`}>{l ? (l.puesto ? l.texto : `${l.texto} · falta poner`) : "sin lugar en la góndola"}</span>
                              </small>
                            );
                          })}
                        </span>
                        {costo(i)}
                      </div>
                    ))}
                  </div>
                  <div className="pr-gda-lado falta">
                    <h4>Te falta ({falta.length})</h4>
                    {falta.length === 0 && <p className="pr-tenue">Ya tenés todo lo de este rubro.</p>}
                    {falta.map((i) => (
                      <div key={i.id} className="pr-gda-fila">
                        <span>
                          <b>{i.nombre}</b>
                          {i.marca && <small>{i.marca}</small>}
                        </span>
                        {costo(i)}
                        <button type="button" className="pr-btn chico" onClick={() => setAgregando(i)}>
                          Agregarlo
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {agregando && (
        <Vincular
          item={agregando}
          rubros={datos.rubros}
          envases={datos.envases}
          productos={datos.productos}
          usos={[]}
          granel={datos.granel}
          destino={props.destino}
          alTerminar={(hechos) => {
            if (hechos.length) setRecien((s) => new Map(s).set(agregando.id, [...(usosPorItem.get(agregando.id) ?? []), ...hechos]));
            if (hechos[0]) props.ubicar(hechos[0]);
          }}
          onCerrar={() => setAgregando(null)}
        />
      )}
    </section>
  );
}
