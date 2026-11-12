"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { LineaParaCargar } from "@/lib/pedidoProveedor";
import { confirmarPedidoHecho } from "@/app/(app)/compras/pedir/actions";

// Cargar en la web del proveedor el pedido que armó el equipo (paso 2 de 3 de
// la vista previa aprobada el 2026-11-12). Por rubro y con los nombres del
// proveedor, para encontrar cada cosa en su página. Lo que no tienen se marca
// y vuelve solo al próximo pedido.

const WEB_ALIFRUT = "https://www.alifrut-distribuidora.com.ar";

function textoCantidad(l: LineaParaCargar, cantidad: number) {
  if (l.unidadVenta === "KG") return `${(cantidad / 1000).toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg`;
  if (l.unidadVenta === "BULTO") {
    const bolsas = cantidad / l.paso;
    return `${bolsas} ${bolsas === 1 ? "bolsa" : "bolsas"} de ${(l.paso / 1000).toLocaleString("es-AR")} kg`;
  }
  if (l.unidadVenta === "CAJA") {
    const cajas = cantidad / l.paso;
    return `${cajas} ${cajas === 1 ? "caja" : "cajas"} (${cantidad} u.)`;
  }
  return `${cantidad} u.`;
}

export default function PedidoCargarApp({
  idOrden,
  proveedor,
  quien,
  fecha,
  enviado,
  estado,
  lineas,
}: {
  idOrden: string;
  proveedor: string;
  quien: string;
  fecha: string;
  enviado: boolean;
  estado: string;
  lineas: LineaParaCargar[];
}) {
  const [noTienen, setNoTienen] = useState<Set<string>>(new Set());
  const [cant, setCant] = useState<Record<string, number>>(() => Object.fromEntries(lineas.map((l) => [l.idDetalle, l.cantidad])));
  const [copiada, setCopiada] = useState(false);
  const [guardando, startGuardar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ pedidos: number; noTenian: number } | null>(null);

  const porRubro = useMemo(() => {
    const m = new Map<string, LineaParaCargar[]>();
    for (const l of lineas) m.set(l.rubro, [...(m.get(l.rubro) ?? []), l]);
    return [...m.entries()];
  }, [lineas]);

  const pedidos = lineas.filter((l) => !noTienen.has(l.idDetalle));
  const kilos = pedidos.filter((l) => l.esGranel).reduce((a, l) => a + (cant[l.idDetalle] ?? 0), 0) / 1000;

  function marcar(id: string, falta: boolean) {
    setNoTienen((prev) => {
      const s = new Set(prev);
      if (falta) s.add(id);
      else s.delete(id);
      return s;
    });
  }

  function copiar() {
    const texto = porRubro
      .map(([rubro, ls]) => {
        const suyas = ls.filter((l) => !noTienen.has(l.idDetalle));
        return suyas.length ? `${rubro}\n${suyas.map((l) => `- ${l.nombreProveedor}: ${textoCantidad(l, cant[l.idDetalle] ?? 0)}`).join("\n")}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
    navigator.clipboard
      ?.writeText(texto)
      .then(() => {
        setCopiada(true);
        setTimeout(() => setCopiada(false), 1800);
      })
      .catch(() => setError("No se pudo copiar. Probá de nuevo."));
  }

  function terminar() {
    setError(null);
    startGuardar(async () => {
      const r = await confirmarPedidoHecho(
        idOrden,
        lineas.map((l) => ({ idDetalle: l.idDetalle, cantidad: cant[l.idDetalle] ?? 0, noTienen: noTienen.has(l.idDetalle) }))
      );
      if (r.error) setError(r.error);
      else setHecho({ pedidos: r.pedidos ?? 0, noTenian: r.noTenian ?? 0 });
    });
  }

  if (hecho || enviado || estado !== "PENDIENTE") {
    return (
      <div className="max-w-md mx-auto text-center py-14">
        <p className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-700 grid place-items-center text-2xl font-bold mx-auto mb-3">✓</p>
        <h1 className="text-lg font-semibold text-neutral-900">{hecho ? "Pedido hecho" : "Este pedido ya se cargó"}</h1>
        <p className="text-sm text-neutral-500 mt-1">
          {hecho
            ? `${hecho.pedidos} ${hecho.pedidos === 1 ? "producto queda esperando" : "productos quedan esperando"} en Recepción.${
                hecho.noTenian ? ` ${hecho.noTenian} que no tenían vuelven a la lista del próximo pedido.` : ""
              }`
            : "Lo que se pidió está esperando en Recepción."}
        </p>
        <Link href="/compras" className="inline-block mt-4 text-sm font-semibold text-accent hover:underline">
          Ir a Compras →
        </Link>
      </div>
    );
  }

  const fechaTexto = new Date(fecha).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="max-w-2xl mx-auto pb-28">
      <h1 className="text-xl font-semibold text-neutral-900">Pedido para {proveedor}</h1>
      <p className="text-sm text-neutral-500 mt-0.5 mb-3">
        Lo armó {quien} · {fechaTexto} · ordenado por rubro, como en la web de {proveedor}
      </p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <a
          href={WEB_ALIFRUT}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm font-semibold text-center hover:bg-neutral-50"
        >
          Abrir la web de {proveedor} ↗
        </a>
        <button type="button" onClick={copiar} className="rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm font-semibold hover:bg-neutral-50">
          {copiada ? "Copiada ✓" : "Copiar la lista"}
        </button>
      </div>
      <p className="mb-4 rounded-xl bg-amber-50 text-amber-900 px-4 py-3 text-sm">
        Cargalo en la web de {proveedor}. Si algo no lo tienen, tocá <b>No tienen</b>: vuelve solo al próximo pedido. Si pedís otra
        cantidad, cambiala acá.
      </p>

      {porRubro.map(([rubro, ls]) => (
        <section key={rubro} className="mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-2">{rubro}</h2>
          <ul className="flex flex-col gap-2">
            {ls.map((l) => {
              const falta = noTienen.has(l.idDetalle);
              const valor = cant[l.idDetalle] ?? 0;
              return (
                <li key={l.idDetalle} className={`rounded-xl border border-neutral-200 px-3 py-2.5 ${falta ? "bg-neutral-50" : "bg-white"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${falta ? "line-through text-neutral-400" : "text-neutral-900"}`}>{l.nombreProveedor}</span>
                      {l.nombreProveedor !== l.nombreNuestro && <span className="block text-xs text-neutral-400">En el sistema: {l.nombreNuestro}</span>}
                    </span>
                    <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden shrink-0 text-xs font-semibold">
                      <button
                        type="button"
                        aria-pressed={!falta}
                        onClick={() => marcar(l.idDetalle, false)}
                        className={`px-2.5 py-1.5 ${!falta ? "bg-emerald-50 text-emerald-800" : "bg-white text-neutral-500"}`}
                      >
                        Pedido
                      </button>
                      <button
                        type="button"
                        aria-pressed={falta}
                        onClick={() => marcar(l.idDetalle, true)}
                        className={`px-2.5 py-1.5 border-l border-neutral-300 ${falta ? "bg-red-50 text-red-700" : "bg-white text-neutral-500"}`}
                      >
                        No tienen
                      </button>
                    </div>
                  </div>
                  {!falta && (
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        aria-label="Menos"
                        onClick={() => setCant((p) => ({ ...p, [l.idDetalle]: Math.max(l.paso, valor - l.paso) }))}
                        className="w-8 h-8 rounded-lg border border-neutral-300 bg-white text-lg leading-none"
                      >
                        −
                      </button>
                      <span className="text-sm font-semibold tabular-nums min-w-[120px] text-center">{textoCantidad(l, valor)}</span>
                      <button
                        type="button"
                        aria-label="Más"
                        onClick={() => setCant((p) => ({ ...p, [l.idDetalle]: valor + l.paso }))}
                        className="w-8 h-8 rounded-lg border border-neutral-300 bg-white text-lg leading-none"
                      >
                        +
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div className="fixed bottom-0 left-0 right-0 lg:left-60 bg-white border-t border-neutral-200 px-4 py-3 print:hidden">
        <div className="max-w-2xl mx-auto">
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
          <p className="text-xs text-neutral-500 mb-2 tabular-nums">
            <b className="text-neutral-900">{pedidos.length}</b> para pedir · <b className="text-neutral-900">{kilos.toLocaleString("es-AR")} kg</b> a granel
            {noTienen.size > 0 && (
              <>
                {" "}
                · <b className="text-neutral-900">{noTienen.size}</b> no tienen
              </>
            )}
          </p>
          <button
            type="button"
            onClick={terminar}
            disabled={guardando}
            className="w-full rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white py-3 text-sm font-semibold disabled:opacity-50"
          >
            {guardando ? "Guardando..." : `Listo, ya lo pedí en ${proveedor}`}
          </button>
        </div>
      </div>
    </div>
  );
}
