"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  guardarObjetivos,
  type DatosObjetivos,
  type GondolaObjetivos,
} from "@/app/(app)/stock/objetivos/actions";
import { minimoSugerido, ventasSemanalesQueAguanta } from "@/lib/objetivosStock";

// Cargar mínimos y objetivos por góndola.
//
// La unidad de trabajo es la góndola y no el producto: antes de abrir hay 149
// variantes y el número correcto casi siempre es el mismo para toda la
// estantería. Igual se puede tocar una sola, porque siempre hay un producto
// que rota distinto al resto de su categoría.
//
// Nada se guarda al tipear: se juntan los cambios y se mandan juntos. Así se
// puede comparar una góndola con otra antes de confirmar, y no queda media
// carga aplicada si algo falla.

type Edicion = Map<string, { minimo: number; objetivo: number }>;

export default function ObjetivosStockApp({ datos }: { datos: DatosObjetivos }) {
  const router = useRouter();
  const [edicion, setEdicion] = useState<Edicion>(new Map());
  const [marcaAbierta, setMarcaAbierta] = useState<string>(datos.marcas[0]?.idMarca ?? "");
  const [error, setError] = useState<string | null>(null);
  const [guardados, setGuardados] = useState<number | null>(null);
  const [pendiente, empezar] = useTransition();

  const original = useMemo(() => {
    const m = new Map<string, { minimo: number; objetivo: number }>();
    for (const marca of datos.marcas)
      for (const g of marca.gondolas)
        for (const v of g.variantes) m.set(v.idVariante, { minimo: v.minimo, objetivo: v.objetivo });
    return m;
  }, [datos]);

  function valor(idVariante: string) {
    return edicion.get(idVariante) ?? original.get(idVariante) ?? { minimo: 0, objetivo: 0 };
  }

  function tocar(idVariante: string, campo: "minimo" | "objetivo", n: number) {
    setGuardados(null);
    setEdicion((previo) => {
      const siguiente = new Map(previo);
      const actual = siguiente.get(idVariante) ?? original.get(idVariante) ?? { minimo: 0, objetivo: 0 };
      const nuevo = { ...actual, [campo]: Math.max(0, Math.round(n) || 0) };
      // Al cambiar el objetivo el mínimo se recalcula solo. Es lo que uno
      // espera: nadie pone objetivo 20 y quiere seguir con mínimo 2.
      if (campo === "objetivo") nuevo.minimo = minimoSugerido(nuevo.objetivo);
      siguiente.set(idVariante, nuevo);
      return siguiente;
    });
  }

  /** Todo el estante al mismo número, que es para lo que existe la pantalla. */
  function aplicarAGondola(g: GondolaObjetivos, objetivo: number) {
    setGuardados(null);
    setEdicion((previo) => {
      const siguiente = new Map(previo);
      for (const v of g.variantes) {
        siguiente.set(v.idVariante, { objetivo, minimo: minimoSugerido(objetivo) });
      }
      return siguiente;
    });
  }

  const cambios = useMemo(
    () =>
      [...edicion.entries()]
        .filter(([id, v]) => {
          const o = original.get(id);
          return !o || o.minimo !== v.minimo || o.objetivo !== v.objetivo;
        })
        .map(([idVariante, v]) => ({ idVariante, ...v })),
    [edicion, original]
  );

  function guardar() {
    setError(null);
    empezar(async () => {
      const r = await guardarObjetivos(cambios);
      if (r.error) return setError(r.error);
      setGuardados(r.guardados);
      setEdicion(new Map());
      router.refresh();
    });
  }

  const marca = datos.marcas.find((m) => m.idMarca === marcaAbierta) ?? datos.marcas[0];

  return (
    <div className="pb-24">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-neutral-900 mb-1">Mínimos y objetivos</h1>
        <p className="text-sm text-neutral-500 max-w-3xl">
          Cuánto tiene que haber de cada producto en la góndola. El <b>objetivo</b> es hasta dónde se
          repone; el <b>mínimo</b> es la alarma de que no llega a la próxima recepción. Se cargan por
          góndola porque el número casi siempre es el mismo para toda la estantería.
        </p>
        <p className="text-sm text-neutral-500 mt-2 max-w-3xl">
          Con los días de recepción que tenés puestos, el local puede estar{" "}
          <b>{datos.huecoDias} días seguidos sin recibir</b>. El objetivo tiene que alcanzar para
          vender todo ese tiempo.
        </p>
      </div>

      {datos.marcas.length === 0 ? (
        <p className="text-sm text-neutral-500">No hay productos activos todavía.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {datos.marcas.map((m) => (
              <button
                key={m.idMarca}
                onClick={() => setMarcaAbierta(m.idMarca)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  m.idMarca === marca?.idMarca
                    ? "border-accent bg-accent-tint text-accent"
                    : "border-neutral-300 text-neutral-600 hover:border-neutral-400"
                }`}
              >
                {m.nombre}
              </button>
            ))}
          </div>

          {marca?.gondolas.map((g) => (
            <Gondola
              key={g.idSubcategoria || "sin"}
              g={g}
              huecoDias={datos.huecoDias}
              valor={valor}
              tocar={tocar}
              aplicar={(n) => aplicarAGondola(g, n)}
            />
          ))}
        </>
      )}

      {/* La barra de guardar queda fija abajo: con cuatro góndolas abiertas el
          botón al final de la página no se ve nunca. */}
      {(cambios.length > 0 || error || guardados !== null) && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 px-5 py-3 flex items-center justify-between gap-4 shadow-[0_-2px_10px_rgba(0,0,0,.05)]">
          <div className="text-sm">
            {error ? (
              <span className="text-red-600">{error}</span>
            ) : guardados !== null ? (
              <span className="text-emerald-700">
                {guardados === 1 ? "1 variante guardada." : `${guardados} variantes guardadas.`}
              </span>
            ) : (
              <span className="text-neutral-700">
                <b>{cambios.length}</b> {cambios.length === 1 ? "variante" : "variantes"} sin guardar
              </span>
            )}
          </div>
          {cambios.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEdicion(new Map());
                  setError(null);
                }}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600"
              >
                Descartar
              </button>
              <button
                onClick={guardar}
                disabled={pendiente}
                className="rounded-lg bg-accent hover:bg-accent-dark text-white px-5 py-2 text-sm font-medium disabled:opacity-50"
              >
                {pendiente ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Gondola({
  g,
  huecoDias,
  valor,
  tocar,
  aplicar,
}: {
  g: GondolaObjetivos;
  huecoDias: number;
  valor: (id: string) => { minimo: number; objetivo: number };
  tocar: (id: string, campo: "minimo" | "objetivo", n: number) => void;
  aplicar: (n: number) => void;
}) {
  const [todos, setTodos] = useState("");

  const enCero = g.variantes.filter((v) => valor(v.idVariante).objetivo === 0).length;

  return (
    <div className="bg-white border border-neutral-200 rounded-xl mb-4 overflow-hidden">
      <div className="px-5 py-3 border-b border-neutral-100 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">
            {g.nombre}
            <span className="ml-2 text-xs font-normal text-neutral-400">
              {g.variantes.length} {g.variantes.length === 1 ? "variante" : "variantes"}
            </span>
          </h2>
          {/* Objetivo 0 es invisible para la reposición: nunca va a pedir
              nada. Si es a propósito (una vianda que se hace fresca) está
              bien, pero tiene que ser una decisión y no un cero olvidado. */}
          {enCero > 0 && (
            <p className="text-xs text-amber-700 mt-0.5">
              {enCero} en objetivo 0 — {enCero === 1 ? "no va" : "no van"} a pedir reposición nunca
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500">Toda la góndola en</label>
          <input
            type="number"
            min="0"
            value={todos}
            onChange={(e) => setTodos(e.target.value)}
            placeholder="—"
            className="w-20 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-center"
          />
          <button
            onClick={() => {
              const n = Number(todos);
              if (Number.isFinite(n) && n >= 0) aplicar(Math.round(n));
            }}
            disabled={todos === ""}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 disabled:opacity-40"
          >
            Aplicar
          </button>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-neutral-400 text-left">
            <th className="font-medium px-5 py-2">Producto</th>
            <th className="font-medium px-2 py-2 w-24 text-center">Mínimo</th>
            <th className="font-medium px-2 py-2 w-24 text-center">Objetivo</th>
            <th className="font-medium px-5 py-2 w-56">Aguanta hasta</th>
          </tr>
        </thead>
        <tbody>
          {g.variantes.map((v) => {
            const val = valor(v.idVariante);
            const aguanta = ventasSemanalesQueAguanta(val.objetivo, huecoDias);
            return (
              <tr key={v.idVariante} className="border-t border-neutral-100">
                <td className="px-5 py-2">
                  {v.producto}
                  {v.variante && v.variante !== "Único" && (
                    <span className="text-neutral-400"> · {v.variante}</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min="0"
                    value={val.minimo}
                    onChange={(e) => tocar(v.idVariante, "minimo", Number(e.target.value))}
                    className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm text-center tabular-nums"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min="0"
                    value={val.objetivo}
                    onChange={(e) => tocar(v.idVariante, "objetivo", Number(e.target.value))}
                    className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm text-center tabular-nums"
                  />
                </td>
                <td className="px-5 py-2 text-neutral-500 text-xs">
                  {val.objetivo <= 1 ? (
                    <span className="text-amber-700">no alcanza para nada</span>
                  ) : (
                    <>
                      <b className="text-neutral-700">{aguanta.toFixed(1)}</b> ventas por semana
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
