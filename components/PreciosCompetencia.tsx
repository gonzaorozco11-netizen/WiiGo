"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COMERCIOS, diferencia, precioATuTamano, type Comercio } from "@/lib/competencia";
import type { DatosCompetencia, VinculoCompetencia } from "@/lib/competenciaLeer";
import type { ProductoDelModulo } from "@/lib/datosPrecios";
import { actualizarCompetenciaAhora, confirmarEquivalente, descartarEquivalente } from "@/app/(app)/precios/competencia-actions";

// Pestaña "Competencia" de Precios: los precios de Mendoza, leídos solos cada
// lunes, al lado de cada producto de WiiGo y llevados a su tamaño. Lo único
// que hace Gonzalo es confirmar (✓) o descartar (✗) el equivalente propuesto.

const pesos = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${Math.round(n).toLocaleString("es-AR")}`);
const fechaHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";
const nombreDe = (c: Comercio) => COMERCIOS.find((x) => x.clave === c)?.nombre ?? c;

type Fila = { p: ProductoDelModulo; v: Partial<Record<Comercio, VinculoCompetencia>>; dif: number | null; contra: Comercio | null };

function chip(dif: number | null) {
  if (dif == null) return <span className="pr-dif nada">Sin comparar</span>;
  const pct = Math.round(Math.abs(dif) * 100);
  if (dif > 0.08) return <span className="pr-dif caro">{pct}% más caro</span>;
  if (dif < -0.08) return <span className="pr-dif barato">{pct}% más barato</span>;
  return <span className="pr-dif parejo">Parejo ({dif >= 0 ? "+" : "−"}{pct}%)</span>;
}

export default function PreciosCompetencia(props: { productos: ProductoDelModulo[]; datos: DatosCompetencia | null; avisar: (t: string, mal?: boolean) => void }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<string | null>(null);
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

  const conPrecio = (v: VinculoCompetencia | undefined, g: number | null) => (v?.item && g ? precioATuTamano(v.item, g) : null);
  const filas: Fila[] = props.productos.map((p) => {
    const v: Fila["v"] = {};
    for (const x of datos.vinculos[p.id] ?? []) if (x.item) v[x.comercio] = x;
    // Contra la dietética (Bela Vita); si no la tiene, contra el más barato de los otros.
    const otros = (Object.keys(v) as Comercio[]).map((c) => ({ c, precio: conPrecio(v[c], p.gramos) })).filter((x) => x.precio);
    const contra: Comercio | null = v.BELAVITA && conPrecio(v.BELAVITA, p.gramos) ? "BELAVITA" : otros.sort((a, b) => (a.precio as number) - (b.precio as number))[0]?.c ?? null;
    const dif = contra && p.precioHoy ? diferencia(p.precioHoy, conPrecio(v[contra], p.gramos)) : null;
    return { p, v, dif, contra };
  });
  const columnas = COMERCIOS.filter((c) => filas.some((f) => f.v[c.clave]));
  const caros = filas.filter((f) => f.dif != null && f.dif > 0.08);
  const baratos = filas.filter((f) => f.dif != null && f.dif < -0.08);
  const parejos = filas.filter((f) => f.dif != null && Math.abs(f.dif) <= 0.08);
  const muyCaros = caros.filter((f) => (f.dif as number) > 0.5).map((f) => f.p.nombre);
  const porConfirmar = filas.reduce((t, f) => t + Object.values(f.v).filter((x) => x?.estado === "PROPUESTO").length, 0);
  const enLista = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} y ${l[l.length - 1]}` : l[0]);

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

      <section className="pr-kpis" aria-label="Resumen contra la competencia">
        <div className="pr-kpi mal"><span>Más caro</span><b>{caros.length}</b><small>más de 8% arriba</small></div>
        <div className="pr-kpi ojo"><span>Parejo</span><b>{parejos.length}</b><small>dentro de ±8%</small></div>
        <div className="pr-kpi ok"><span>Más barato</span><b>{baratos.length}</b><small>margen para subir</small></div>
        <div className="pr-kpi azul"><span>Sin comparar</span><b>{filas.filter((f) => f.dif == null).length}</b><small>nadie lo vende igual, o sin precio</small></div>
      </section>

      <section className="pr-tarjeta" style={{ padding: 0 }}>
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
              {filas
                .sort((a, b) => (b.dif ?? -9) - (a.dif ?? -9))
                .flatMap((f) => {
                  const abiertaEsta = abierto === f.p.id;
                  const fila = (
                    <tr key={f.p.id} className={`fila${abiertaEsta ? " abierta" : ""}`} onClick={() => setAbierto(abiertaEsta ? null : f.p.id)}>
                      <td className="pr-prod"><b>{f.p.nombre}</b><small>{Object.keys(f.v).length} comercios de Mendoza</small></td>
                      <td className="n" style={{ fontSize: 15 }}>{f.p.precioHoy ? pesos(f.p.precioHoy) : <span className="pr-sinprecio">Sin precio</span>}</td>
                      {columnas.map((c) => {
                        const x = f.v[c.clave];
                        return (
                          <td key={c.clave}>
                            {x?.item ? (
                              <span className="pr-comp-celda">
                                <span className="n">{pesos(conPrecio(x, f.p.gramos))}</span>
                                <small>
                                  {x.item.nombre}
                                  {x.item.porKilo ? " · por kilo" : ""}
                                  {x.estado === "PROPUESTO" ? " · sin confirmar" : ""}
                                </small>
                              </span>
                            ) : (
                              <span className="pr-tenue">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td>{chip(f.dif)}{f.contra && f.dif != null && <small className="pr-comp-contra">contra {nombreDe(f.contra)}</small>}</td>
                    </tr>
                  );
                  if (!abiertaEsta) return [fila];
                  return [fila, (
                    <tr key={`${f.p.id}-d`} className="detalle">
                      <td colSpan={3 + columnas.length}>
                        <Detalle f={f} responder={responder} pendiente={pendiente} />
                      </td>
                    </tr>
                  )];
                })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Detalle({ f, responder, pendiente }: { f: Fila; responder: (id: string, c: Comercio, si: boolean) => void; pendiente: boolean }) {
  const g = f.p.gramos;
  const lista = COMERCIOS.filter((c) => f.v[c.clave]?.item);
  const todos = [{ q: "Vos", v: f.p.precioHoy ?? 0, yo: true }, ...lista.map((c) => ({ q: c.nombre, v: g ? precioATuTamano(f.v[c.clave]!.item!, g) ?? 0 : 0, yo: false }))].filter((t) => t.v > 0);
  const max = Math.max(1, ...todos.map((t) => t.v));
  const ref = f.contra && g ? precioATuTamano(f.v[f.contra]!.item!, g) : null;
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
                  {it.nombre} · {pesos(it.precio)} {it.gramos && it.gramos >= 1000 ? (it.gramos === 1000 ? "el kg" : `por ${it.gramos / 1000} kg`) : `por ${it.gramos} g`}
                  {it.precioAntes ? ` (antes ${pesos(it.precioAntes)})` : ""} · {c.tipo}
                </div>
                {x.estado === "PROPUESTO" && (
                  <div className="pr-comp-preg">
                    ¿Es el mismo producto que el tuyo?
                    <button type="button" className="si" disabled={pendiente} onClick={() => responder(f.p.id, c.clave, true)}>✓ Sí</button>
                    <button type="button" disabled={pendiente} onClick={() => responder(f.p.id, c.clave, false)}>✗ No</button>
                  </div>
                )}
              </div>
              <div className="pr-comp-tu n">
                {pesos(g ? precioATuTamano(it, g) : null)}
                <small>a tus {g ?? "?"} g</small>
              </div>
            </div>
          );
        })}
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
            <p className="pr-nota mal">Estás {Math.round(f.dif * 100)}% arriba de {nombreDe(f.contra as Comercio)}. Para quedar parejo, el precio sería {pesos(tope)}: revisá en la Lista de precios si con ese precio te sigue dando el margen.</p>
          ) : f.dif < -0.08 ? (
            <p className="pr-nota ok">Estás {Math.round(-f.dif * 100)}% abajo de {nombreDe(f.contra as Comercio)}. Podrías llevarlo a {pesos(tope)} y seguir más barato: son {pesos(tope - (f.p.precioHoy ?? 0))} más por unidad.</p>
          ) : (
            <p className="pr-nota ok">Estás parejo con {nombreDe(f.contra as Comercio)}.</p>
          )
        )}
      </div>
    </div>
  );
}
