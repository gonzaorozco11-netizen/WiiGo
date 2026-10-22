"use client";

import { useEffect, useState } from "react";
import { marcarRepasado, preguntasDePrueba, registrarRespuesta, type DatosAprender, type PreguntaPrueba, type TemaAprender, type ProductoAprender } from "@/app/(app)/aprender/actions";

// Aprender: el equipo estudia los productos por tema y se pone a prueba.
// Solo muestra lo que administración ya aprobó.

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

export default function AprenderApp({ datos }: { datos: DatosAprender }) {
  const [marca, setMarca] = useState<string | null>(null);
  const [tema, setTema] = useState<TemaAprender | null>(null);
  const [prueba, setPrueba] = useState(false);
  const [repasados, setRepasados] = useState<Set<string>>(
    () => new Set(datos.temas.flatMap((t) => t.productos.filter((p) => p.repasado).map((p) => p.idProducto)))
  );

  const filtrar = (ps: ProductoAprender[]) => (marca ? ps.filter((p) => p.marca === marca) : ps);
  const temas = datos.temas.map((t) => ({ ...t, productos: filtrar(t.productos) })).filter((t) => t.productos.length > 0);
  const total = temas.reduce((a, t) => a + t.productos.length, 0);
  const hechos = temas.reduce((a, t) => a + t.productos.filter((p) => repasados.has(p.idProducto)).length, 0);

  function alternar(idProducto: string) {
    const ya = repasados.has(idProducto);
    setRepasados((s) => {
      const n = new Set(s);
      if (ya) n.delete(idProducto);
      else n.add(idProducto);
      return n;
    });
    marcarRepasado(idProducto, !ya);
  }

  if (datos.faltaSql) {
    return <p className="max-w-2xl mx-auto text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">Para usar Aprender falta correr sql/aprender.sql en Supabase.</p>;
  }
  if (prueba) return <Prueba onSalir={() => setPrueba(false)} />;
  if (tema) {
    const t = temas.find((x) => x.clave === tema.clave) ?? tema;
    return <VistaTema tema={t} repasados={repasados} onAlternar={alternar} onVolver={() => setTema(null)} />;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="bg-white border border-neutral-200 rounded-xl p-5">
        <h1 className="text-xl font-semibold text-neutral-900">Aprender</h1>
        <p className="text-sm text-neutral-500 mt-0.5">Conocé lo que vendemos para asesorar mejor a cada cliente.</p>
        {datos.total > 0 && (
          <>
            <p className="text-sm text-neutral-600 mt-3">
              Repasaste <b>{hechos}</b> de <b>{total}</b> productos
            </p>
            <div className="h-2 rounded-full bg-neutral-100 mt-1.5 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${total ? (hechos / total) * 100 : 0}%` }} />
            </div>
            {datos.marcas.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {[null, ...datos.marcas].map((m) => (
                  <button
                    key={m ?? "todas"}
                    type="button"
                    onClick={() => setMarca(m)}
                    className={`text-xs font-semibold rounded-full px-3 py-1.5 border ${marca === m ? "bg-accent-tint text-accent border-transparent" : "bg-white border-neutral-200 text-neutral-600"}`}
                  >
                    {m ?? "Todas las marcas"}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {datos.total === 0 ? (
        <p className="text-sm text-neutral-500 text-center py-12 bg-white border border-neutral-200 rounded-xl">
          Todavía no hay explicaciones para estudiar. Van apareciendo acá a medida que se cargan los productos y administración las aprueba.
        </p>
      ) : (
        <>
          <button type="button" onClick={() => setPrueba(true)} className="w-full flex items-center gap-3 rounded-2xl bg-accent hover:bg-accent-dark text-white px-5 py-4 text-left">
            <span className="text-3xl" aria-hidden="true">
              🧠
            </span>
            <span>
              <span className="block text-lg font-bold">Ponete a prueba</span>
              <span className="block text-sm opacity-90">10 preguntas cortas, primero de lo que ya repasaste</span>
            </span>
            <span className="ml-auto text-2xl" aria-hidden="true">
              →
            </span>
          </button>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {temas.map((t) => {
              const hechosTema = t.productos.filter((p) => repasados.has(p.idProducto)).length;
              const marcasTema = [...new Set(t.productos.map((p) => p.marca))].join(" y ");
              return (
                <button key={t.clave} type="button" onClick={() => setTema(t)} className="text-left bg-white border border-neutral-200 rounded-xl p-4 hover:border-accent">
                  <span className="text-2xl" aria-hidden="true">
                    {t.ficha?.icono ?? "📦"}
                  </span>
                  <span className="block text-[15px] font-semibold text-neutral-900 mt-1">{t.nombre}</span>
                  <span className="block text-xs text-neutral-500">
                    {t.productos.length} {t.productos.length === 1 ? "producto" : "productos"} · {marcasTema}
                  </span>
                  <span className="block h-1.5 rounded-full bg-neutral-100 mt-2 overflow-hidden">
                    <span className="block h-full bg-emerald-500" style={{ width: `${(hechosTema / t.productos.length) * 100}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function VistaTema({
  tema,
  repasados,
  onAlternar,
  onVolver,
}: {
  tema: TemaAprender;
  repasados: Set<string>;
  onAlternar: (id: string) => void;
  onVolver: () => void;
}) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const f = tema.ficha;
  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <button type="button" onClick={onVolver} className="text-sm font-semibold text-accent">
        ← Todos los temas
      </button>
      <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-2.5">
        <h1 className="text-xl font-semibold text-neutral-900">
          {f?.icono ?? "📦"} {tema.nombre}
        </h1>
        {f ? (
          <>
            <Bloque titulo="Qué es" texto={f.queEs} />
            <Bloque titulo="Para quién" texto={f.paraQuien} />
            <Bloque titulo="Cómo se usa" texto={f.comoSeUsa} />
            <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">💡 Para asesorar: {f.consejo}</p>
          </>
        ) : (
          <p className="text-sm text-neutral-500">La introducción de este tema todavía no está aprobada.</p>
        )}
      </div>

      <p className="text-xs font-bold uppercase tracking-wider text-neutral-400 pt-1">Los productos</p>
      {tema.productos.map((p) => {
        const ya = repasados.has(p.idProducto);
        const ver = abierto === p.idProducto;
        return (
          <div key={p.idProducto} className="bg-white border border-neutral-200 rounded-xl p-3.5">
            <button type="button" onClick={() => setAbierto(ver ? null : p.idProducto)} className="w-full flex items-center gap-3 text-left">
              {p.imagen ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imagen} alt="" className="w-14 h-14 rounded-lg object-cover bg-neutral-100 shrink-0" />
              ) : (
                <span className="w-14 h-14 rounded-lg bg-neutral-100 shrink-0 grid place-items-center text-xl" aria-hidden="true">
                  {tema.ficha?.icono ?? "📦"}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold text-neutral-900">{p.nombre}</span>
                <span className="block text-xs text-neutral-500">
                  {p.marca}
                  {p.precio ? ` · ${pesos(p.precio)}` : ""}
                </span>
                <span className="block text-[13px] text-neutral-600 mt-0.5">{p.ficha.loDistinto || p.ficha.paraQueSirve}</span>
              </span>
              {ya ? (
                <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 shrink-0">✓ Repasado</span>
              ) : (
                <span className="text-neutral-300 shrink-0">{ver ? "▾" : "▸"}</span>
              )}
            </button>
            {ver && (
              <div className="mt-3 pt-3 border-t border-neutral-100 space-y-2">
                <Bloque titulo="Para qué sirve" texto={p.ficha.paraQueSirve} />
                <Bloque titulo="Para quién" texto={p.ficha.paraQuien} />
                <Bloque titulo="Cómo se usa" texto={p.ficha.comoSeUsa} />
                <Bloque titulo="Lo distinto" texto={p.ficha.loDistinto} />
                <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">💡 {p.ficha.consejo}</p>
                <button
                  type="button"
                  onClick={() => onAlternar(p.idProducto)}
                  className={`text-sm font-semibold rounded-lg px-4 py-2 ${ya ? "text-neutral-500 border border-neutral-200" : "text-white bg-emerald-600 hover:bg-emerald-700"}`}
                >
                  {ya ? "Desmarcar" : "✓ Ya lo repasé"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Bloque({ titulo, texto }: { titulo: string; texto: string }) {
  if (!texto) return null;
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">{titulo}</p>
      <p className="text-sm text-neutral-800 leading-relaxed">{texto}</p>
    </div>
  );
}

function Prueba({ onSalir }: { onSalir: () => void }) {
  const [preguntas, setPreguntas] = useState<PreguntaPrueba[] | null>(null);
  const [i, setI] = useState(0);
  const [elegida, setElegida] = useState<number | null>(null);
  const [bien, setBien] = useState(0);

  useEffect(() => {
    if (preguntas === null) preguntasDePrueba().then(setPreguntas);
  }, [preguntas]);
  if (!preguntas) return <p className="text-sm text-neutral-400 text-center py-16">Armando las preguntas…</p>;
  if (preguntas.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-12 space-y-3">
        <p className="text-sm text-neutral-500">Todavía no hay preguntas para hacer.</p>
        <button type="button" onClick={onSalir} className="text-sm font-semibold text-accent">
          ← Volver
        </button>
      </div>
    );
  }
  if (i >= preguntas.length) {
    const pct = Math.round((bien / preguntas.length) * 100);
    return (
      <div className="max-w-md mx-auto text-center py-12 space-y-3 bg-white border border-neutral-200 rounded-2xl px-6">
        <div className="text-5xl">{pct >= 80 ? "🏆" : pct >= 50 ? "👍" : "📚"}</div>
        <h1 className="text-xl font-bold text-neutral-900">
          {bien} de {preguntas.length} bien
        </h1>
        <p className="text-sm text-neutral-600">{pct >= 80 ? "¡Muy bien! Sabés asesorar." : pct >= 50 ? "Vas bien. Repasá los que fallaste." : "Repasá los temas y probá de nuevo."}</p>
        <div className="flex justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => {
              setPreguntas(null);
              setI(0);
              setBien(0);
              setElegida(null);
            }}
            className="text-sm font-bold text-white bg-accent rounded-xl px-5 py-2.5"
          >
            Otra vuelta
          </button>
          <button type="button" onClick={onSalir} className="text-sm font-semibold text-neutral-500 px-3">
            Volver a los temas
          </button>
        </div>
      </div>
    );
  }

  const q = preguntas[i];
  function elegir(n: number) {
    if (elegida !== null) return;
    setElegida(n);
    const ok = n === q.correcta;
    if (ok) setBien((b) => b + 1);
    registrarRespuesta(q.idProducto, ok);
  }

  return (
    <div className="max-w-md mx-auto space-y-3">
      <div className="flex justify-between text-sm text-neutral-500">
        <button type="button" onClick={onSalir} className="font-semibold text-accent">
          ← Salir
        </button>
        <span>
          Pregunta {i + 1} de {preguntas.length} · ✓ {bien}
        </span>
      </div>
      <div className="bg-white border border-neutral-200 rounded-2xl p-5 space-y-3 text-center">
        {q.imagen && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.imagen} alt="" className="w-28 h-28 rounded-xl object-cover mx-auto bg-neutral-100" />
        )}
        <p className="text-sm font-semibold text-neutral-500">
          {q.producto} · {q.marca}
        </p>
        <p className="text-lg font-bold text-neutral-900">{q.pregunta}</p>
        <div className="space-y-2 text-left">
          {q.opciones.map((op, n) => {
            const estado = elegida === null ? "" : n === q.correcta ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-semibold" : n === elegida ? "border-red-300 bg-red-50 text-red-700" : "opacity-50";
            return (
              <button key={n} type="button" onClick={() => elegir(n)} className={`w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm ${estado}`}>
                {elegida !== null && n === q.correcta ? "✓ " : ""}
                {op}
              </button>
            );
          })}
        </div>
        {elegida !== null && (
          <>
            <p className={`text-sm text-left rounded-xl px-3 py-2 ${elegida === q.correcta ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
              {elegida === q.correcta ? "¡Bien! " : "No era esa. "}
              {q.explicacion}
            </p>
            <button
              type="button"
              onClick={() => {
                setI(i + 1);
                setElegida(null);
              }}
              className="w-full text-sm font-bold text-white bg-accent rounded-xl py-3"
            >
              {i + 1 < preguntas.length ? "Siguiente" : "Ver cómo me fue"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
