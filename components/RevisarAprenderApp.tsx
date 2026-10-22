"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  escribirExplicacion,
  aprobarExplicacion,
  descartarBorrador,
  type EstadoRevision,
  type FichaParaRevisar,
} from "@/app/(app)/aprender/actions";
import type { FichaProducto, FichaTema } from "@/lib/aprender";

// Aprender → Revisar: lo que escribió la IA espera acá hasta que lo aprobás.
// Podés corregir cualquier texto antes de aprobar. Lo aprobado lo ve el equipo.

export default function RevisarAprenderApp({ estado }: { estado: EstadoRevision }) {
  const router = useRouter();
  const [progreso, setProgreso] = useState<{ hecho: number; total: number; errores: number; ultimoError: string | null } | null>(null);
  const cortar = useRef(false);

  async function escribirFaltantes() {
    cortar.current = false;
    const lista = estado.sinEscribir;
    let errores = 0;
    let ultimoError: string | null = null;
    setProgreso({ hecho: 0, total: lista.length, errores: 0, ultimoError: null });
    for (let i = 0; i < lista.length; i++) {
      if (cortar.current) break;
      const res = await escribirExplicacion(lista[i].tipo, lista[i].id);
      if (res.error) {
        errores += 1;
        ultimoError = res.error;
        // Sin clave o sin SQL no tiene sentido seguir.
        if (/ANTHROPIC_API_KEY|clave|sql\//i.test(res.error)) {
          setProgreso({ hecho: i + 1, total: lista.length, errores, ultimoError });
          break;
        }
      }
      setProgreso({ hecho: i + 1, total: lista.length, errores, ultimoError });
    }
    router.refresh();
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Aprender: revisar explicaciones</h1>
        <p className="text-sm text-neutral-500 max-w-2xl">
          Cuando se carga o se modifica un producto, la inteligencia artificial escribe su explicación. Queda acá como borrador: la leés, corregís lo que
          haga falta y la aprobás. Recién ahí la ve el equipo en Aprender.
        </p>
      </div>

      {estado.faltaSql && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">Falta correr sql/aprender.sql en Supabase.</p>
      )}

      {!estado.hayClave && (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1.5">
          <p className="font-semibold">Falta conectar la inteligencia artificial.</p>
          <ol className="list-decimal pl-5 space-y-0.5">
            <li>Entrá a console.anthropic.com, creá la cuenta y cargá crédito (con 5 dólares alcanza para cientos de productos).</li>
            <li>En "API Keys" tocá "Create Key" y copiá la clave.</li>
            <li>En Vercel, en el proyecto, Settings → Environment Variables: nombre ANTHROPIC_API_KEY y pegá la clave.</li>
            <li>Volvé a publicar (Redeploy) y entrá de nuevo acá.</li>
          </ol>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        {[
          ["Para revisar", estado.pendientes.length],
          ["Aprobadas", estado.aprobadas],
          ["Sin escribir", estado.sinEscribir.length],
        ].map(([t, n]) => (
          <div key={t as string} className="bg-white border border-neutral-200 rounded-xl px-4 py-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">{t}</p>
            <p className="text-xl font-bold tabular-nums">{n}</p>
          </div>
        ))}
      </div>

      {estado.sinEscribir.length > 0 && estado.hayClave && !estado.faltaSql && (
        <div className="bg-white border border-neutral-200 rounded-xl p-4 space-y-2">
          <p className="text-sm text-neutral-700">
            Hay <b>{estado.sinEscribir.length}</b> {estado.sinEscribir.length === 1 ? "producto o tema" : "productos y temas"} sin explicación todavía (los que ya estaban cargados).
          </p>
          {progreso ? (
            <div className="space-y-1.5">
              <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${(progreso.hecho / Math.max(progreso.total, 1)) * 100}%` }} />
              </div>
              <p className="text-xs text-neutral-500">
                {progreso.hecho < progreso.total ? `Escribiendo ${progreso.hecho + 1} de ${progreso.total}… (unos segundos cada una)` : "Listo."}
                {progreso.errores > 0 && ` · ${progreso.errores} con error: ${progreso.ultimoError}`}
              </p>
              {progreso.hecho < progreso.total && (
                <button type="button" onClick={() => (cortar.current = true)} className="text-xs font-semibold text-neutral-500">
                  Frenar
                </button>
              )}
            </div>
          ) : (
            <button type="button" onClick={escribirFaltantes} className="text-sm font-bold text-white bg-accent hover:bg-accent-dark rounded-lg px-4 py-2">
              Escribir las que faltan
            </button>
          )}
        </div>
      )}

      {estado.conError.length > 0 && (
        <div className="bg-white border border-red-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-red-700">No se pudieron escribir</p>
          {estado.conError.map((f) => (
            <ReintentarFila key={f.idFicha} f={f} onListo={() => router.refresh()} />
          ))}
        </div>
      )}

      {estado.pendientes.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-10 bg-white border border-neutral-200 rounded-xl">No hay nada para revisar.</p>
      ) : (
        <div className="space-y-3">
          {estado.pendientes.map((f) => (
            <TarjetaRevision key={f.idFicha} f={f} onListo={() => router.refresh()} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReintentarFila({ f, onListo }: { f: FichaParaRevisar; onListo: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-neutral-800">{f.titulo}</span>
      <span className="text-xs text-red-600">{f.error}</span>
      <button
        type="button"
        disabled={ocupado}
        onClick={() => {
          setOcupado(true);
          escribirExplicacion(f.tipo, f.id, true).finally(() => {
            setOcupado(false);
            onListo();
          });
        }}
        className="ml-auto text-xs font-semibold text-accent"
      >
        {ocupado ? "Escribiendo…" : "Probar de nuevo"}
      </button>
    </div>
  );
}

const CAMPOS_PRODUCTO: [keyof FichaProducto, string][] = [
  ["paraQueSirve", "Para qué sirve"],
  ["paraQuien", "Para quién"],
  ["comoSeUsa", "Cómo se usa"],
  ["loDistinto", "Lo distinto"],
  ["consejo", "Consejo para asesorar"],
];
const CAMPOS_TEMA: [keyof FichaTema, string][] = [
  ["queEs", "Qué es"],
  ["paraQuien", "Para quién"],
  ["comoSeUsa", "Cómo se usa"],
  ["consejo", "Consejo para asesorar"],
];

function TarjetaRevision({ f, onListo }: { f: FichaParaRevisar; onListo: () => void }) {
  const [contenido, setContenido] = useState<Record<string, unknown>>({ ...(f.borrador as Record<string, unknown>) });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const campos = (f.tipo === "PRODUCTO" ? CAMPOS_PRODUCTO : CAMPOS_TEMA) as [string, string][];
  const preguntas = (contenido.preguntas as FichaProducto["preguntas"] | undefined) ?? [];

  async function hacer(cual: string, accion: () => Promise<{ error: string | null }>) {
    setOcupado(cual);
    setError(null);
    const res = await accion();
    setOcupado(null);
    if (res.error) setError(res.error);
    else onListo();
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[15px] font-semibold text-neutral-900">
          {f.tipo === "TEMA" && typeof contenido.icono === "string" ? `${contenido.icono} ` : ""}
          {f.titulo}
        </h2>
        <span className="text-xs text-neutral-400">{f.subtitulo}</span>
        {f.aprobado && <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-amber-50 text-amber-700">Reemplaza a una ya aprobada</span>}
      </div>
      <div className="grid sm:grid-cols-2 gap-2.5">
        {campos.map(([clave, etiqueta]) => (
          <label key={clave} className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">{etiqueta}</span>
            <textarea
              value={(contenido[clave] as string) ?? ""}
              onChange={(e) => setContenido((c) => ({ ...c, [clave]: e.target.value }))}
              rows={2}
              className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm"
            />
          </label>
        ))}
      </div>
      {preguntas.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Preguntas de repaso</p>
          {preguntas.map((q, i) => (
            <div key={i} className="text-sm bg-neutral-50 rounded-lg px-3 py-2">
              <p className="font-semibold text-neutral-800">{q.pregunta}</p>
              <ul className="mt-1 space-y-0.5">
                {q.opciones.map((op, n) => (
                  <li key={n} className={n === q.correcta ? "text-emerald-700 font-semibold" : "text-neutral-500"}>
                    {n === q.correcta ? "✓ " : "· "}
                    {op}
                  </li>
                ))}
              </ul>
              <div className="flex justify-between gap-2 mt-1">
                <p className="text-xs text-neutral-500">{q.explicacion}</p>
                <button
                  type="button"
                  onClick={() => setContenido((c) => ({ ...c, preguntas: preguntas.filter((_, j) => j !== i) }))}
                  className="text-xs text-neutral-400 hover:text-red-600 shrink-0"
                >
                  Sacar pregunta
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 justify-end">
        <button type="button" disabled={Boolean(ocupado)} onClick={() => hacer("descartar", () => descartarBorrador(f.idFicha))} className="text-xs font-semibold text-neutral-400 hover:text-red-600 px-2">
          Descartar
        </button>
        <button
          type="button"
          disabled={Boolean(ocupado)}
          onClick={() => hacer("rehacer", () => escribirExplicacion(f.tipo, f.id, true))}
          className="text-xs font-semibold text-neutral-600 border border-neutral-200 rounded-lg px-3 py-1.5"
        >
          {ocupado === "rehacer" ? "Escribiendo…" : "Escribir de nuevo"}
        </button>
        <button
          type="button"
          disabled={Boolean(ocupado)}
          onClick={() => hacer("aprobar", () => aprobarExplicacion(f.idFicha, contenido as FichaProducto | FichaTema))}
          className="text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-4 py-1.5"
        >
          {ocupado === "aprobar" ? "Aprobando…" : "✓ Aprobar"}
        </button>
      </div>
    </div>
  );
}
