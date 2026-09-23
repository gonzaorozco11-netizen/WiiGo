"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Objetivo } from "@/lib/supabase";
import {
  guardarProductosDeObjetivo,
  fusionarObjetivos,
  cambiarEstadoObjetivo,
} from "@/app/(app)/objetivos/actions";

export type ProductoParaObjetivo = {
  idProducto: string;
  nombre: string;
  marca: string | null;
  rubro: string | null;
  imagen: string | null;
  /** En qué objetivos está hoy, según la base. */
  objetivos: string[];
};

/**
 * Detecta objetivos que parecen el mismo.
 *
 * "Energía" y "Mas energía" son dos caminos que en el asesor llevan al mismo
 * lado, y el cliente los ve como un error. Se comparan sin tildes, sin
 * mayúsculas y sin las palabras de relleno con las que se suele escribir dos
 * veces la misma idea.
 */
const RELLENO = /\b(mas|más|mejor|mejorar|de|el|la|los|las|un|una|y|o|para|con|tu|mi)\b/g;

function raiz(nombre: string) {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(RELLENO, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export default function ObjetivosApp({
  objetivos,
  productos,
}: {
  objetivos: Objetivo[];
  productos: ProductoParaObjetivo[];
}) {
  const router = useRouter();
  const [guardando, startTransition] = useTransition();
  const [aviso, setAviso] = useState<{ texto: string; mal?: boolean } | null>(null);

  const activos = useMemo(() => objetivos.filter((o) => o.estado !== "INACTIVO"), [objetivos]);
  const [elegido, setElegido] = useState<Objetivo | null>(activos[0] ?? null);

  // La selección que se está editando. Arranca de lo que hay en la base y
  // vuelve a arrancar cada vez que se cambia de objetivo.
  const [marcados, setMarcados] = useState<Set<string>>(
    () => new Set(productos.filter((p) => p.objetivos.includes(activos[0]?.id_objetivo)).map((p) => p.idProducto))
  );
  const [busqueda, setBusqueda] = useState("");
  const [marcaFiltro, setMarcaFiltro] = useState<string | null>(null);
  const [soloSinObjetivo, setSoloSinObjetivo] = useState(false);

  const cuentaPorObjetivo = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of productos) for (const o of p.objetivos) m.set(o, (m.get(o) ?? 0) + 1);
    return m;
  }, [productos]);

  const nombrePorObjetivo = useMemo(
    () => new Map(objetivos.map((o) => [o.id_objetivo, o.nombre])),
    [objetivos]
  );

  const marcasDisponibles = useMemo(
    () => [...new Set(productos.map((p) => p.marca).filter((m): m is string => Boolean(m)))].sort(),
    [productos]
  );

  const sinNingunObjetivo = useMemo(
    () => productos.filter((p) => p.objetivos.length === 0).length,
    [productos]
  );

  const duplicados = useMemo(() => {
    const porRaiz = new Map<string, Objetivo[]>();
    for (const o of activos) {
      const r = raiz(o.nombre);
      if (!r) continue;
      const lista = porRaiz.get(r);
      if (lista) lista.push(o);
      else porRaiz.set(r, [o]);
    }
    return [...porRaiz.values()].filter((g) => g.length > 1);
  }, [activos]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      if (marcaFiltro && p.marca !== marcaFiltro) return false;
      // El filtro mira la base, no lo que se está tildando ahora: si mirara lo
      // tildado, los productos irían desapareciendo a medida que se marcan.
      if (soloSinObjetivo && p.objetivos.length > 0) return false;
      if (!q) return true;
      return [p.nombre, p.marca, p.rubro].filter(Boolean).some((t) => String(t).toLowerCase().includes(q));
    });
  }, [productos, busqueda, marcaFiltro, soloSinObjetivo]);

  const original = useMemo(
    () =>
      new Set(
        elegido ? productos.filter((p) => p.objetivos.includes(elegido.id_objetivo)).map((p) => p.idProducto) : []
      ),
    [productos, elegido]
  );

  const cambios = useMemo(() => {
    let n = 0;
    for (const id of marcados) if (!original.has(id)) n++;
    for (const id of original) if (!marcados.has(id)) n++;
    return n;
  }, [marcados, original]);

  function elegirObjetivo(o: Objetivo) {
    if (cambios > 0 && !confirm("Tenés cambios sin guardar en este objetivo. ¿Los descartás?")) return;
    setElegido(o);
    setMarcados(new Set(productos.filter((p) => p.objetivos.includes(o.id_objetivo)).map((p) => p.idProducto)));
  }

  function alternar(id: string) {
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  function guardar() {
    if (!elegido) return;
    startTransition(async () => {
      const res = await guardarProductosDeObjetivo(elegido.id_objetivo, [...marcados]);
      if (res.error) setAviso({ texto: res.error, mal: true });
      else {
        setAviso({ texto: `"${elegido.nombre}" quedó con ${res.cuantos} productos.` });
        router.refresh();
      }
    });
  }

  function fusionar(sobra: Objetivo, queda: Objetivo) {
    if (
      !confirm(
        `Los productos de "${sobra.nombre}" pasan a "${queda.nombre}" y "${sobra.nombre}" se desactiva. ¿Seguimos?`
      )
    )
      return;
    startTransition(async () => {
      const res = await fusionarObjetivos(sobra.id_objetivo, queda.id_objetivo);
      if (res.error) setAviso({ texto: res.error, mal: true });
      else {
        setAviso({ texto: `Listo: ${res.movidos} productos pasaron a "${queda.nombre}".` });
        router.refresh();
      }
    });
  }

  function desactivar(o: Objetivo) {
    const cuantos = cuentaPorObjetivo.get(o.id_objetivo) ?? 0;
    if (
      !confirm(
        cuantos > 0
          ? `"${o.nombre}" tiene ${cuantos} productos y va a dejar de aparecerle al cliente. ¿Seguimos?`
          : `"${o.nombre}" va a dejar de aparecerle al cliente. ¿Seguimos?`
      )
    )
      return;
    startTransition(async () => {
      const res = await cambiarEstadoObjetivo(o.id_objetivo, false);
      if (res.error) setAviso({ texto: res.error, mal: true });
      else {
        setAviso({ texto: `"${o.nombre}" ya no aparece en el asesor.` });
        router.refresh();
      }
    });
  }

  const vacios = activos.filter((o) => (cuentaPorObjetivo.get(o.id_objetivo) ?? 0) === 0).length;

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold text-neutral-900">Objetivos del asesor</h1>
      <p className="text-sm text-neutral-500 mt-1 mb-4">
        {activos.length} objetivos · {productos.length - sinNingunObjetivo} de {productos.length} productos
        asignados
        {vacios > 0 && ` · ${vacios} ${vacios === 1 ? "objetivo" : "objetivos"} sin ningún producto`}
      </p>

      {aviso && (
        <p
          className={`mb-4 text-sm rounded-lg px-3 py-2 ${
            aviso.mal ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {aviso.texto}
        </p>
      )}

      {duplicados.map((grupo) => (
        <div
          key={grupo.map((o) => o.id_objetivo).join("-")}
          className="flex items-center gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-3"
        >
          <p className="text-sm text-neutral-700 flex-1 min-w-[260px]">
            ⚠️ <b className="text-amber-700">{grupo.map((o) => `"${o.nombre}"`).join(" y ")}</b> parecen el
            mismo objetivo. Al cliente le aparecen como dos caminos que llevan al mismo lado.
          </p>
          {grupo.slice(1).map((sobra) => (
            <button
              key={sobra.id_objetivo}
              type="button"
              onClick={() => fusionar(sobra, grupo[0])}
              disabled={guardando}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-amber-100 disabled:opacity-40"
            >
              Pasar &ldquo;{sobra.nombre}&rdquo; a &ldquo;{grupo[0].nombre}&rdquo;
            </button>
          ))}
        </div>
      ))}

      <div className="grid md:grid-cols-[260px_1fr] gap-4 items-start">
        {/* ---------- objetivos ---------- */}
        <div className="border border-neutral-200 rounded-xl overflow-hidden bg-white">
          <p className="text-[11px] uppercase tracking-wider font-bold text-neutral-400 bg-neutral-50 px-4 py-2 border-b border-neutral-200">
            Objetivos
          </p>
          {activos.map((o) => {
            const cuantos = cuentaPorObjetivo.get(o.id_objetivo) ?? 0;
            const activo = elegido?.id_objetivo === o.id_objetivo;
            return (
              <div
                key={o.id_objetivo}
                className={`flex items-center gap-2 px-4 py-2.5 border-b border-neutral-100 last:border-b-0 ${
                  activo ? "bg-accent-tint" : "hover:bg-neutral-50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => elegirObjetivo(o)}
                  className="flex-1 min-w-0 text-left"
                >
                  <span className={`block text-sm truncate ${activo ? "font-semibold" : ""}`}>{o.nombre}</span>
                </button>
                <span
                  className={`text-xs font-bold tabular-nums shrink-0 ${
                    cuantos === 0 ? "text-red-500" : activo ? "text-accent-dark" : "text-neutral-400"
                  }`}
                >
                  {cuantos}
                </span>
                <button
                  type="button"
                  onClick={() => desactivar(o)}
                  disabled={guardando}
                  title="Sacarlo del asesor"
                  className="text-neutral-300 hover:text-red-500 text-sm shrink-0 disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            );
          })}
          {activos.length === 0 && (
            <p className="text-sm text-neutral-500 px-4 py-6 text-center">
              No hay objetivos activos. Se crean desde Catálogo asesor.
            </p>
          )}
        </div>

        {/* ---------- productos ---------- */}
        <div className="border border-neutral-200 rounded-xl overflow-hidden bg-white">
          <p className="text-[11px] uppercase tracking-wider font-bold text-neutral-400 bg-neutral-50 px-4 py-2 border-b border-neutral-200">
            {elegido ? `Productos para "${elegido.nombre}"` : "Elegí un objetivo"}
          </p>

          <div className="flex gap-2 px-3 py-2.5 border-b border-neutral-200 bg-neutral-50 flex-wrap">
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto…"
              className="flex-1 min-w-[160px] rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {marcasDisponibles.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMarcaFiltro(marcaFiltro === m ? null : m)}
                className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium border ${
                  marcaFiltro === m
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white border-neutral-300 text-neutral-600"
                }`}
              >
                {m}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSoloSinObjetivo(!soloSinObjetivo)}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium border ${
                soloSinObjetivo
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white border-neutral-300 text-neutral-600"
              }`}
            >
              Solo sin objetivo · {sinNingunObjetivo}
            </button>
          </div>

          {elegido && visibles.length > 0 && (
            <div className="px-4 py-2 border-b border-neutral-200 flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setMarcados((prev) => {
                    const s = new Set(prev);
                    const todos = visibles.every((p) => s.has(p.idProducto));
                    visibles.forEach((p) => (todos ? s.delete(p.idProducto) : s.add(p.idProducto)));
                    return s;
                  })
                }
                className="text-xs text-accent font-medium"
              >
                {visibles.every((p) => marcados.has(p.idProducto))
                  ? `Desmarcar los ${visibles.length} visibles`
                  : `Marcar los ${visibles.length} visibles`}
              </button>
            </div>
          )}

          <div className="max-h-[520px] overflow-y-auto">
            {!elegido ? (
              <p className="text-sm text-neutral-500 px-4 py-10 text-center">
                Elegí un objetivo de la izquierda.
              </p>
            ) : visibles.length === 0 ? (
              <p className="text-sm text-neutral-500 px-4 py-10 text-center">Ningún producto coincide.</p>
            ) : (
              visibles.map((p) => {
                const otros = p.objetivos
                  .filter((id) => id !== elegido.id_objetivo)
                  .map((id) => nombrePorObjetivo.get(id))
                  .filter(Boolean) as string[];
                return (
                  <label
                    key={p.idProducto}
                    className="flex items-center gap-3 px-4 py-2 border-b border-neutral-100 last:border-b-0 cursor-pointer hover:bg-neutral-50"
                  >
                    <input
                      type="checkbox"
                      checked={marcados.has(p.idProducto)}
                      onChange={() => alternar(p.idProducto)}
                      className="w-4 h-4 accent-accent shrink-0"
                    />
                    <span className="w-8 h-8 rounded-lg bg-neutral-100 overflow-hidden shrink-0 grid place-items-center text-neutral-300">
                      {p.imagen ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imagen} alt="" className="w-full h-full object-contain" loading="lazy" />
                      ) : (
                        "—"
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm truncate">{p.nombre}</span>
                      <span className="block text-xs text-neutral-400">
                        {[p.marca, p.rubro].filter(Boolean).join(" · ") || "sin rubro"}
                      </span>
                    </span>
                    {otros.length > 0 && (
                      <span className="shrink-0 hidden lg:flex items-center gap-1 text-[10px] text-neutral-400">
                        también en
                        {otros.slice(0, 2).map((n) => (
                          <span key={n} className="bg-neutral-100 rounded px-1.5 py-0.5 text-neutral-500">
                            {n}
                          </span>
                        ))}
                        {otros.length > 2 && <span>+{otros.length - 2}</span>}
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>
        </div>
      </div>

      {elegido && (
        <div className="mt-4 flex items-center gap-3 flex-wrap bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3">
          <span className="text-sm text-neutral-600 mr-auto">
            <b className="text-neutral-900">{marcados.size}</b> productos en &ldquo;{elegido.nombre}&rdquo;
            {cambios > 0 && (
              <>
                {" · "}
                <b className="text-neutral-900">{cambios}</b> {cambios === 1 ? "cambio" : "cambios"} sin
                guardar
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => setMarcados(new Set(original))}
            disabled={cambios === 0 || guardando}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            Deshacer
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={cambios === 0 || guardando}
            className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-semibold hover:bg-accent-dark disabled:opacity-40"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}
