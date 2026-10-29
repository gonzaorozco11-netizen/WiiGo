"use client";

import { useState, useTransition } from "react";
import { MuebleFrente, Pared3D } from "@/components/Gondola3D";
import { NOMBRE_ALTURA, type ModuloGondola } from "@/lib/gondola";
import type { ProductoDelModulo } from "@/lib/datosPrecios";
import { ponerEnLugar } from "@/app/(app)/precios/gondola-actions";

// Precios → Góndola: los módulos del local en 3D. Se toca un módulo, después
// un lugar, y se elige qué producto va ahí. La pantalla asesora usa esto para
// decirle al cliente dónde está cada producto (Gonzalo, 2026-10-29).

export type GondolaLocal = { idLocal: string; nombre: string; modulos: ModuloGondola[] };

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function PreciosGondola({
  locales,
  productos,
  avisar,
}: {
  locales: GondolaLocal[] | null;
  productos: ProductoDelModulo[];
  avisar: (t: string, mal?: boolean) => void;
}) {
  const [idLocal, setIdLocal] = useState(locales?.[0]?.idLocal ?? "");
  const [porLocal, setPorLocal] = useState<Record<string, ModuloGondola[]>>(() => Object.fromEntries((locales ?? []).map((l) => [l.idLocal, l.modulos])));
  const modulos = porLocal[idLocal] ?? [];
  const [idModulo, setIdModulo] = useState<string | null>(modulos[0]?.id ?? null);
  const [lugar, setLugar] = useState<{ fila: number; columna: number } | null>(null);
  const [buscar, setBuscar] = useState("");
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

  const modulo = modulos.find((m) => m.id === idModulo) ?? modulos[0];
  const numero = modulos.indexOf(modulo) + 1;
  const dondeEsta = new Map(modulos.flatMap((m, i) => m.lugares.map((l) => [l.idProducto, { m, i, l }] as const)));
  const sinLugar = productos.filter((p) => !dondeEsta.has(p.id));
  const ubicados = productos.length - sinLugar.length;
  const actual = lugar ? modulo.lugares.find((l) => l.fila === lugar.fila && l.columna === lugar.columna) ?? null : null;
  const q = sinTildes(buscar.trim());
  // Primero los que no tienen lugar; los demás también, para moverlos.
  const opciones = [...sinLugar, ...productos.filter((p) => dondeEsta.has(p.id))].filter((p) => p.id !== actual?.idProducto && (!q || sinTildes(p.nombre).includes(q)));

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
            if (p) lugares.push({ fila: destino.fila, columna: destino.columna, idProducto: p.id, nombre: p.nombre });
          }
          return { ...m, lugares };
        }),
      }));
      avisar(p ? `${p.nombre}: módulo ${numero}, fila ${NOMBRE_ALTURA[modulo.filas[destino.fila].altura].toLowerCase()}, lugar ${destino.columna + 1}.` : "Lugar liberado.");
      setLugar(null);
      setBuscar("");
    });
  }

  return (
    <div className="pr-gd">
      <section className="pr-tarjeta">
        <div className="pr-gd-cab">
          <div>
            <h2>Góndola · dónde va cada producto</h2>
            <p className="baj">
              Tocá un módulo para verlo de frente; después tocá un lugar y elegí qué va ahí. La pantalla asesora le muestra al cliente, en 3D, dónde está cada producto.{" "}
              <b>
                {ubicados} de {productos.length} ubicados
              </b>
              .
            </p>
          </div>
          {locales.length > 1 && (
            <select
              value={idLocal}
              onChange={(e) => {
                setIdLocal(e.target.value);
                setIdModulo(porLocal[e.target.value]?.[0]?.id ?? null);
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
        <Pared3D
          modulos={modulos}
          sel={modulo.id}
          onElegir={(id) => {
            setIdModulo(id);
            setLugar(null);
          }}
        />
      </section>

      <div className="pr-gd-detalle">
        <section className="pr-tarjeta" style={{ minWidth: 0 }}>
          <MuebleFrente modulo={modulo} numero={numero} elegido={lugar} onLugar={(fila, columna) => { setLugar({ fila, columna }); setBuscar(""); }} />
        </section>

        <aside className="pr-tarjeta pr-gd-panel">
          {!lugar ? (
            <>
              <h3>
                Módulo {numero} · {modulo.titulo}
              </h3>
              <p className="baj">Tocá un lugar del mueble para poner o cambiar el producto.</p>
              <div>
                <b>Sin lugar todavía ({sinLugar.length})</b>
                {sinLugar.length === 0 ? (
                  <p className="baj">Todos tus productos tienen su lugar.</p>
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
            </>
          ) : (
            <>
              <h3>{actual ? actual.nombre : "Lugar libre"}</h3>
              <p className="baj">
                Módulo <b>{numero}</b> · fila <b>{NOMBRE_ALTURA[modulo.filas[lugar.fila].altura].toLowerCase()}</b> · lugar <b>{lugar.columna + 1}</b> desde la izquierda
              </p>
              <label htmlFor="gd-buscar" className="pr-gd-label">
                {actual ? "Cambiarlo por:" : "¿Qué va acá?"}
              </label>
              <input id="gd-buscar" className="pr-gd-buscar" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar producto" autoFocus />
              <ul className="pr-gd-opciones">
                {opciones.slice(0, 60).map((p) => {
                  const d = dondeEsta.get(p.id);
                  return (
                    <li key={p.id}>
                      <button type="button" disabled={guardando} onClick={() => poner(p.id)}>
                        <span>{p.nombre}</span>
                        <small>{d ? `está en el ${d.i + 1}, ${NOMBRE_ALTURA[d.m.filas[d.l.fila]?.altura ?? "manos"].toLowerCase()} · moverlo` : "sin lugar"}</small>
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
    </div>
  );
}
