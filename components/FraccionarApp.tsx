"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GranelVista, FraccionadoVista, ResumenGranel, EnCursoVista } from "@/lib/fraccionado";
import { cerrarGranel, descartarEnCurso } from "@/app/(app)/fraccionar/actions";
import { textoGramos } from "@/lib/gramos";
import FraccionarGuiado from "@/components/FraccionarGuiado";
import PestanasStock from "@/components/PestanasStock";

// Fraccionar: el granel del depósito (en gramos) pasa a bolsitas. Desde el
// 2026-11-16 se hace con el paso a paso (FraccionarGuiado): se toca un granel y
// arranca. Lo que quedó por la mitad aparece arriba para seguirlo.

const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

export default function FraccionarApp({
  graneles,
  recientes,
  resumen,
  esAdmin,
  enCurso = [],
  seguir = null,
  idUsuario = null,
}: {
  graneles: GranelVista[];
  recientes: FraccionadoVista[];
  resumen: ResumenGranel[];
  esAdmin: boolean;
  /** Los paso a paso que quedaron por la mitad en este local. */
  enCurso?: EnCursoVista[];
  /** ?seguir=<id>: se abre ese directamente (desde el Inicio o al volver de imprimir). */
  seguir?: string | null;
  idUsuario?: string | null;
}) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const porId = useMemo(() => new Map(graneles.map((g) => [g.idVariante, g])), [graneles]);
  const aSeguir = seguir ? enCurso.find((e) => e.id === seguir) : null;
  const [guiado, setGuiado] = useState<{ granel: GranelVista; inicial: EnCursoVista | null } | null>(() =>
    aSeguir && porId.get(aSeguir.idVarianteGranel) ? { granel: porId.get(aSeguir.idVarianteGranel)!, inicial: aSeguir } : null
  );
  const [descartando, startDescartar] = useTransition();
  // Los míos primero; el Dueño ve los de todos.
  const pendientes = enCurso.filter((e) => esAdmin || e.idUsuario === idUsuario);

  const visibles = useMemo(() => {
    const q = busqueda.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    if (!q) return graneles;
    return graneles.filter((g) =>
      [g.nombre, ...g.bolsitas.map((b) => b.nombre)].some((t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q))
    );
  }, [graneles, busqueda]);

  if (guiado) {
    return (
      <FraccionarGuiado
        key={guiado.inicial?.id ?? guiado.granel.idVariante}
        granel={guiado.granel}
        inicial={guiado.inicial}
        onSalir={() => {
          setGuiado(null);
          if (seguir) router.replace("/fraccionar");
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PestanasStock actual="granel" />
      <h1 className="text-xl font-semibold text-neutral-900">A granel · Fraccionar</h1>
      <p className="text-sm text-neutral-500 mt-0.5 mb-4">
        Tocá un producto y el sistema te guía paso a paso: cuántas bolsitas salen, etiquetas, vencimiento y sumarlas al stock. Primero los que se están terminando en la góndola.
      </p>

      {pendientes.length > 0 && (
        <div className="mb-4 grid gap-2">
          {pendientes.map((e) => {
            const g = porId.get(e.idVarianteGranel);
            return (
              <div key={e.id} role="alert" className="rounded-2xl border-2 border-red-300 bg-red-50 p-3.5 flex flex-wrap items-center gap-3">
                <p className="mr-auto text-sm text-red-900">
                  <b>Fraccionado sin terminar:</b> {g?.nombre ?? "producto"}
                  {e.bolsitas ? `, ${e.bolsitas} bolsitas` : ""} · paso {Math.min(e.paso, 7)} de 7
                  {esAdmin && e.idUsuario !== idUsuario ? ` · ${e.quien}` : ""}
                </p>
                {g && (
                  <button type="button" onClick={() => setGuiado({ granel: g, inicial: e })} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-extrabold text-white">
                    Seguir
                  </button>
                )}
                <button
                  type="button"
                  disabled={descartando}
                  onClick={() =>
                    startDescartar(async () => {
                      await descartarEnCurso(e.id);
                      router.refresh();
                    })
                  }
                  className="text-sm text-red-800 underline underline-offset-4"
                >
                  Descartar
                </button>
              </div>
            );
          })}
        </div>
      )}

      <input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar un producto…"
        className="w-full mb-3 rounded-xl border border-neutral-300 px-4 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-accent"
      />

      {visibles.length === 0 ? (
        <p className="text-sm text-neutral-500 py-10 text-center">
          {graneles.length === 0 ? "Todavía no hay graneles: aparecen cuando un producto de Alifrut tiene una bolsita WiiGo." : "Ningún producto coincide."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {/* Primero lo que se está terminando en la góndola (y tiene granel para embolsar). */}
          {[...visibles]
            .sort((a, b) => Number(faltaEnGondola(b) && b.gramos > 0) - Number(faltaEnGondola(a) && a.gramos > 0))
            .map((g) => (
              <FilaGranel
                key={g.idVariante}
                g={g}
                cerrando={abierto === g.idVariante}
                onEmpezar={() => {
                  setGuiado({ granel: g, inicial: null });
                  window.scrollTo({ top: 0 });
                }}
                onCerrando={() => setAbierto(abierto === g.idVariante ? null : g.idVariante)}
              />
            ))}
        </ul>
      )}

      {esAdmin && resumen.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">Este mes</h2>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500">
                  <th className="px-4 py-2.5 font-semibold">Producto</th>
                  <th className="px-2 py-2.5 font-semibold text-right">Recibido</th>
                  <th className="px-2 py-2.5 font-semibold text-right">Embolsado</th>
                  <th className="px-2 py-2.5 font-semibold text-right">En depósito</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Se perdió</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map((r) => {
                  const pct = r.embolsado + r.merma > 0 ? (r.merma / (r.embolsado + r.merma)) * 100 : 0;
                  return (
                    <tr key={r.nombre} className="border-t border-neutral-100">
                      <td className="px-4 py-2.5">{r.nombre}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{textoGramos(r.recibido)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{textoGramos(r.embolsado)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{textoGramos(r.deposito)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${pct > 10 ? "text-red-700 font-semibold" : pct > 3 ? "text-amber-700" : ""}`}>
                        {r.merma > 0 ? `${textoGramos(r.merma)} (${pct.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %)` : "0"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-neutral-500 mt-2">La merma aparece cuando se toca «Se terminó el granel»: hasta ahí no se sabe cuánto se perdió. Se le paga a Alifrut en la liquidación.</p>
        </section>
      )}

      {recientes.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">Últimos fraccionados</h2>
          <ul className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
            {recientes.map((f) => (
              <li key={f.id} className="px-4 py-2.5 text-sm flex flex-wrap gap-x-3 gap-y-0.5 items-baseline">
                <span className="tabular-nums text-neutral-500 w-28 shrink-0">{cuando(f.cuando)}</span>
                <span className="flex-1 min-w-0">
                  {f.tipo === "CIERRE" ? (
                    <>
                      Se terminó el granel de <b>{f.granel}</b>
                      {f.merma > 0 ? <span className="text-amber-700"> · merma {textoGramos(f.merma)}</span> : " · sin merma"}
                    </>
                  ) : (
                    <>
                      <b>{f.bolsitas}</b> × {f.bolsa ?? f.granel} <span className="text-neutral-400">({textoGramos(f.gramos)})</span>
                    </>
                  )}
                </span>
                <span className="text-neutral-500">{f.quien}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Alguna de sus bolsitas está por debajo del mínimo (o casi sin nada) en la góndola. */
function faltaEnGondola(g: GranelVista) {
  return g.bolsitas.some((b) => (b.minimo > 0 ? b.enGondola < b.minimo : b.enGondola <= 2));
}

function FilaGranel({
  g,
  cerrando,
  onEmpezar,
  onCerrando,
}: {
  g: GranelVista;
  cerrando: boolean;
  onEmpezar: () => void;
  onCerrando: () => void;
}) {
  const sinGranel = g.gramos <= 0;
  const falta = faltaEnGondola(g);
  return (
    <li className={`rounded-2xl border bg-white ${sinGranel ? "opacity-60" : ""} ${cerrando ? "border-accent" : "border-neutral-200"}`}>
      <button type="button" onClick={onEmpezar} disabled={sinGranel} className="w-full text-left p-4 flex items-start gap-3 disabled:cursor-not-allowed">
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-bold text-neutral-900">{g.nombre}</span>
          <span className="block text-xs text-neutral-500 mt-0.5">
            {g.bolsitas.map((b) => `${textoGramos(b.peso)}: ${b.enGondola} en góndola`).join(" · ")}
          </span>
          {sinGranel ? (
            <span className="inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-neutral-100 text-neutral-600">Sin granel · hay que pedirle a Alifrut</span>
          ) : falta ? (
            <span className="inline-block mt-1.5 text-[11px] font-bold rounded-full px-2 py-0.5 bg-red-50 text-red-700">Faltan en góndola</span>
          ) : (
            <span className="inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700">Góndola bien</span>
          )}
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-xl font-black tabular-nums text-neutral-900">{textoGramos(g.gramos)}</span>
          <span className="block text-[11px] text-neutral-500">a granel</span>
          {!sinGranel && <span className="mt-1 inline-block rounded-lg bg-accent px-3 py-1.5 text-xs font-extrabold text-white">Fraccionar →</span>}
        </span>
      </button>
      {!sinGranel && (
        <div className="border-t border-neutral-100 px-4 py-2">
          <button type="button" onClick={onCerrando} className="text-xs font-semibold text-neutral-500 underline underline-offset-4">
            {cerrando ? "Cancelar" : "Se terminó el granel sin fraccionar"}
          </button>
        </div>
      )}
      {cerrando && <CerrarGranel g={g} onListo={onCerrando} />}
    </li>
  );
}

/** «Se terminó el granel» sin fraccionar: lo que falta contra lo que figuraba es merma. */
function CerrarGranel({ g, onListo }: { g: GranelVista; onListo: () => void }) {
  const router = useRouter();
  const [quedan, setQuedan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();

  function terminar() {
    setError(null);
    const g2 = Math.round(Number(quedan.replace(",", ".")) || 0);
    startTransition(async () => {
      const r = await cerrarGranel(g.idVariante, g2);
      if (r.error) setError(r.error);
      else {
        onListo();
        router.refresh();
      }
    });
  }

  return (
    <div className="border-t border-neutral-100 p-3.5 space-y-3">
      {(
        <>
          <p className="text-sm text-neutral-700">
            En el sistema figuran <b>{textoGramos(g.gramos)}</b>. ¿Cuánto quedó de verdad en la bolsa grande? Si no quedó nada, dejalo en 0. Lo que falte se anota como
            merma de fraccionado.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              inputMode="decimal"
              value={quedan}
              onChange={(e) => setQuedan(e.target.value.replace(/[^\d,.]/g, ""))}
              placeholder="0"
              className="w-24 h-11 rounded-xl border border-neutral-300 text-center text-lg font-semibold tabular-nums"
            />
            gramos
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={onListo} className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm">
              Volver
            </button>
            <button type="button" onClick={terminar} disabled={guardando} className="flex-1 rounded-xl bg-neutral-900 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40">
              {guardando ? "Guardando…" : "Confirmar"}
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
