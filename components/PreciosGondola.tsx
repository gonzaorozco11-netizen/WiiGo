"use client";

import { useState, useTransition } from "react";
import { MuebleFrente, Pared3D } from "@/components/Gondola3D";
import { MOTIVOS_FALTA, NOMBRE_ALTURA, nombreCortoZona, soloModulos, type ModuloGondola } from "@/lib/gondola";
import { marcarPuestoLugar, moverModulo, ponerEnLugar } from "@/app/(app)/precios/gondola-actions";
import GondolaAlifrut, { type DatosAlifrutGondola } from "@/components/GondolaAlifrut";

// Precios → Góndola: el local entero (Gonzalo, 2026-11-03). Arriba se elige la
// zona —los módulos de la pared izquierda, una de las dos islas del centro o la
// estantería de Animalfit— y después, igual que siempre, se toca un lugar y se
// elige qué producto va ahí. La pantalla asesora usa esto para llevar al
// cliente, en 3D, hasta cada producto.

export type GondolaLocal = { idLocal: string; nombre: string; modulos: ModuloGondola[] };
/** Un producto que se puede ubicar: de cualquier marca. */
export type ProductoGondola = { id: string; nombre: string; marca: string | null };

type Zona = "MODULOS" | "ISLA1" | "ISLA2" | "ESTANTERIA";

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Cómo se llama la fila en cada mueble: en las islas son pisos, en la estantería estantes. */
function nombreFila(m: ModuloGondola, fila: number) {
  if (m.tipo === "ISLA") return ["piso de arriba", "piso del medio", "piso de abajo"][fila] ?? `piso ${fila + 1}`;
  if (m.tipo === "ESTANTERIA") return `estante ${m.filas.length - fila} desde abajo`;
  return `fila ${NOMBRE_ALTURA[m.filas[fila]?.altura ?? "manos"].toLowerCase()}`;
}

/** "Isla 1 · lado de los módulos", "Mueble 3 · A cualquier hora". */
function etiquetaZona(gondola: ModuloGondola[], m: ModuloGondola) {
  if (m.tipo === "MODULO") return `${nombreCortoZona(gondola, m)} · ${m.titulo}`;
  return `${m.titulo} · ${(m.subtitulo ?? "").toLowerCase()}`;
}

export default function PreciosGondola({
  locales,
  productos: productosBase,
  avisar,
  alifrut,
}: {
  locales: GondolaLocal[] | null;
  productos: ProductoGondola[];
  avisar: (t: string, mal?: boolean) => void;
  /** Lo de Alifrut que todavía no se agregó, abajo de la góndola; null sin la lista de Alifrut. */
  alifrut?: DatosAlifrutGondola | null;
}) {
  // Los que se crean desde "Alifrut: lo que todavía no agregaste" se suman acá sin recargar.
  const [nuevos, setNuevos] = useState<ProductoGondola[]>([]);
  const productos = nuevos.length ? [...productosBase, ...nuevos.filter((n) => !productosBase.some((p) => p.id === n.id))] : productosBase;
  const [idLocal, setIdLocal] = useState(locales?.[0]?.idLocal ?? "");
  const [porLocal, setPorLocal] = useState<Record<string, ModuloGondola[]>>(() => Object.fromEntries((locales ?? []).map((l) => [l.idLocal, l.modulos])));
  const gondola = porLocal[idLocal] ?? [];
  const modulos = soloModulos(gondola);
  const [zona, setZona] = useState<Zona>("MODULOS");
  const [idModulo, setIdModulo] = useState<string | null>(modulos[0]?.id ?? null);
  const [lugar, setLugar] = useState<{ fila: number; columna: number } | null>(null);
  const [buscar, setBuscar] = useState("");
  // Filtro por marca en "¿Qué va acá?" (Gonzalo, 2026-11-05). Queda elegido al pasar de un lugar a otro.
  const [marcaFiltro, setMarcaFiltro] = useState("");
  const [guardando, startTransition] = useTransition();

  if (!locales) {
    return (
      <section className="pr-tarjeta pr-vacio">
        <h2>Falta un paso</h2>
        <p className="baj">Para ubicar los productos en la góndola, corré sql/gondola.sql en Supabase.</p>
      </section>
    );
  }
  if (locales.length === 0 || modulos.length === 0) {
    return (
      <section className="pr-tarjeta pr-vacio">
        <h2>Sin módulos</h2>
        <p className="baj">Este local todavía no tiene módulos cargados. Volvé a correr sql/gondola.sql en Supabase: crea los 5 de cada local activo.</p>
      </section>
    );
  }

  // Las zonas que existen en este local (las islas y la estantería las crea sql/gondola-local-entero.sql).
  const islas = (n: number) => gondola.filter((m) => m.tipo === "ISLA" && m.numero === n).sort((a, b) => (a.lado === "IZQ" ? -1 : 1) - (b.lado === "IZQ" ? -1 : 1));
  const estanteria = gondola.filter((m) => m.tipo === "ESTANTERIA").sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
  const deLaZona: Record<Zona, ModuloGondola[]> = { MODULOS: modulos, ISLA1: islas(1), ISLA2: islas(2), ESTANTERIA: estanteria };
  const hayLocalEntero = estanteria.length > 0 || islas(1).length > 0;

  const enZona = deLaZona[zona];
  const modulo = enZona.find((m) => m.id === idModulo) ?? enZona[0] ?? modulos[0];
  const numero = modulos.indexOf(modulo) + 1;
  const dondeEsta = new Map(gondola.flatMap((m) => m.lugares.map((l) => [l.idProducto, { m, l }] as const)));
  // Lo planificado: ya tiene lugar, pero todavía falta ponerlo en la góndola.
  const faltaPoner = gondola.flatMap((m) => m.lugares.filter((l) => !l.puesto).map((l) => ({ m, l })));
  const sinLugar = productos.filter((p) => !dondeEsta.has(p.id));
  const ubicados = productos.length - sinLugar.length;
  const actual = lugar ? modulo.lugares.find((l) => l.fila === lugar.fila && l.columna === lugar.columna) ?? null : null;
  const q = sinTildes(buscar.trim());
  // Primero los que no tienen lugar; los demás también, para moverlos.
  const opciones = [...sinLugar, ...productos.filter((p) => dondeEsta.has(p.id))].filter(
    (p) => p.id !== actual?.idProducto && (!marcaFiltro || (p.marca ?? "") === marcaFiltro) && (!q || sinTildes(`${p.nombre} ${p.marca ?? ""}`).includes(q))
  );
  // Las marcas, con cuántos productos sin lugar tiene cada una.
  const marcas = [...new Set(productos.map((p) => p.marca ?? ""))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es"))
    .map((m) => ({ m, sin: sinLugar.filter((p) => p.marca === m).length }));

  function elegirZona(z: Zona) {
    setZona(z);
    setIdModulo(deLaZona[z][0]?.id ?? null);
    setLugar(null);
  }

  function poner(idProducto: string | null) {
    if (!lugar) return;
    const destino = { ...lugar };
    const p = idProducto ? productos.find((x) => x.id === idProducto) : null;
    startTransition(async () => {
      const r = await ponerEnLugar(modulo.id, destino.fila, destino.columna, idProducto).catch(() => ({ error: "No se pudo guardar. Probá de nuevo." }));
      if (r.error) return avisar(r.error, true);
      setPorLocal((todo) => ({
        ...todo,
        [idLocal]: (todo[idLocal] ?? []).map((m) => {
          // Sale de donde estaba (si estaba) y de ese lugar sale lo que había.
          let lugares = m.lugares.filter((l) => l.idProducto !== idProducto);
          if (m.id === modulo.id) {
            lugares = lugares.filter((l) => !(l.fila === destino.fila && l.columna === destino.columna));
            if (p) lugares.push({ fila: destino.fila, columna: destino.columna, idProducto: p.id, nombre: p.nombre, puesto: true, motivo: null });
          }
          return { ...m, lugares };
        }),
      }));
      avisar(p ? `${p.nombre}: ${etiquetaZona(gondola, modulo)}, ${nombreFila(modulo, destino.fila)}, lugar ${destino.columna + 1}.` : "Lugar liberado.");
      setLugar(null);
      setBuscar("");
    });
  }

  /** Puesto en la góndola o planificado (falta poner), con el motivo opcional. */
  function marcar(idMod: string, fila: number, columna: number, puesto: boolean, motivo: string | null) {
    startTransition(async () => {
      const r = await marcarPuestoLugar(idMod, fila, columna, puesto, motivo).catch(() => ({ error: "No se pudo guardar. Probá de nuevo." }));
      if (r.error) return avisar(r.error, true);
      setPorLocal((todo) => ({
        ...todo,
        [idLocal]: (todo[idLocal] ?? []).map((m) =>
          m.id !== idMod ? m : { ...m, lugares: m.lugares.map((l) => (l.fila === fila && l.columna === columna ? { ...l, puesto, motivo: puesto ? null : motivo } : l)) }
        ),
      }));
    });
  }

  // El lugar libre elegido: ahí queda planificado lo que se agregue de Alifrut.
  const libreElegido = lugar && !actual ? { idMod: modulo.id, ...lugar } : null;
  const destino = libreElegido ? `${nombreCortoZona(gondola, modulo)}, ${nombreFila(modulo, libreElegido.fila)}, lugar ${libreElegido.columna + 1}` : null;

  /** Lo recién creado desde Alifrut: a la lista de productos y, si hay lugar libre elegido, planificado ahí. */
  function ubicarNuevo(p: { id: string; nombre: string }) {
    setNuevos((xs) => [...xs, { id: p.id, nombre: p.nombre, marca: "WiiGo Dietética" }]);
    if (!libreElegido) return;
    const d = libreElegido;
    const motivo = "Falta fraccionar";
    startTransition(async () => {
      const r = await ponerEnLugar(d.idMod, d.fila, d.columna, p.id).catch(() => ({ error: "No se pudo ubicar. Probá de nuevo." }));
      if (r.error) return avisar(`Se creó, pero no se pudo ubicar: ${r.error}`, true);
      const r2 = await marcarPuestoLugar(d.idMod, d.fila, d.columna, false, motivo).catch(() => ({ error: "No se pudo marcar como planificado." }));
      setPorLocal((todo) => ({
        ...todo,
        [idLocal]: (todo[idLocal] ?? []).map((m) =>
          m.id !== d.idMod
            ? m
            : {
                ...m,
                lugares: [
                  ...m.lugares.filter((l) => !(l.fila === d.fila && l.columna === d.columna)),
                  { fila: d.fila, columna: d.columna, idProducto: p.id, nombre: p.nombre, puesto: Boolean(r2.error), motivo: r2.error ? null : motivo },
                ],
              }
        ),
      }));
      if (r2.error) avisar(r2.error, true);
      setLugar(null);
    });
  }

  function mover(direccion: -1 | 1) {
    startTransition(async () => {
      const r = await moverModulo(modulo.id, direccion).catch(() => ({ error: "No se pudo mover. Probá de nuevo.", orden: undefined }));
      if (r.error || !r.orden) return avisar(r.error ?? "No se pudo mover. Probá de nuevo.", true);
      const nuevo = r.orden;
      setPorLocal((todo) => {
        const lista = todo[idLocal] ?? [];
        const ordenados = nuevo.map((id, k) => ({ ...lista.find((x) => x.id === id)!, orden: k + 1 }));
        // Las islas y la estantería quedan como estaban, después de los módulos.
        return { ...todo, [idLocal]: [...ordenados, ...lista.filter((m) => m.tipo !== "MODULO")] };
      });
      avisar(`«${modulo.titulo}» ahora es el mueble ${nuevo.indexOf(modulo.id) + 1}.`);
    });
  }

  const ZONAS: { z: Zona; nombre: string; detalle: string }[] = [
    { z: "MODULOS", nombre: "Pared izquierda", detalle: `${modulos.length} módulos de ganchos` },
    ...(islas(1).length ? [{ z: "ISLA1" as Zona, nombre: "Isla 1", detalle: "La de la entrada · 3 pisos" }] : []),
    ...(islas(2).length ? [{ z: "ISLA2" as Zona, nombre: "Isla 2", detalle: "La del fondo · 3 pisos" }] : []),
    ...(estanteria.length ? [{ z: "ESTANTERIA" as Zona, nombre: "Estantería Animalfit", detalle: "Pared derecha · 6 estantes" }] : []),
  ];

  return (
    <div className="pr-gd">
      <section className="pr-tarjeta">
        <div className="pr-gd-cab">
          <div>
            <h2>Góndola · dónde va cada producto</h2>
            <p className="baj">
              Elegí la zona del local, tocá un lugar y elegí qué va ahí. La pantalla asesora lleva al cliente, en 3D, hasta cada producto.{" "}
              <b>
                {ubicados} de {productos.length} ubicados
              </b>
              {faltaPoner.length > 0 && (
                <>
                  {" "}
                  · <b className="pr-gd-falta-n">{faltaPoner.length} falta poner</b>
                </>
              )}
              .
            </p>
          </div>
          {locales.length > 1 && (
            <select
              value={idLocal}
              onChange={(e) => {
                setIdLocal(e.target.value);
                setZona("MODULOS");
                setIdModulo(soloModulos(porLocal[e.target.value] ?? [])[0]?.id ?? null);
                setLugar(null);
              }}
              aria-label="Local"
            >
              {locales.map((l) => (
                <option key={l.idLocal} value={l.idLocal}>
                  {l.nombre}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Las zonas del local, como el mapita de la pantalla asesora */}
        <div className="pr-gd-zonas" role="tablist" aria-label="Zona del local">
          {ZONAS.map((x) => (
            <button key={x.z} type="button" role="tab" aria-selected={zona === x.z} className={zona === x.z ? "on" : undefined} onClick={() => elegirZona(x.z)}>
              <b>{x.nombre}</b>
              <small>{x.detalle}</small>
            </button>
          ))}
        </div>
        {!hayLocalEntero && (
          <p className="baj">
            Para ubicar productos en las islas y en la estantería de Animalfit, corré <b>sql/gondola-local-entero.sql</b> en Supabase.
          </p>
        )}

        {zona === "MODULOS" ? (
          <Pared3D
            modulos={modulos}
            sel={modulo.id}
            onElegir={(id) => {
              setIdModulo(id);
              setLugar(null);
            }}
          />
        ) : (
          // Lado de la isla o parte de la estantería
          <div className="pr-gd-lados" role="group" aria-label={zona === "ESTANTERIA" ? "Parte" : "Lado"}>
            {enZona.map((m) => (
              <button
                key={m.id}
                type="button"
                className={m.id === modulo.id ? "on" : undefined}
                aria-pressed={m.id === modulo.id}
                onClick={() => {
                  setIdModulo(m.id);
                  setLugar(null);
                }}
              >
                {m.subtitulo ?? m.titulo}
                <small>{m.lugares.length} ubicados</small>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="pr-gd-detalle">
        <section className="pr-tarjeta" style={{ minWidth: 0 }}>
          <MuebleFrente
            modulo={modulo}
            numero={numero}
            etiqueta={modulo.tipo === "MODULO" ? undefined : `${modulo.titulo} · ${modulo.subtitulo ?? ""}`}
            elegido={lugar}
            onLugar={(fila, columna) => {
              setLugar({ fila, columna });
              setBuscar("");
            }}
          />
        </section>

        <aside className="pr-tarjeta pr-gd-panel">
          {!lugar ? (
            <>
              <h3>{etiquetaZona(gondola, modulo)}</h3>
              <p className="baj">Tocá un lugar del mueble para poner o cambiar el producto.</p>
              {modulo.tipo === "MODULO" && modulos.length > 1 && (
                <div>
                  <b>¿Lo cambiaste de lugar en el local?</b>
                  <p className="baj">Se mueve con todos sus productos.</p>
                  <div className="pr-gd-bot">
                    <button type="button" className="pr-btn" disabled={guardando || numero === 1} onClick={() => mover(-1)}>
                      ← A la izquierda
                    </button>
                    <button type="button" className="pr-btn" disabled={guardando || numero === modulos.length} onClick={() => mover(1)}>
                      A la derecha →
                    </button>
                  </div>
                </div>
              )}
              <div>
                <b>Sin lugar todavía ({sinLugar.length})</b>
                {sinLugar.length === 0 ? (
                  <p className="baj">Todos los productos tienen su lugar.</p>
                ) : (
                  <>
                    <div className="pr-gd-chips">
                      {sinLugar.slice(0, 30).map((p) => (
                        <span key={p.id} className="pr-gd-chip">
                          {p.nombre}
                        </span>
                      ))}
                      {sinLugar.length > 30 && <span className="pr-tenue">y {sinLugar.length - 30} más</span>}
                    </div>
                    <p className="baj">A estos la pantalla asesora no les puede decir dónde están hasta que tengan su lugar.</p>
                  </>
                )}
              </div>
              {/* Lo que ya tiene lugar pero todavía no está en la góndola: la lista del que fracciona. */}
              {faltaPoner.length > 0 && (
                <div>
                  <b>Falta poner en la góndola ({faltaPoner.length})</b>
                  <ul className="pr-gd-falta">
                    {faltaPoner.map(({ m, l }) => (
                      <li key={`${m.id}-${l.fila}-${l.columna}`}>
                        <span>
                          <b>{l.nombre}</b>
                          <small>
                            {nombreCortoZona(gondola, m)} · {nombreFila(m, l.fila)} · lugar {l.columna + 1}
                          </small>
                          {l.motivo && <span className="pr-gd-motivo">{l.motivo}</span>}
                        </span>
                        <button type="button" className="pr-btn chico" disabled={guardando} onClick={() => marcar(m.id, l.fila, l.columna, true, null)}>
                          Ya está puesto
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="baj">Tienen su lugar reservado. La pantalla asesora no manda al cliente a buscarlos hasta que estén puestos.</p>
                </div>
              )}
            </>
          ) : (
            <>
              <h3>{actual ? actual.nombre : "Lugar libre"}</h3>
              <p className="baj">
                <b>{etiquetaZona(gondola, modulo)}</b> · {nombreFila(modulo, lugar.fila)} · lugar <b>{lugar.columna + 1}</b> desde la izquierda
              </p>
              {actual && (
                <div className="pr-gd-estado-caja">
                  <b>¿Está en la góndola?</b>
                  <div className="pr-gd-estado" role="group" aria-label="Estado del lugar">
                    <button type="button" className="si" aria-pressed={actual.puesto} disabled={guardando} onClick={() => !actual.puesto && marcar(modulo.id, lugar.fila, lugar.columna, true, null)}>
                      Sí, está puesto
                      <small>el cliente lo encuentra acá</small>
                    </button>
                    <button type="button" className="no" aria-pressed={!actual.puesto} disabled={guardando} onClick={() => actual.puesto && marcar(modulo.id, lugar.fila, lugar.columna, false, null)}>
                      Todavía no
                      <small>planificado · falta poner</small>
                    </button>
                  </div>
                  {!actual.puesto && (
                    <>
                      <small className="pr-tenue">¿Por qué? (opcional)</small>
                      <div className="pr-gd-motivos">
                        {MOTIVOS_FALTA.map((mo) => (
                          <button
                            key={mo}
                            type="button"
                            aria-pressed={actual.motivo === mo}
                            disabled={guardando}
                            onClick={() => marcar(modulo.id, lugar.fila, lugar.columna, false, actual.motivo === mo ? null : mo)}
                          >
                            {mo}
                          </button>
                        ))}
                      </div>
                      <p className="baj">Mientras esté planificado, la pantalla asesora no manda al cliente a buscarlo acá. El lugar queda reservado.</p>
                    </>
                  )}
                </div>
              )}
              <label htmlFor="gd-buscar" className="pr-gd-label">
                {actual ? "Cambiarlo por:" : "¿Qué va acá?"}
              </label>
              {marcas.length > 1 && (
                <div className="pr-gd-marcas" role="group" aria-label="Filtrar por marca">
                  <button type="button" aria-pressed={!marcaFiltro} onClick={() => setMarcaFiltro("")}>
                    Todas
                  </button>
                  {marcas.map(({ m, sin }) => (
                    <button key={m} type="button" aria-pressed={marcaFiltro === m} onClick={() => setMarcaFiltro(marcaFiltro === m ? "" : m)}>
                      {m}
                      {sin > 0 && <span title="sin lugar">{sin}</span>}
                    </button>
                  ))}
                </div>
              )}
              <input id="gd-buscar" className="pr-gd-buscar" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar producto o marca" autoFocus />
              <ul className="pr-gd-opciones">
                {opciones.slice(0, 60).map((p) => {
                  const d = dondeEsta.get(p.id);
                  return (
                    <li key={p.id}>
                      <button type="button" disabled={guardando} onClick={() => poner(p.id)}>
                        <span>{p.nombre}</span>
                        <small>
                          {p.marca ? `${p.marca} · ` : ""}
                          {d ? `está en ${nombreCortoZona(gondola, d.m)}, ${nombreFila(d.m, d.l.fila)} · moverlo` : "sin lugar"}
                        </small>
                      </button>
                    </li>
                  );
                })}
                {opciones.length === 0 && <li className="pr-tenue">No hay productos con ese nombre.</li>}
              </ul>
              <div className="pr-gd-bot">
                {actual && (
                  <button type="button" className="pr-btn" disabled={guardando} onClick={() => poner(null)}>
                    Sacarlo de este lugar
                  </button>
                )}
                <button type="button" className="pr-btn" onClick={() => setLugar(null)}>
                  Listo
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      {alifrut && (
        <GondolaAlifrut
          datos={alifrut}
          destino={destino}
          ubicar={ubicarNuevo}
          lugarDe={(id) => {
            const d = dondeEsta.get(id);
            return d ? { texto: `${nombreCortoZona(gondola, d.m)}, ${nombreFila(d.m, d.l.fila)}, lugar ${d.l.columna + 1}`, puesto: d.l.puesto } : null;
          }}
        />
      )}
    </div>
  );
}
