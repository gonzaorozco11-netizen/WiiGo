"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { marcarRepasado, type DatosAprender, type ProductoAprender } from "@/app/(app)/aprender/actions";
import { empezarRonda, responder, siguientePregunta, type PreguntaVisible, type ResumenAprender } from "@/app/(app)/aprender/rondas";

// Aprender (Gonzalo, 2026-11-16, maqueta aprobada): «Las 5 de hoy» con racha,
// la evaluación de la semana con ranking, y las fichas cortas de cada producto.
// Cada pregunta tiene 15 segundos: no da para ir a la góndola a mirar. Si se
// acaba el tiempo o sale de la pantalla, cuenta mal. Lo corrige el servidor.

type Tipo = "DIA" | "SEMANA";
type Corregida = { bien: boolean; fueraDeTiempo: boolean; correctas: number[]; explicacion: string; idProducto: string | null; terminada: boolean; totalBien: number; total: number };
type Juego = {
  tipo: Tipo;
  idRonda: string;
  total: number;
  i: number;
  bien: number;
  pregunta: PreguntaVisible | null;
  limite: number;
  /** Segundos que ya habían pasado al mostrarla (si recargó): la barra arranca desde ahí. */
  yaPasoS: number;
  elegidas: number[];
  resp: Corregida | null;
};
type Vista = { pant: "inicio" } | { pant: "juego" } | { pant: "resultado"; tipo: Tipo; bien: number; total: number } | { pant: "ficha"; id: string; volverAJuego: boolean };

function sonido(bien: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = new Ctx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.connect(g);
    g.connect(c.destination);
    o.type = "sine";
    o.frequency.setValueAtTime(bien ? 660 : 220, c.currentTime);
    if (bien) o.frequency.setValueAtTime(880, c.currentTime + 0.09);
    g.gain.setValueAtTime(0.08, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
    o.start();
    o.stop(c.currentTime + 0.3);
  } catch {
    // Sin sonido.
  }
}

const hoyLargo = () => new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

export default function AprenderApp({ datos, resumen }: { datos: DatosAprender; resumen: ResumenAprender }) {
  const router = useRouter();
  const [vista, setVista] = useState<Vista>({ pant: "inicio" });
  const [juego, setJuego] = useState<Juego | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const enviando = useRef(false);
  const [repasados, setRepasados] = useState<Set<string>>(() => new Set(datos.temas.flatMap((t) => t.productos.filter((p) => p.repasado).map((p) => p.idProducto))));
  const productos = new Map(datos.temas.flatMap((t) => t.productos.map((p) => [p.idProducto, p] as const)));

  const cargarSiguiente = useCallback(async (idRonda: string, tipo: Tipo) => {
    const r = await siguientePregunta(idRonda);
    if ("error" in r) return setError(r.error);
    if (r.fin) {
      setJuego(null);
      setVista({ pant: "resultado", tipo, bien: r.bien, total: r.total });
      router.refresh();
      return;
    }
    setJuego({
      tipo,
      idRonda,
      total: r.total,
      i: r.i,
      bien: r.bien,
      pregunta: r.pregunta,
      limite: Date.now() + r.quedanMs,
      yaPasoS: Math.max(0, resumen.segundos - r.quedanMs / 1000),
      elegidas: [],
      resp: null,
    });
    setVista({ pant: "juego" });
  }, [router, resumen.segundos]);

  async function empezar(tipo: Tipo) {
    setError(null);
    setOcupado(true);
    try {
      const r = await empezarRonda(tipo);
      if ("error" in r) return setError(r.error);
      if (r.terminada) {
        setVista({ pant: "resultado", tipo, bien: r.bien, total: r.total });
        return;
      }
      await cargarSiguiente(r.idRonda, tipo);
    } finally {
      setOcupado(false);
    }
  }

  const contestar = useCallback(async (elegidas: number[]) => {
    if (!juego || juego.resp || enviando.current) return;
    enviando.current = true;
    try {
      const r = await responder(juego.idRonda, juego.i, elegidas);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      sonido(r.bien);
      setJuego((j) => (j ? { ...j, elegidas, resp: r, bien: r.totalBien } : j));
    } finally {
      enviando.current = false;
    }
  }, [juego]);

  // Sale de la pantalla (cambia de app, apaga la tablet) en plena pregunta: cuenta mal.
  useEffect(() => {
    const alOcultar = () => {
      if (document.hidden && vista.pant === "juego" && juego?.pregunta && !juego.resp) contestar([]);
    };
    document.addEventListener("visibilitychange", alOcultar);
    return () => document.removeEventListener("visibilitychange", alOcultar);
  }, [vista.pant, juego, contestar]);

  function alternarRepasado(id: string) {
    const ya = repasados.has(id);
    setRepasados((s) => {
      const n = new Set(s);
      if (ya) n.delete(id);
      else n.add(id);
      return n;
    });
    marcarRepasado(id, !ya);
  }

  if (vista.pant === "ficha") {
    const p = productos.get(vista.id);
    if (p) {
      return (
        <Ficha
          p={p}
          repasado={repasados.has(p.idProducto)}
          onRepasado={() => alternarRepasado(p.idProducto)}
          volverTexto={vista.volverAJuego ? "Volver a la pregunta" : "Volver"}
          onVolver={() => setVista(vista.volverAJuego ? { pant: "juego" } : { pant: "inicio" })}
        />
      );
    }
  }

  if (vista.pant === "resultado") return <Resultado {...vista} racha={resumen.racha} onVolver={() => { setVista({ pant: "inicio" }); router.refresh(); }} />;

  if (vista.pant === "juego" && juego?.pregunta) {
    return (
      <Pregunta
        juego={juego}
        segundos={resumen.segundos}
        error={error}
        onElegir={(k) => {
          const q = juego.pregunta!;
          if (juego.resp) return;
          if (q.tipo === "multi") {
            setJuego((j) => (j ? { ...j, elegidas: j.elegidas.includes(k) ? j.elegidas.filter((x) => x !== k) : [...j.elegidas, k] } : j));
          } else contestar([k]);
        }}
        onListo={() => contestar(juego.elegidas)}
        onTiempo={() => contestar([])}
        onSiguiente={() => {
          if (juego.resp?.terminada) {
            setVista({ pant: "resultado", tipo: juego.tipo, bien: juego.resp.totalBien, total: juego.resp.total });
            setJuego(null);
            router.refresh();
          } else cargarSiguiente(juego.idRonda, juego.tipo);
        }}
        onVerFicha={juego.resp?.idProducto && productos.has(juego.resp.idProducto) ? () => setVista({ pant: "ficha", id: juego.resp!.idProducto!, volverAJuego: true }) : null}
        onSalir={() => {
          setJuego(null);
          setVista({ pant: "inicio" });
          router.refresh();
        }}
      />
    );
  }

  return (
    <Inicio
      datos={datos}
      resumen={resumen}
      repasados={repasados}
      error={error}
      ocupado={ocupado}
      onEmpezar={empezar}
      onFicha={(id) => setVista({ pant: "ficha", id, volverAJuego: false })}
    />
  );
}

// ---------------- Inicio ----------------

function Inicio({
  datos,
  resumen,
  repasados,
  error,
  ocupado,
  onEmpezar,
  onFicha,
}: {
  datos: DatosAprender;
  resumen: ResumenAprender;
  repasados: Set<string>;
  error: string | null;
  ocupado: boolean;
  onEmpezar: (t: Tipo) => void;
  onFicha: (id: string) => void;
}) {
  const [tema, setTema] = useState(datos.temas[0]?.clave ?? "");
  const { hoy, semana } = resumen;
  const temaActual = datos.temas.find((t) => t.clave === tema) ?? datos.temas[0];
  const total = datos.temas.reduce((a, t) => a + t.productos.length, 0);
  const vistos = datos.temas.reduce((a, t) => a + t.productos.filter((p) => repasados.has(p.idProducto)).length, 0);
  const yoEnRanking = resumen.ranking.some((r) => r.yo);

  return (
    <div className="max-w-md mx-auto flex flex-col gap-3.5 pb-8">
      <div className="flex items-center gap-2.5">
        <h1 className="text-2xl font-black tracking-tight text-neutral-900">Aprender</h1>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-sm font-extrabold text-orange-800" title="Días seguidos haciendo las 5 de hoy">
          <span className="ap-llama" aria-hidden="true">
            🔥
          </span>
          {resumen.racha} {resumen.racha === 1 ? "día" : "días"}
        </span>
      </div>

      {(resumen.faltaSql || datos.faltaSql) && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Falta correr {datos.faltaSql ? "sql/aprender.sql" : "sql/aprender-rondas.sql"} en Supabase.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Las 5 de hoy */}
      <section className="relative overflow-hidden rounded-[20px] bg-accent p-4 text-white">
        <span aria-hidden="true" className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <p className="text-xs font-extrabold uppercase tracking-[0.08em] opacity-80">Hoy · {hoyLargo()}</p>
        <h2 className="mt-1 text-[22px] font-black">Las {hoy.total} de hoy</h2>
        <p className="mb-3.5 text-sm opacity-90">
          {hoy.terminada ? `Listo por hoy: ${hoy.bien} de ${hoy.total} bien. Mañana hay ${hoy.total} nuevas.` : `${hoy.total} preguntas, ${resumen.segundos} segundos cada una.`}
        </p>
        <div className="mb-3.5 flex gap-1.5" aria-label={`${hoy.hechas} de ${hoy.total} hechas`}>
          {Array.from({ length: hoy.total }, (_, i) => (
            <i key={i} className={`h-2 w-8 rounded-full ${i < hoy.hechas ? "bg-white" : "bg-white/30"}`} />
          ))}
        </div>
        {hoy.terminada ? (
          <div className="flex items-center gap-2.5 rounded-[14px] bg-white/15 px-3.5 py-3 font-extrabold">✓ Hechas · sumaste un día de racha</div>
        ) : (
          <button type="button" disabled={ocupado || resumen.faltaSql} onClick={() => onEmpezar("DIA")} className="w-full rounded-[14px] bg-white py-3.5 text-base font-extrabold text-accent-dark disabled:opacity-50">
            {ocupado ? "Armando…" : hoy.hechas > 0 ? "Seguir" : "Empezar"}
          </button>
        )}
      </section>

      {/* La evaluación de la semana */}
      <section className="grid gap-2.5 rounded-[20px] border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-2.5">
          <h3 className="text-[17px] font-extrabold text-neutral-900">Evaluación de la semana</h3>
          <span className="ml-auto whitespace-nowrap rounded-full bg-accent-tint px-2.5 py-0.5 text-[11.5px] font-extrabold text-accent-dark">
            {semana.terminada ? `${semana.bien}/${semana.total}` : `${semana.total} preguntas`}
          </span>
        </div>
        <span className="text-[12.5px] font-semibold text-neutral-500">
          {semana.cerrada ? "Ya cerró. La próxima abre el lunes." : "Se hace una vez · cierra el domingo a las 21:00"}
        </span>
        {(resumen.ranking.length > 0 || !semana.terminada) && (
          <ol className="grid gap-1">
            {resumen.ranking.map((r, i) => (
              <li key={`${r.nombre}-${i}`} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-sm ${r.yo ? "bg-accent-tint font-bold" : ""}`}>
                <span className={`w-5 text-center font-black ${i === 0 ? "text-yellow-600" : "text-neutral-400"}`}>{i === 0 ? "★" : i + 1}</span>
                <span className="w-20 truncate">{r.nombre}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                  <b className="block h-full rounded-full bg-accent" style={{ width: `${(r.bien / Math.max(1, r.total)) * 100}%` }} />
                </span>
                <span className="w-10 text-right font-extrabold tabular-nums">
                  {r.bien}/{r.total}
                </span>
              </li>
            ))}
            {!yoEnRanking && (
              <li className="flex items-center gap-2.5 rounded-xl bg-accent-tint px-2.5 py-1.5 text-sm font-bold">
                <span className="w-5 text-center text-neutral-400">·</span>
                <span className="w-20">Vos</span>
                <span className="h-1.5 flex-1 rounded-full bg-neutral-100" />
                <span className="w-10 text-right">—</span>
              </li>
            )}
          </ol>
        )}
        {!semana.terminada && !semana.cerrada && (
          semana.soloTablet ? (
            <p className="rounded-xl bg-neutral-50 px-3 py-2.5 text-sm text-neutral-600">La evaluación se hace en la tablet del local, con el turno.</p>
          ) : (
            <button type="button" disabled={ocupado || resumen.faltaSql} onClick={() => onEmpezar("SEMANA")} className="w-full rounded-[14px] bg-accent py-3.5 text-base font-extrabold text-white disabled:opacity-50">
              {semana.hechas > 0 ? "Seguir la evaluación" : "Hacer la evaluación"}
            </button>
          )
        )}
      </section>

      {/* Estudiar */}
      {total > 0 && temaActual && (
        <>
          <div className="mx-0.5 mt-1.5 flex items-baseline justify-between">
            <h2 className="text-[13px] font-extrabold uppercase tracking-[0.08em] text-neutral-500">Estudiar los productos</h2>
            <span className="text-[12.5px] text-neutral-500">
              {vistos} de {total} vistos
            </span>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {datos.temas.map((t) => (
              <button
                key={t.clave}
                type="button"
                onClick={() => setTema(t.clave)}
                aria-pressed={t.clave === temaActual.clave}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 py-2 text-sm font-bold ${
                  t.clave === temaActual.clave ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-800"
                }`}
              >
                {t.nombre} <em className="text-xs not-italic opacity-60">{t.productos.length}</em>
              </button>
            ))}
          </div>
          <div className="grid gap-2">
            {temaActual.productos.map((p) => {
              const ya = repasados.has(p.idProducto);
              return (
                <button key={p.idProducto} type="button" onClick={() => onFicha(p.idProducto)} className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-2.5 text-left">
                  {p.imagen ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imagen} alt="" className="h-13 w-13 shrink-0 rounded-xl bg-neutral-50 object-contain" loading="lazy" />
                  ) : (
                    <span aria-hidden="true" className="grid h-13 w-13 shrink-0 place-items-center rounded-xl bg-neutral-50 text-xl">
                      {temaActual.ficha?.icono ?? "📦"}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <b className="block text-[14.5px] leading-tight text-neutral-900">{p.nombre}</b>
                    <small className="text-[12.5px] text-neutral-500">{p.marca}</small>
                  </span>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-[13px] text-white ${ya ? "border-emerald-600 bg-emerald-600" : "border-neutral-200"}`}>
                    {ya ? "✓" : ""}
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

// ---------------- Una pregunta ----------------

function Pregunta({
  juego,
  segundos,
  error,
  onElegir,
  onListo,
  onTiempo,
  onSiguiente,
  onVerFicha,
  onSalir,
}: {
  juego: Juego;
  segundos: number;
  error: string | null;
  onElegir: (k: number) => void;
  onListo: () => void;
  onTiempo: () => void;
  onSiguiente: () => void;
  onVerFicha: (() => void) | null;
  onSalir: () => void;
}) {
  const q = juego.pregunta!;
  const resp = juego.resp;
  const [quedan, setQuedan] = useState(() => Math.max(0, Math.ceil((juego.limite - Date.now()) / 1000)));
  const avisado = useRef(false);

  // El reloj: el límite lo puso el servidor al mostrarla; no se reinicia al tocar opciones.
  useEffect(() => {
    avisado.current = false;
    if (resp) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((juego.limite - Date.now()) / 1000));
      setQuedan(s);
      if (s <= 0 && !avisado.current) {
        avisado.current = true;
        clearInterval(t);
        onTiempo();
      }
    }, 250);
    return () => clearInterval(t);
  }, [juego.limite, juego.i, resp, onTiempo]);

  const transcurrido = juego.yaPasoS;
  const claseOps = q.tipo === "num" ? "grid grid-cols-4 gap-2.5" : q.tipo === "vf" ? "grid grid-cols-2 gap-2.5" : q.tipo === "multi" ? "flex flex-wrap gap-2" : "grid gap-2.5";
  const grande = q.tipo === "num" || q.tipo === "vf";

  return (
    <div className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-md flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onSalir} aria-label="Salir" className="h-9 w-9 rounded-lg text-2xl text-neutral-400 hover:bg-neutral-100">
          ✕
        </button>
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
          <b className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${((juego.i + (resp ? 1 : 0)) / juego.total) * 100}%` }} />
        </div>
        <span className="text-sm font-extrabold tabular-nums text-neutral-500">
          {juego.i + 1}/{juego.total}
        </span>
      </div>

      {/* 15 segundos: no da para ir a la góndola a mirar. */}
      <div className="flex items-center gap-2.5">
        <b
          key={`${juego.idRonda}-${juego.i}`}
          className={`block h-2 flex-1 rounded-full bg-gradient-to-r from-orange-500 to-yellow-400 ${resp ? "opacity-25" : "ap-reloj"}`}
          style={resp ? undefined : { animationDuration: `${segundos}s`, animationDelay: `-${transcurrido}s` }}
        />
        <span className="min-w-8 text-right text-[13px] font-extrabold tabular-nums text-orange-500">{resp ? "" : `${quedan} s`}</span>
      </div>

      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-accent">{q.etiqueta}</p>
        {q.producto && q.tipo === "una" && !q.pregunta.includes(q.producto) && <p className="text-[13px] font-semibold text-neutral-500">Sobre: {q.producto}</p>}
        <p className="mt-0.5 text-[22px] font-extrabold leading-tight text-neutral-900 text-balance">{q.pregunta}</p>
      </div>

      {q.imagen && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={q.imagen} alt="Foto del producto" className="h-48 w-48 self-center rounded-3xl border border-neutral-200 bg-white object-contain p-3" />
      )}

      <div className={claseOps}>
        {q.opciones.map((o, k) => {
          const elegida = juego.elegidas.includes(k);
          let cls = "border-neutral-200 bg-white text-neutral-900";
          if (resp) cls = resp.correctas.includes(k) ? "border-emerald-600 bg-emerald-50 text-emerald-900" : elegida ? "border-red-600 bg-red-50 text-red-800" : "border-neutral-200 bg-white opacity-45";
          else if (elegida) cls = "border-accent bg-accent-tint text-accent-dark";
          return (
            <button
              key={k}
              type="button"
              disabled={Boolean(resp)}
              aria-pressed={elegida}
              onClick={() => onElegir(k)}
              className={`ap-op border-2 font-bold ${cls} ${
                q.tipo === "multi" ? "rounded-full px-4 py-2.5 text-[15px]" : grande ? "rounded-2xl px-2 py-4 text-center text-xl font-black" : "rounded-2xl px-3.5 py-3.5 text-left text-base"
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="sticky bottom-0 mt-auto pt-2">
        {resp ? (
          <div className={`ap-sube grid gap-2.5 rounded-[20px] p-4 ${resp.bien ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
            <h3 className="flex items-center gap-2 text-xl font-black">{resp.bien ? "¡Bien! 🎉" : resp.fueraDeTiempo ? "⏱ Se acabó el tiempo" : "Casi…"}</h3>
            {resp.explicacion && <p className="text-[14.5px] text-neutral-800">{resp.explicacion}</p>}
            {onVerFicha && (
              <button type="button" onClick={onVerFicha} className="text-left text-sm font-bold underline">
                Ver la ficha del producto
              </button>
            )}
            <button type="button" onClick={onSiguiente} className={`w-full rounded-[14px] py-3.5 text-base font-extrabold text-white ${resp.bien ? "bg-emerald-600" : "bg-red-600"}`}>
              {resp.terminada ? "Ver cómo me fue" : "Siguiente"}
            </button>
          </div>
        ) : (
          q.tipo === "multi" && (
            <button type="button" disabled={juego.elegidas.length === 0} onClick={onListo} className="w-full rounded-[14px] bg-accent py-3.5 text-base font-extrabold text-white disabled:opacity-40">
              Listo
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ---------------- Resultado ----------------

function Resultado({ tipo, bien, total, racha, onVolver }: { tipo: Tipo; bien: number; total: number; racha: number; onVolver: () => void }) {
  const ok = bien >= total * 0.7;
  const [papelitos] = useState(() =>
    Array.from({ length: 40 }, (_, i) => ({ left: Math.random() * 100, delay: Math.random() * 0.6, color: ["#2563eb", "#f97316", "#059669", "#facc15", "#ec4899"][i % 5] }))
  );
  return (
    <div className="mx-auto grid max-w-md justify-items-center gap-3 pt-8 text-center">
      <div className="ap-pop grid h-24 w-24 place-items-center rounded-full bg-orange-50 text-5xl" aria-hidden="true">
        {bien === total ? "🏆" : ok ? "⭐" : "💪"}
      </div>
      <div className="text-6xl font-black leading-none tabular-nums text-neutral-900">
        {bien}
        <small className="text-3xl text-neutral-400">/{total}</small>
      </div>
      <h2 className="text-2xl font-black text-neutral-900">{bien === total ? "¡Perfecto!" : ok ? "¡Muy bien!" : "Vas aprendiendo"}</h2>
      <p className="max-w-[30ch] text-neutral-500">
        {tipo === "DIA" ? `🔥 Racha de ${Math.max(racha, 1)} ${Math.max(racha, 1) === 1 ? "día" : "días"}. Mañana hay ${total} nuevas.` : "Quedó tu nota de la semana. El ranking cierra el domingo a las 21:00."}
      </p>
      <button type="button" onClick={onVolver} className="w-full max-w-xs rounded-[14px] bg-accent py-3.5 text-base font-extrabold text-white">
        Volver
      </button>
      {ok && (
        <div className="ap-lluvia" aria-hidden="true">
          {papelitos.map((p, i) => (
            <i key={i} style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s` }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Ficha corta del producto ----------------

function Ficha({ p, repasado, onRepasado, volverTexto, onVolver }: { p: ProductoAprender; repasado: boolean; onRepasado: () => void; volverTexto: string; onVolver: () => void }) {
  const datos = [
    p.porcion ? { v: p.porcion.split(" (")[0], l: "porción" } : null,
    p.kcal != null ? { v: String(p.kcal), l: "kcal" } : null,
    p.proteina != null ? { v: `${p.proteina} g`, l: "proteína" } : null,
  ].filter(Boolean) as { v: string; l: string }[];
  const todo = [p.ficha.paraQueSirve, p.ficha.loDistinto, p.ficha.consejo ? `💡 ${p.ficha.consejo}` : "", p.descripcion ?? "", p.ingredientes ? `Ingredientes: ${p.ingredientes}` : ""].filter(Boolean);
  return (
    <div className="mx-auto grid max-w-md gap-3 pb-8">
      <button type="button" onClick={onVolver} className="justify-self-start py-1 text-[15px] font-extrabold text-accent-dark">
        ← {volverTexto}
      </button>
      {p.imagen && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imagen} alt="" className="h-56 w-full rounded-[20px] border border-neutral-200 bg-white object-contain p-3.5" />
      )}
      <div>
        <h2 className="text-[21px] font-black leading-tight text-neutral-900">{p.nombre}</h2>
        <span className="text-sm font-semibold text-neutral-500">{p.marca}</span>
      </div>
      {datos.length > 0 && (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${datos.length}, minmax(0, 1fr))` }}>
          {datos.map((d) => (
            <div key={d.l} className="rounded-[14px] border border-neutral-200 bg-white p-2.5 text-center">
              <b className="block text-lg font-black tabular-nums text-neutral-900">{d.v}</b>
              <small className="text-[11.5px] font-bold uppercase tracking-wide text-neutral-500">{d.l}</small>
            </div>
          ))}
        </div>
      )}
      {p.ficha.comoSeUsa && <Linea icono="🕒" titulo="Cómo se toma" texto={p.ficha.comoSeUsa} />}
      {p.sabores.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-[14px] border border-neutral-200 bg-white p-3">
          <span className="text-xl leading-none" aria-hidden="true">
            🍫
          </span>
          <span>
            <small className="block text-xs font-extrabold uppercase tracking-wide text-neutral-500">Sabores</small>
            <span className="mt-1 flex flex-wrap gap-1.5">
              {p.sabores.map((s) => (
                <span key={s} className="rounded-full bg-orange-50 px-2.5 py-0.5 text-[13px] font-bold text-orange-800">
                  {s}
                </span>
              ))}
            </span>
          </span>
        </div>
      )}
      {p.ficha.paraQuien && <Linea icono="🎯" titulo="Para quién" texto={p.ficha.paraQuien} />}
      {todo.length > 0 && (
        <details className="rounded-[14px] border border-neutral-200 bg-white">
          <summary className="cursor-pointer px-3.5 py-3 font-extrabold text-accent-dark">Leer todo el texto</summary>
          <div className="grid gap-2 px-3.5 pb-3.5 text-[14.5px] text-neutral-700">
            {todo.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
          </div>
        </details>
      )}
      <button
        type="button"
        onClick={onRepasado}
        className={`w-full rounded-[14px] py-3.5 text-base font-extrabold ${repasado ? "border-[1.5px] border-neutral-200 bg-white text-neutral-500" : "bg-accent text-white"}`}
      >
        {repasado ? "✓ Ya lo sé (tocá para desmarcar)" : "Ya lo sé ✓"}
      </button>
    </div>
  );
}

function Linea({ icono, titulo, texto }: { icono: string; titulo: string; texto: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[14px] border border-neutral-200 bg-white p-3">
      <span className="text-xl leading-none" aria-hidden="true">
        {icono}
      </span>
      <span>
        <small className="block text-xs font-extrabold uppercase tracking-wide text-neutral-500">{titulo}</small>
        <span className="text-[15px] font-semibold text-neutral-800">{texto}</span>
      </span>
    </div>
  );
}
