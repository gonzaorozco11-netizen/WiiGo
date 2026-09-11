"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { lineasParaDevolver, registrarDevolucion } from "@/app/(app)/ventas/actions";
import type { LineaDevolvible } from "@/lib/devoluciones";

// Devolver parte de una venta.
//
// Dos decisiones que sostienen la pantalla:
//
// · Las cantidades se tocan, no se escriben. Con un cliente enfrente, tipear
//   un número es donde se cuela el error — y así no hay forma de devolver
//   más unidades de las que se llevó.
//
// · Todo lo que va a pasar se lista ANTES de confirmar. Quien aprieta el
//   botón tiene que saber que se emite una nota de crédito, que sale plata de
//   la caja y que a la marca se le descuenta.

function pesos(v: number) {
  return `$${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DevolucionPanel({
  idVenta,
  medioPago,
  tieneFactura,
  yaLiquidada,
  onListo,
  onCerrar,
}: {
  idVenta: string;
  medioPago: string | null;
  tieneFactura: boolean;
  yaLiquidada: boolean;
  onListo: (aviso?: string) => void;
  onCerrar: () => void;
}) {
  const [lineas, setLineas] = useState<LineaDevolvible[] | null>(null);
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [destino, setDestino] = useState<"VUELVE" | "NO_VUELVE">("VUELVE");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const porMercadoPago = medioPago === "MERCADO_PAGO";

  useEffect(() => {
    let vigente = true;
    lineasParaDevolver(idVenta)
      .then((l) => {
        if (vigente) setLineas(l);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el detalle"));
    return () => {
      vigente = false;
    };
  }, [idVenta]);

  const resumen = useMemo(() => {
    let unidades = 0;
    let total = 0;
    (lineas ?? []).forEach((l) => {
      const n = cantidades[l.idDetalle] ?? 0;
      unidades += n;
      total += n * l.precioUnitario;
    });
    return { unidades, total: Math.round(total * 100) / 100 };
  }, [lineas, cantidades]);

  function mover(l: LineaDevolvible, delta: number) {
    setCantidades((prev) => {
      const actual = prev[l.idDetalle] ?? 0;
      return { ...prev, [l.idDetalle]: Math.max(0, Math.min(l.disponible, actual + delta)) };
    });
  }

  function confirmar() {
    setError(null);
    const pedido = Object.entries(cantidades)
      .filter(([, n]) => n > 0)
      .map(([idDetalle, cantidad]) => ({ idDetalle, cantidad }));

    startTransition(async () => {
      const r = await registrarDevolucion(idVenta, pedido, { motivo, destino });
      if (r.error) setError(r.error);
      else onListo(r.aviso);
    });
  }

  if (lineas === null) {
    return <p className="text-sm text-neutral-500 py-4">Cargando el detalle…</p>;
  }

  const nadaPorDevolver = lineas.every((l) => l.disponible === 0);

  return (
    <div className="border border-neutral-300 bg-white rounded-xl p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <p className="text-sm font-semibold text-neutral-900">Devolver productos</p>
        <button onClick={onCerrar} className="text-xs text-neutral-400 hover:text-neutral-700">
          Cerrar
        </button>
      </div>

      {nadaPorDevolver ? (
        <p className="text-sm text-neutral-500">Ya se devolvió todo lo de esta venta.</p>
      ) : (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">Qué devuelve</p>
          <ul className="flex flex-col gap-2 mb-4">
            {lineas.map((l) => {
              const n = cantidades[l.idDetalle] ?? 0;
              const agotada = l.disponible === 0;
              return (
                <li
                  key={l.idDetalle}
                  className={`flex items-center gap-3 flex-wrap border rounded-lg px-3 py-2.5 ${
                    n > 0 ? "border-accent bg-accent-tint" : "border-neutral-200"
                  } ${agotada ? "opacity-50" : ""}`}
                >
                  <div className="flex-1 min-w-[160px]">
                    <p className="text-sm font-semibold text-neutral-900">{l.producto}</p>
                    <p className="text-xs text-neutral-400">
                      Llevó {l.cantidadVendida} × {pesos(l.precioUnitario)}
                      {l.cantidadYaDevuelta > 0 && ` · ya devolvió ${l.cantidadYaDevuelta}`}
                    </p>
                  </div>

                  <div className="flex items-center">
                    <button
                      onClick={() => mover(l, -1)}
                      disabled={n === 0}
                      aria-label="Sacar uno"
                      className="w-8 h-8 border border-neutral-300 rounded-l-lg text-neutral-600 disabled:opacity-30 hover:bg-neutral-50"
                    >
                      −
                    </button>
                    <span
                      className={`min-w-[38px] text-center text-sm font-bold border-y border-neutral-300 py-1.5 tabular-nums ${
                        n === 0 ? "text-neutral-400 font-normal" : "text-neutral-900"
                      }`}
                    >
                      {n}
                    </span>
                    <button
                      onClick={() => mover(l, 1)}
                      disabled={n >= l.disponible}
                      aria-label="Agregar uno"
                      className="w-8 h-8 border border-neutral-300 rounded-r-lg text-neutral-600 disabled:opacity-30 hover:bg-neutral-50"
                    >
                      +
                    </button>
                  </div>

                  <span
                    className={`w-24 text-right text-sm tabular-nums ${
                      n === 0 ? "text-neutral-300" : "font-semibold text-neutral-900"
                    }`}
                  >
                    {pesos(n * l.precioUnitario)}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* La pregunta sanitaria. Va grande y la opción "no vuelve" en rojo:
              si el producto está abierto o vencido y el sistema lo repone, se
              lo vende al cliente siguiente. */}
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">
            ¿Vuelve a la góndola?
          </p>
          <div className="flex gap-2 flex-wrap mb-4">
            {(
              [
                ["VUELVE", "Sí, está cerrado y sano", "Vuelve al stock y se puede vender de nuevo."],
                ["NO_VUELVE", "No — fallado, vencido o abierto", "No entra al stock. Queda para devolverle a la marca."],
              ] as const
            ).map(([valor, titulo, detalle]) => (
              <button
                key={valor}
                onClick={() => setDestino(valor)}
                className={`flex-1 min-w-[190px] text-left border rounded-lg px-3 py-2.5 ${
                  destino === valor
                    ? valor === "NO_VUELVE"
                      ? "border-red-500 bg-red-50"
                      : "border-accent bg-accent-tint"
                    : "border-neutral-200 hover:border-neutral-300"
                }`}
              >
                <span className="block text-sm font-semibold text-neutral-900">{titulo}</span>
                <span className="block text-xs text-neutral-500 mt-0.5">{detalle}</span>
              </button>
            ))}
          </div>

          <div className="border border-neutral-200 rounded-lg px-3 py-2.5 mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">La plata vuelve</p>
            <p className="text-sm font-semibold text-neutral-900">
              {porMercadoPago ? "Por Mercado Pago" : "En efectivo, de la caja"}
            </p>
            <p className="text-xs text-neutral-500 mt-0.5">
              {porMercadoPago
                ? "El sistema le pide el reintegro a Mercado Pago al confirmar. Si pagó con tarjeta, puede aparecerle recién en el resumen siguiente."
                : "Sale del turno abierto ahora y el arqueo lo descuenta solo."}
            </p>
          </div>

          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Motivo de la devolución (obligatorio)"
            className="w-full border border-neutral-300 rounded-lg px-2.5 py-2 text-sm mb-3"
          />

          {/* Las consecuencias, antes de confirmar y no después. */}
          {resumen.unidades > 0 && (
            <ul className="bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2.5 mb-3 flex flex-col gap-1.5">
              <li className="flex justify-between text-sm">
                <span className="text-neutral-500">Se le devuelve</span>
                <span className="font-bold tabular-nums">{pesos(resumen.total)}</span>
              </li>
              <li className="text-xs text-neutral-500">
                {destino === "VUELVE"
                  ? `${resumen.unidades} ${resumen.unidades === 1 ? "unidad vuelve" : "unidades vuelven"} al stock.`
                  : `${resumen.unidades} ${resumen.unidades === 1 ? "unidad no vuelve" : "unidades no vuelven"} al stock: quedan para devolverle a la marca.`}
              </li>
              {tieneFactura && (
                <li className="text-xs text-neutral-500">
                  Se emite una nota de crédito por {pesos(resumen.total)} contra la factura de esta venta.
                </li>
              )}
              {yaLiquidada && (
                <li className="text-xs text-neutral-500">
                  Esta venta ya se liquidó: a la marca se le descuenta lo suyo de la próxima.
                </li>
              )}
            </ul>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={confirmar}
              disabled={pendiente || resumen.unidades === 0 || !motivo.trim()}
              className="flex-1 text-sm font-semibold text-white bg-red-600 rounded-lg py-2 disabled:opacity-40"
            >
              {pendiente ? "Registrando…" : "Confirmar devolución"}
            </button>
            <button onClick={onCerrar} disabled={pendiente} className="text-sm font-semibold text-neutral-500 px-3">
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
