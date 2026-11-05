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
  // Los que se agregan acá desaparecen de la lista enseguida, sin esperar a recargar.
  const [recien, setRecien] = useState<Set<string>>(new Set());

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

  const usados = useMemo(() => {
    const conProducto = new Set(datos.productos.map((p) => p.idGranel).filter(Boolean));
    return new Set(datos.granel.filter((g) => g.idItem && conProducto.has(g.id)).map((g) => g.idItem as string));
  }, [datos.granel, datos.productos]);
  const traida = datos.estado.traidaEl ? new Date(datos.estado.traidaEl).getTime() : 0;
  // Lo que ya no está en su última lista no se propone.
  const sigue = (i: ItemCatalogo) => !(traida > 0 && new Date(i.vistoEl).getTime() < traida - 60000);
  const faltan = datos.items.filter((i) => sigue(i) && !usados.has(i.id) && !recien.has(i.id));
  const categoria = (i: ItemCatalogo) => i.categoria ?? "Sin categoría";

  const porCategoria = new Map<string, ItemCatalogo[]>();
  for (const i of faltan) porCategoria.set(categoria(i), [...(porCategoria.get(categoria(i)) ?? []), i]);
  // Primero los rubros donde ya vendés algo de Alifrut (lo tuyo); después el resto, por nombre.
  const yaVendes = new Set(datos.items.filter((i) => usados.has(i.id)).map(categoria));
  const categorias = [...porCategoria.keys()].sort((a, b) => Number(yaVendes.has(b)) - Number(yaVendes.has(a)) || a.localeCompare(b, "es"));
  const visibles = categorias.filter((c) => todos || !fueraDeGondola(c) || elegidos.has(c));
  const escondidos = categorias.length - visibles.length;
  const elegidas = categorias.filter((c) => elegidos.has(c));
  const total = elegidas.reduce((t, c) => t + (porCategoria.get(c)?.length ?? 0), 0);

  if (!datos.items.length) return null;

  return (
    <section className="pr-tarjeta pr-gda" aria-label="Productos de Alifrut sin agregar">
      <div className="pr-gda-cab">
        <div>
          <h2>Alifrut: lo que todavía no agregaste</h2>
          <p className="baj">
            Elegí uno o más rubros de Alifrut. Sale lo que él tiene y vos todavía no vendés.
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
            {total} {total === 1 ? "producto" : "productos"} en {elegidas.length} {elegidas.length === 1 ? "rubro" : "rubros"}
          </small>
        )}
      </div>

      <div className="pr-gda-chips" role="group" aria-label="Rubros de Alifrut">
        {visibles.map((c) => (
          <button key={c} type="button" aria-pressed={elegidos.has(c)} onClick={() => tocar(c)}>
            {c}
            <span>{porCategoria.get(c)?.length ?? 0}</span>
          </button>
        ))}
        {escondidos > 0 && (
          <button type="button" className="mas" onClick={() => setTodos(true)}>
            Ver todos los rubros (+{escondidos}: laboratorio, cosmética…)
          </button>
        )}
      </div>

      {elegidas.length === 0 ? (
        <p className="pr-gda-vacio">Elegí uno o más rubros para ver qué te falta de Alifrut.</p>
      ) : (
        <div className="pr-gda-grupos">
          {elegidas.map((c) => (
            <div key={c} className="pr-gda-grupo">
              <h3>
                {c} <small>{porCategoria.get(c)?.length ?? 0} sin agregar</small>
              </h3>
              {(porCategoria.get(c) ?? []).map((i) => {
                const g = granelDesdeItem({ costo_neto: i.costo, unidad: i.unidad, cantidad: i.cantidad });
                return (
                  <div key={i.id} className="pr-gda-fila">
                    <span>
                      <b>{i.nombre}</b>
                      {i.marca && <small>{i.marca}</small>}
                    </span>
                    <span className="n">
                      {pesos(costoPorKg({ ...g, id: i.id }))} <small>{g.unidad === "CAJA" ? "c/u" : "/kg"}</small>
                    </span>
                    <button type="button" className="pr-btn chico" onClick={() => setAgregando(i)}>
                      Agregarlo
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
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
            setRecien((s) => new Set(s).add(agregando.id));
            if (hechos[0]) props.ubicar(hechos[0]);
          }}
          onCerrar={() => setAgregando(null)}
        />
      )}
    </section>
  );
}
