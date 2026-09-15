"use client";

import { useEffect, useState, useTransition } from "react";
import { registrarMerma, costoDeMerma } from "@/app/(app)/stock/actions";

// Registrar mercadería perdida.
//
// La decisión de diseño que manda acá es el recuadro de abajo: antes de
// apretar el botón tenés que ver cuánta plata cuesta. Con un proveedor que
// cobra por lo vendido, dar de baja tres bolsas no es corregir un número —
// es generar un pago. Si eso no se ve en pantalla, se descubre a fin de mes.

const MOTIVOS: { valor: string; etiqueta: string }[] = [
  { valor: "ROTURA", etiqueta: "Rotura" },
  { valor: "VENCIMIENTO", etiqueta: "Vencimiento" },
  { valor: "ROBO", etiqueta: "Robo" },
  { valor: "OTRO", etiqueta: "Otro" },
];

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

export default function MermaModal({
  nombre,
  idVariante,
  idLocal,
  cantidadActual,
  onClose,
}: {
  nombre: string;
  idVariante: string;
  idLocal: string;
  cantidadActual: number;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("ROTURA");
  const [detalle, setDetalle] = useState("");

  const [costo, setCosto] = useState<{
    costo: number;
    duenio: "LIQUIDACION" | "PROPIA" | "CONSIGNACION";
    deQuien: string;
    estimado: boolean;
  } | null>(null);
  const [calculando, setCalculando] = useState(false);

  const n = Number(cantidad) || 0;
  const valida = Number.isInteger(n) && n > 0 && n <= cantidadActual;

  // El costo se recalcula con cada cambio de cantidad, contra los lotes
  // reales. Es el mismo cálculo que hace la liquidación, así que el número
  // que se ve acá es el que se va a pagar — no una aproximación.
  useEffect(() => {
    if (!valida) {
      setCosto(null);
      return;
    }
    let vigente = true;
    setCalculando(true);
    costoDeMerma(idVariante, n)
      .then((r) => {
        if (vigente) setCosto(r);
      })
      .finally(() => {
        if (vigente) setCalculando(false);
      });
    return () => {
      vigente = false;
    };
  }, [idVariante, n, valida]);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const res = await registrarMerma(idVariante, idLocal, n, motivo, detalle);
      if (res.error) setError(res.error);
      else onClose();
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-200">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-amber-700">Registrar merma</p>
          <h2 className="text-lg font-semibold text-neutral-900 mt-0.5">{nombre}</h2>
          <p className="text-sm text-neutral-500 mt-1">Hay {cantidadActual} en este local</p>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">
              ¿Cuántas unidades se perdieron?
            </label>
            <input
              type="number"
              min={1}
              max={cantidadActual}
              step={1}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              autoFocus
              className="w-28 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-right tabular-nums font-semibold focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {n > cantidadActual && (
              <p className="text-xs text-red-600 mt-1.5">
                Solo hay {cantidadActual}. No se puede perder más de lo que hay.
              </p>
            )}
          </div>

          <div>
            <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">
              ¿Qué pasó?
            </label>
            <div className="flex gap-2 flex-wrap">
              {MOTIVOS.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  onClick={() => setMotivo(m.valor)}
                  className={`text-sm font-medium px-3.5 py-1.5 rounded-full border ${
                    motivo === m.valor
                      ? "bg-amber-50 border-amber-500 text-amber-800 font-semibold"
                      : "bg-white border-neutral-300 text-neutral-600 hover:border-neutral-400"
                  }`}
                >
                  {m.etiqueta}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">
              Detalle <span className="font-normal normal-case tracking-normal">(opcional)</span>
            </label>
            <input
              type="text"
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              placeholder="Se cayó el cajón al descargar"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-[11px] text-neutral-400 mt-1.5">
              Es lo único que va a explicar, dentro de seis meses, por qué faltaban estas unidades.
            </p>
          </div>

          {/* Lo que cuesta. Aparece solo cuando hay una cantidad válida: un
              recuadro en $0 mientras se escribe distrae más de lo que informa. */}
          {/* El mismo hecho cuesta cosas distintas según de quién era la
              mercadería. Decirlo acá, antes de confirmar, es lo que evita que
              alguien cargue una merma de Alifrut pensando que es gratis. */}
          {valida && (
            <div
              className={`rounded-xl px-4 py-3 text-sm border ${
                costo?.duenio === "CONSIGNACION"
                  ? "bg-neutral-50 border-neutral-200 text-neutral-600"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              {calculando || !costo ? (
                "Calculando cuánto cuesta…"
              ) : costo.duenio === "LIQUIDACION" ? (
                <>
                  Se le van a pagar <b>${formatearMonto(costo.costo)} + IVA</b> a <b>{costo.deQuien}</b> en la
                  próxima liquidación, igual que si se hubieran vendido.
                  {costo.estimado && (
                    <span className="block mt-1.5 text-[12px] font-semibold">
                      Ojo: no hay lotes con costo suficientes para estas unidades, así que una parte sale a costo
                      estimado.
                    </span>
                  )}
                </>
              ) : costo.duenio === "PROPIA" ? (
                <>
                  Perdés <b>${formatearMonto(costo.costo)}</b>. Esta mercadería ya era tuya, así que{" "}
                  <b>no genera ningún pago nuevo</b> — ya la pagaste con la factura del proveedor.
                  {costo.estimado && (
                    <span className="block mt-1.5 text-[12px] font-semibold">
                      Este producto no tiene costo cargado, así que la pérdida figura en $0.
                    </span>
                  )}
                </>
              ) : (
                <>
                  Esta mercadería es de <b>{costo.deQuien}</b>, así que <b>no te cuesta plata</b>: el riesgo es de la
                  marca. Se descuenta del stock y queda registrado con el motivo.
                </>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-2.5">
          <button
            onClick={onClose}
            disabled={isPending}
            className="flex-1 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !valida}
            className="flex-1 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {isPending ? "Registrando…" : "Registrar merma"}
          </button>
        </div>
      </div>
    </div>
  );
}
