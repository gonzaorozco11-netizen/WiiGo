"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { GranelVista, FraccionadoVista, ResumenGranel, BolsitaDeGranel } from "@/lib/fraccionado";
import { registrarFraccionado, cerrarGranel } from "@/app/(app)/fraccionar/actions";
import { textoGramos } from "@/lib/gramos";

// Fraccionar: el granel del depósito (en gramos) pasa a bolsitas. Las bolsitas
// se suman a la góndola y quedan listas para imprimirles el sticker.

const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

export default function FraccionarApp({
  graneles,
  recientes,
  resumen,
  esAdmin,
}: {
  graneles: GranelVista[];
  recientes: FraccionadoVista[];
  resumen: ResumenGranel[];
  esAdmin: boolean;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [listo, setListo] = useState<{ nombre: string; n: number } | null>(null);

  const visibles = useMemo(() => {
    const q = busqueda.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    if (!q) return graneles;
    return graneles.filter((g) =>
      [g.nombre, ...g.bolsitas.map((b) => b.nombre)].some((t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q))
    );
  }, [graneles, busqueda]);

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">Fraccionar</h1>
      <p className="text-sm text-neutral-500 mt-0.5 mb-4">
        Elegí el granel, poné cuántas bolsitas armaste y se suman a la góndola. Los kilos entran acá cuando se recibe el pedido de Alifrut.
      </p>

      {listo && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-emerald-900 mr-auto">
            ✓ <b>{listo.n} bolsitas</b> de {listo.nombre} sumadas a la góndola. Pegales el sticker antes de ponerlas.
          </p>
          <Link href="/codigos" className="rounded-lg bg-emerald-700 text-white px-3 py-2 text-sm font-semibold hover:bg-emerald-800">
            🏷️ Imprimir los stickers
          </Link>
          <button type="button" onClick={() => setListo(null)} className="text-sm text-emerald-900">
            Cerrar
          </button>
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
          {visibles.map((g) => (
            <FilaGranel
              key={g.idVariante}
              g={g}
              abierto={abierto === g.idVariante}
              onAbrir={() => setAbierto(abierto === g.idVariante ? null : g.idVariante)}
              onListo={(nombre, n) => {
                setAbierto(null);
                setListo({ nombre, n });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
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

function FilaGranel({
  g,
  abierto,
  onAbrir,
  onListo,
}: {
  g: GranelVista;
  abierto: boolean;
  onAbrir: () => void;
  onListo: (nombre: string, n: number) => void;
}) {
  const conPoco = g.bolsitas.find((b) => b.minimo > 0 && b.enGondola < b.minimo);
  const sinGranel = g.gramos <= 0;
  return (
    <li className={`rounded-2xl border bg-white ${abierto ? "border-accent" : "border-neutral-200"}`}>
      <button type="button" onClick={onAbrir} className="w-full text-left p-3.5 flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-neutral-900">{g.nombre}</span>
          <span className="block text-xs text-neutral-500 mt-0.5">
            {g.bolsitas.map((b) => `${b.nombre.replace(/^.*?(\d+\s*g)$/i, "$1")}: ${b.enGondola} en góndola`).join(" · ")}
          </span>
          {sinGranel ? (
            <span className="inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-red-50 text-red-700">Sin granel · pedile a Alifrut</span>
          ) : conPoco ? (
            <span className="inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-amber-50 text-amber-800">
              Quedan {conPoco.enGondola} en góndola · conviene embolsar
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-lg font-semibold tabular-nums text-neutral-900">{textoGramos(g.gramos)}</span>
          <span className="block text-[11px] text-neutral-500">en depósito</span>
        </span>
      </button>
      {abierto && <Panel g={g} onListo={onListo} />}
    </li>
  );
}

function Panel({ g, onListo }: { g: GranelVista; onListo: (nombre: string, n: number) => void }) {
  const router = useRouter();
  const [bolsa, setBolsa] = useState<BolsitaDeGranel>(g.bolsitas[0]);
  const alcanza = Math.floor(g.gramos / bolsa.peso);
  const [n, setN] = useState(Math.min(alcanza, Math.max(1, alcanza)));
  const [cerrando, setCerrando] = useState(false);
  const [quedan, setQuedan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();

  const usa = n * bolsa.peso;
  const queda = g.gramos - usa;

  function listo() {
    setError(null);
    startTransition(async () => {
      const r = await registrarFraccionado(g.idVariante, bolsa.idVariante, n);
      if (r.error) setError(r.error);
      else {
        onListo(bolsa.nombre, n);
        router.refresh();
      }
    });
  }

  function terminar() {
    setError(null);
    const g2 = Math.round(Number(quedan.replace(",", ".")) || 0);
    startTransition(async () => {
      const r = await cerrarGranel(g.idVariante, g2);
      if (r.error) setError(r.error);
      else {
        setCerrando(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="border-t border-neutral-100 p-3.5 space-y-3">
      {g.bolsitas.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {g.bolsitas.map((b) => (
            <button
              key={b.idVariante}
              type="button"
              onClick={() => setBolsa(b)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${bolsa.idVariante === b.idVariante ? "border-accent bg-accent text-white" : "border-neutral-300 bg-white"}`}
            >
              {b.nombre}
            </button>
          ))}
        </div>
      )}

      {!cerrando ? (
        <>
          <p className="text-sm font-semibold text-neutral-900 text-center">¿Cuántas bolsitas de {textoGramos(bolsa.peso)} armaste?</p>
          <div className="flex items-center justify-center gap-3">
            <button type="button" onClick={() => setN(Math.max(0, n - 1))} className="w-12 h-12 rounded-xl border border-neutral-300 bg-white text-2xl" aria-label="Una menos">
              −
            </button>
            <input
              inputMode="numeric"
              value={n}
              onChange={(e) => setN(Math.max(0, Math.min(999, Number(e.target.value.replace(/\D/g, "")) || 0)))}
              aria-label="Cuántas bolsitas"
              className="w-20 h-12 rounded-xl border border-neutral-300 text-center text-2xl font-semibold tabular-nums"
            />
            <button type="button" onClick={() => setN(n + 1)} className="w-12 h-12 rounded-xl border border-neutral-300 bg-white text-2xl" aria-label="Una más">
              +
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-neutral-50 py-2">
              <span className="block text-neutral-500">Usás</span>
              <b className="text-sm tabular-nums">{textoGramos(usa)}</b>
            </div>
            <div className={`rounded-lg py-2 ${queda < 0 ? "bg-red-50" : "bg-neutral-50"}`}>
              <span className={`block ${queda < 0 ? "text-red-700" : "text-neutral-500"}`}>Queda en el depósito</span>
              <b className={`text-sm tabular-nums ${queda < 0 ? "text-red-700" : ""}`}>{queda < 0 ? "no alcanza" : textoGramos(queda)}</b>
            </div>
            <div className="rounded-lg bg-neutral-50 py-2">
              <span className="block text-neutral-500">En góndola</span>
              <b className="text-sm tabular-nums">
                {bolsa.enGondola} → {bolsa.enGondola + n}
              </b>
            </div>
          </div>
          {queda >= 0 && queda > 0 && queda < bolsa.peso && (
            <p className="text-xs text-neutral-600 bg-neutral-50 rounded-lg px-3 py-2">
              Quedan {textoGramos(queda)}, menos que una bolsita. Si ya se terminó la bolsa grande, tocá «Se terminó el granel» después.
            </p>
          )}
          <button
            type="button"
            onClick={listo}
            disabled={guardando || n <= 0 || queda < 0}
            className="w-full rounded-xl bg-accent text-white px-4 py-3 font-semibold hover:bg-accent-dark disabled:opacity-40"
          >
            {guardando ? "Guardando…" : `Listo: sumar ${n} y preparar los stickers`}
          </button>
          <button type="button" onClick={() => setCerrando(true)} className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm">
            Se terminó el granel
          </button>
        </>
      ) : (
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
            <button type="button" onClick={() => setCerrando(false)} className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm">
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
