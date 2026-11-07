"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConteoVista, ItemConteo, MotivoConteo } from "@/lib/conteoStock";
import { registrarConteo, firmarConteo } from "@/app/(app)/conteo/actions";
import EscanerCodigo from "@/components/EscanerCodigo";
import PadFirma from "@/components/PadFirma";
import { limpiarCodigoBarras } from "@/lib/codigos";

// Contar stock en el turno, del lado del equipo (tablet o celu).
//
// No se muestra nunca lo que dice el sistema: si lo ven, lo copian. Cada
// producto se guarda apenas lo cuentan, así pueden atender a un cliente en el
// medio y seguir. Al final firman.

const CHIP: Record<MotivoConteo, string> = {
  SEGUIMIENTO: "bg-red-50 text-red-700",
  ROTA: "bg-amber-50 text-amber-800",
  QUIETO: "bg-sky-50 text-sky-800",
  NUNCA: "bg-neutral-100 text-neutral-600",
};

export default function ConteoStockApp({ conteo }: { conteo: ConteoVista | null }) {
  const router = useRouter();
  const [escaneando, setEscaneando] = useState(false);
  const [resaltado, setResaltado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [firma, setFirma] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firmando, startFirma] = useTransition();

  if (!conteo) {
    return (
      <div className="max-w-md mx-auto text-center py-14">
        <p className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-700 grid place-items-center text-2xl font-bold mx-auto mb-3">✓</p>
        <h1 className="text-lg font-semibold text-neutral-900">No tenés productos para contar</h1>
        <p className="text-sm text-neutral-500 mt-1">El conteo de hoy ya está hecho. Mañana te tocan otros.</p>
      </div>
    );
  }

  if (conteo.estado === "FIRMADO") {
    return (
      <div className="max-w-md mx-auto text-center py-14">
        <p className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-700 grid place-items-center text-2xl font-bold mx-auto mb-3">✓</p>
        <h1 className="text-lg font-semibold text-neutral-900">Conteo firmado</h1>
        <p className="text-sm text-neutral-500 mt-1">¡Gracias! Mañana te tocan otros productos.</p>
      </div>
    );
  }

  const listos = conteo.items.filter((i) => i.contadoEn).length;
  const total = conteo.items.length;
  const todo = listos === total;
  const diferencias = conteo.items.filter((i) => i.resultado === "DIFERENCIA").length;

  function leido(valor: string) {
    setEscaneando(false);
    const codigo = limpiarCodigoBarras(valor);
    const it = conteo!.items.find((i) => i.codigo && limpiarCodigoBarras(i.codigo) === codigo);
    if (!it) {
      setAviso("Ese producto no está en tu conteo de hoy.");
      return;
    }
    setAviso(null);
    setResaltado(it.idItem);
    document.getElementById(`item-${it.idItem}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function firmar() {
    setError(null);
    startFirma(async () => {
      const r = await firmarConteo(conteo!.idConteo, firma);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-neutral-900">Contar stock</h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          {listos} de {total} contados
          {conteo.companeros.length > 0 && (
            <> · {conteo.companeros.map((c) => `${c.nombre.split(" ")[0]} cuenta ${c.cuantos}`).join(" · ")}</>
          )}
        </p>
        <div className="h-1.5 rounded-full bg-neutral-200 mt-2 overflow-hidden">
          <div className="h-full bg-accent transition-all" style={{ width: `${total ? (listos / total) * 100 : 0}%` }} />
        </div>
        {conteo.deAntes && (
          <p className="mt-3 text-sm rounded-lg bg-amber-50 text-amber-800 px-3 py-2">
            Te quedaron productos del turno anterior. Terminalos y firmá.
          </p>
        )}
      </div>

      {!todo && (
        <>
          <p className="text-sm text-neutral-600 mb-3 leading-relaxed">
            Contá lo que hay en la góndola <b>y en el depósito</b>. Podés hacerlos de a uno: si entra un cliente, atendelo y
            después seguís, lo que contaste queda guardado.
          </p>
          <button
            type="button"
            onClick={() => setEscaneando(true)}
            className="w-full mb-3 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-semibold hover:bg-neutral-50"
          >
            📷 Escanear un producto para encontrarlo
          </button>
          {aviso && <p className="mb-3 text-sm rounded-lg bg-neutral-100 text-neutral-700 px-3 py-2">{aviso}</p>}
        </>
      )}

      <ul className="flex flex-col gap-2.5 mb-5">
        {conteo.items.map((i) => (
          <FilaConteo key={i.idItem} item={i} resaltado={resaltado === i.idItem} />
        ))}
      </ul>

      {todo && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
          <h2 className="font-semibold text-neutral-900">Firmá el conteo</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-emerald-50 px-3 py-2">
              <span className="block text-xs text-emerald-700">Coinciden</span>
              <b className="text-lg text-emerald-800 tabular-nums">{total - diferencias}</b>
            </div>
            <div className={`rounded-lg px-3 py-2 ${diferencias ? "bg-red-50" : "bg-neutral-50"}`}>
              <span className={`block text-xs ${diferencias ? "text-red-700" : "text-neutral-500"}`}>Con diferencia</span>
              <b className={`text-lg tabular-nums ${diferencias ? "text-red-800" : "text-neutral-700"}`}>{diferencias}</b>
            </div>
          </div>
          <p className="text-sm text-neutral-600">
            Con tu firma confirmás que contaste estos {total} productos y que había lo que anotaste.
          </p>
          <PadFirma onCambio={setFirma} />
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={firmar}
            disabled={!firma || firmando}
            className="w-full rounded-xl bg-accent text-white px-4 py-3 font-semibold hover:bg-accent-dark disabled:opacity-40"
          >
            {firmando ? "Guardando…" : "Firmo el conteo"}
          </button>
        </div>
      )}

      {escaneando && <EscanerCodigo titulo="Escaneá el producto que vas a contar" onLeido={leido} onCerrar={() => setEscaneando(false)} />}
    </div>
  );
}

function FilaConteo({ item, resaltado }: { item: ItemConteo; resaltado: boolean }) {
  const router = useRouter();
  const [valor, setValor] = useState<string>("");
  const [estado, setEstado] = useState<"RECONTAR" | null>(item.primerConteo != null && !item.contadoEn ? "RECONTAR" : null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();
  const n = valor === "" ? null : Math.max(0, Math.round(Number(valor)));

  function cambiar(delta: number) {
    setValor(String(Math.max(0, (n ?? 0) + delta)));
  }

  function listo() {
    if (n == null || !Number.isFinite(n)) return;
    setError(null);
    startTransition(async () => {
      const r = await registrarConteo(item.idItem, n);
      if (r.error) setError(r.error);
      else if (r.resultado === "RECONTAR") {
        setEstado("RECONTAR");
        setValor("");
      } else router.refresh();
    });
  }

  const hecho = Boolean(item.contadoEn);
  const borde = hecho
    ? item.resultado === "OK"
      ? "border-emerald-300 bg-white"
      : "border-amber-300 bg-amber-50/50"
    : estado === "RECONTAR"
      ? "border-red-300 bg-red-50/60"
      : resaltado
        ? "border-accent ring-2 ring-accent/30 bg-white"
        : "border-neutral-200 bg-white";

  return (
    <li id={`item-${item.idItem}`} className={`rounded-2xl border p-3.5 ${borde}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-neutral-900 leading-snug">{item.producto}</p>
          {item.donde && <p className="text-xs text-neutral-500 mt-0.5">{item.donde}</p>}
          {item.detalleMotivo && (
            <span className={`inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5 ${CHIP[item.motivo]}`}>{item.detalleMotivo}</span>
          )}
        </div>
        {hecho && (
          <span className="shrink-0 text-right">
            <span className="block text-lg font-bold tabular-nums text-neutral-900">{item.contado}</span>
            <span className="block text-[11px] text-neutral-500">contaste</span>
          </span>
        )}
      </div>

      {hecho ? (
        <p className={`mt-2 text-sm font-medium ${item.resultado === "OK" ? "text-emerald-700" : "text-amber-800"}`}>
          {item.resultado === "OK" ? "✓ Coincide" : "Quedó anotado con lo que contaste. Lo revisa Gonzalo, no pasa nada."}
        </p>
      ) : (
        <>
          {estado === "RECONTAR" && (
            <p className="mt-2 text-sm font-medium text-red-700">
              No coincide. Contalo de nuevo con calma: mirá atrás, en el depósito y en otros lugares.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => cambiar(-1)}
              className="w-11 h-11 rounded-xl border border-neutral-300 bg-white text-xl text-neutral-700"
              aria-label="Uno menos"
            >
              −
            </button>
            <input
              inputMode="numeric"
              value={valor}
              onChange={(e) => setValor(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="?"
              aria-label={`Cuántos hay de ${item.producto}`}
              className="w-16 h-11 rounded-xl border border-neutral-300 bg-white text-center text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => cambiar(1)}
              className="w-11 h-11 rounded-xl border border-neutral-300 bg-white text-xl text-neutral-700"
              aria-label="Uno más"
            >
              +
            </button>
            <button
              type="button"
              onClick={listo}
              disabled={n == null || guardando}
              className="ml-auto rounded-xl bg-neutral-900 text-white px-4 h-11 text-sm font-semibold disabled:opacity-35"
            >
              {guardando ? "…" : n == null ? "Listo" : `Listo, hay ${n}`}
            </button>
          </div>
          {error && (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </li>
  );
}
