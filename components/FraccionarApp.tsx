"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GranelVista, FraccionadoVista, ResumenGranel, EnCursoVista } from "@/lib/fraccionado";
import { cerrarGranel, descartarEnCurso } from "@/app/(app)/fraccionar/actions";
import { textoGramos } from "@/lib/gramos";
import FraccionarGuiado from "@/components/FraccionarGuiado";
import PestanasStock from "@/components/PestanasStock";
import { PASO_PARA_ETIQUETAR, conLoYaFraccionado, paraEtiquetar, paraFraccionar } from "@/lib/fraccionarSugerido";
import FraccionarTanda from "@/components/FraccionarTanda";
import type { RecibidoSinCodigo } from "@/lib/entradas";

// Fraccionar: el granel del depósito (en gramos) pasa a bolsitas. Desde el
// 2026-11-16 se hace con el paso a paso (FraccionarGuiado): se toca un granel y
// arranca. Lo que quedó por la mitad aparece arriba para seguirlo.

const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

export default function FraccionarApp({
  graneles: granelesDelStock,
  recientes,
  resumen,
  esAdmin,
  enCurso = [],
  seguir = null,
  tanda: tandaInicial = null,
  idUsuario = null,
  recibidos = [],
}: {
  graneles: GranelVista[];
  recientes: FraccionadoVista[];
  resumen: ResumenGranel[];
  esAdmin: boolean;
  /** Los paso a paso que quedaron por la mitad en este local. */
  enCurso?: EnCursoVista[];
  /** ?seguir=<id>: se abre ese directamente (desde el Inicio). */
  seguir?: string | null;
  /** ?tanda=<paso>: las etiquetas de la tanda (al volver de imprimir, paso 2). */
  tanda?: number | null;
  idUsuario?: string | null;
  /** Lo recibido sin código de fábrica (granolas…): se suma a la hoja de la tanda. */
  recibidos?: RecibidoSinCodigo[];
}) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  // Lo ya fraccionado que espera la etiqueta (de todo el local): no vuelve a pedirse y su granel ya se usó.
  const paraEtiq = useMemo(() => paraEtiquetar(enCurso), [enCurso]);
  const graneles = useMemo(() => conLoYaFraccionado(granelesDelStock, paraEtiq), [granelesDelStock, paraEtiq]);
  const bolsitasParaEtiquetar = paraEtiq.reduce((a, e) => a + (e.bolsitas ?? 0), 0);
  const porId = useMemo(() => new Map(graneles.map((g) => [g.idVariante, g])), [graneles]);
  const aSeguir = seguir ? enCurso.find((e) => e.id === seguir) : null;
  const [tanda, setTanda] = useState<number | null>(() =>
    tandaInicial ? tandaInicial : aSeguir && aSeguir.paso >= PASO_PARA_ETIQUETAR ? 1 : null
  );
  const [guiado, setGuiado] = useState<{ granel: GranelVista; inicial: EnCursoVista | null; idBolsa?: string } | null>(() =>
    aSeguir && aSeguir.paso < PASO_PARA_ETIQUETAR && porId.get(aSeguir.idVarianteGranel) ? { granel: porId.get(aSeguir.idVarianteGranel)!, inicial: aSeguir } : null
  );
  // «Para fraccionar antes de cerrar el turno»: lo que falta para llegar a 5 + 3 (17/11).
  const sugeridos = useMemo(() => paraFraccionar(graneles), [graneles]);
  const conGranel = sugeridos.filter((s) => !s.sinGranel);
  const totalBolsitas = conGranel.reduce((a, s) => a + s.hacer, 0);
  const [descartando, startDescartar] = useTransition();
  // Los míos primero; el Dueño ve los de todos. Lo que espera la etiqueta va aparte.
  const pendientes = enCurso.filter((e) => e.paso < PASO_PARA_ETIQUETAR && (esAdmin || e.idUsuario === idUsuario));

  const visibles = useMemo(() => {
    const q = busqueda.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    if (!q) return graneles;
    return graneles.filter((g) =>
      [g.nombre, ...g.bolsitas.map((b) => b.nombre)].some((t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q))
    );
  }, [graneles, busqueda]);

  const limpiarUrl = () => {
    if (seguir || tandaInicial) router.replace("/fraccionar");
  };

  if (tanda) {
    return (
      <FraccionarTanda
        pendientes={paraEtiq}
        graneles={granelesDelStock}
        recibidos={recibidos}
        pasoInicial={tanda}
        onSalir={() => {
          setTanda(null);
          limpiarUrl();
          router.refresh();
        }}
      />
    );
  }

  if (guiado) {
    return (
      <FraccionarGuiado
        key={guiado.inicial?.id ?? guiado.granel.idVariante}
        granel={guiado.granel}
        inicial={guiado.inicial}
        idBolsa={guiado.idBolsa}
        onSalir={() => {
          setGuiado(null);
          limpiarUrl();
          router.refresh();
        }}
        onEtiquetar={() => {
          setGuiado(null);
          setTanda(1);
          limpiarUrl();
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PestanasStock actual="granel" gondola={esAdmin ? "/stock" : undefined} />
      <h1 className="text-xl font-semibold text-neutral-900">Depósito · Fraccionar</h1>
      <p className="text-sm text-neutral-500 mt-0.5 mb-4">
        Cada bolsita tiene que quedar con 5 en el blistero y 3 abajo, en el cajón. Lo que se vendió, se fracciona al final del turno.
      </p>

      {/* Lo ya fraccionado que espera la etiqueta: se imprime todo junto, al final (17/11). */}
      {paraEtiq.length > 0 && (
        <section aria-label="Fraccionado, falta la etiqueta" className="mb-5 rounded-2xl border-2 border-emerald-600 bg-white p-4">
          <h2 className="mb-2 text-lg font-extrabold text-neutral-900">Fraccionado · falta la etiqueta</h2>
          <ul className="mb-3 grid gap-1.5">
            {paraEtiq.map((e) => {
              const b = graneles.flatMap((g) => g.bolsitas).find((x) => x.idVariante === e.idVarianteBolsa);
              return (
                <li key={e.id} className="flex flex-wrap justify-between gap-x-3 text-sm">
                  <span>
                    <span className="text-emerald-700">✓</span> {b?.nombre ?? "Bolsita"}
                    {e.vencimiento && <span className="text-neutral-500"> · vence {e.vencimiento.split("-").reverse().join("/")}</span>}
                    {esAdmin && <span className="text-neutral-400"> · {e.quien}</span>}
                  </span>
                  <b className="tabular-nums">{e.bolsitas}</b>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              setTanda(1);
              window.scrollTo({ top: 0 });
            }}
            className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-left text-white"
          >
            <b>
              {bolsitasParaEtiquetar} {bolsitasParaEtiquetar === 1 ? "bolsita lista" : "bolsitas listas"} para etiquetar
            </b>
            <span className="rounded-lg bg-white px-3 py-1.5 text-sm font-extrabold text-emerald-700">Imprimir las etiquetas →</span>
          </button>
        </section>
      )}

      {sugeridos.length > 0 && (
        <section aria-label="Para fraccionar antes de cerrar el turno" className="mb-5 rounded-2xl border-2 border-accent bg-white p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-lg font-extrabold text-neutral-900">Para fraccionar antes de cerrar el turno</h2>
            {totalBolsitas > 0 && (
              <span className="text-sm text-neutral-500">
                {conGranel.length} {conGranel.length === 1 ? "producto" : "productos"} · <b className="tabular-nums text-neutral-900">{totalBolsitas} bolsitas</b>
              </span>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {sugeridos.map((s) => (
              <li
                key={s.bolsita.idVariante}
                className={`grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border p-3 ${s.urgente && !s.sinGranel ? "border-red-300 bg-red-50" : "border-neutral-200"}`}
              >
                <span className="min-w-0">
                  <b className="block text-[15px] text-neutral-900">{s.bolsita.nombre}</b>
                  <span className="block text-xs text-neutral-600 mt-0.5">
                    Hay <b className="text-neutral-900">{s.bolsita.enGondola}</b> de <b className="text-neutral-900">{s.bolsita.objetivo}</b>
                    {s.bolsita.vendidasSemana > 0 && ` · ${s.bolsita.vendidasSemana === 1 ? "se vendió 1" : `se vendieron ${s.bolsita.vendidasSemana}`} esta semana`}
                    {!s.sinGranel && ` · granel ${textoGramos(s.granel.gramos)}`}
                  </span>
                  {s.sinGranel ? (
                    <span className="inline-block mt-1.5 text-[11px] font-bold rounded-full px-2 py-0.5 bg-amber-50 text-amber-800">No hay granel en el depósito · Gonzalo ya está avisado</span>
                  ) : s.urgente ? (
                    <span className="inline-block mt-1.5 text-[11px] font-bold rounded-full px-2 py-0.5 bg-red-600 text-white">El blistero no llega a {s.bolsita.minimo || 3}</span>
                  ) : null}
                </span>
                {s.sinGranel ? (
                  <span className="text-sm font-bold text-neutral-400">—</span>
                ) : (
                  <span className="text-right">
                    <span className="block text-2xl font-black tabular-nums leading-none text-neutral-900">
                      {s.hacer} <small className="text-xs font-bold text-neutral-500">{s.hacer === 1 ? "bolsita" : "bolsitas"}</small>
                    </span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5 mb-1.5">{textoGramos(s.hacer * s.bolsita.peso)} de granel</span>
                    <button
                      type="button"
                      onClick={() => {
                        setGuiado({ granel: s.granel, inicial: null, idBolsa: s.bolsita.idVariante });
                        window.scrollTo({ top: 0 });
                      }}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-extrabold text-white"
                    >
                      Fraccionar →
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-neutral-500">Los que tienen sus {sugeridos[0]?.bolsita.objetivo ?? 8} completos no aparecen: no hace falta fraccionarlos.</p>
        </section>
      )}

      {pendientes.length > 0 && (
        <div className="mb-4 grid gap-2">
          {pendientes.map((e) => {
            const g = porId.get(e.idVarianteGranel);
            return (
              <div key={e.id} role="alert" className="rounded-2xl border-2 border-red-300 bg-red-50 p-3.5 flex flex-wrap items-center gap-3">
                <p className="mr-auto text-sm text-red-900">
                  <b>Fraccionado sin terminar:</b> {g?.nombre ?? "producto"}
                  {e.bolsitas ? `, ${e.bolsitas} bolsitas` : ""} · paso {Math.min(e.paso, 4)} de 4
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
          {graneles.length === 0 ? "Todavía no hay graneles: aparecen cuando un producto a granel tiene una bolsita WiiGo." : "Ningún producto coincide."}
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
            <span className="inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-neutral-100 text-neutral-600">No hay granel en el depósito</span>
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
