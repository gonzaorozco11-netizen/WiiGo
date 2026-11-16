"use client";

import { useState } from "react";
import { marcarTransferenciaEnviada } from "@/app/(app)/ventas/actions";

// Después de devolver una venta cobrada por transferencia (Gonzalo, 16/11):
// «¿Ya le enviaste la transferencia?». Si dice que no, queda pendiente y la
// caja no se puede cerrar hasta marcarla como enviada (lib/transferenciasPendientes.ts).

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

export default function PreguntaTransferencia({
  idDevolucion,
  monto,
  onListo,
}: {
  idDevolucion: string;
  monto: number;
  onListo: (enviada: boolean) => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function si() {
    setGuardando(true);
    setError(null);
    const r = await marcarTransferenciaEnviada(idDevolucion);
    setGuardando(false);
    if (r.error) setError(r.error);
    else onListo(true);
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="pregunta-transf">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-2xl">
        <div className="text-4xl" aria-hidden="true">
          💸
        </div>
        <h3 id="pregunta-transf" className="mt-2 text-lg font-bold text-neutral-900 text-balance">
          ¿Ya le enviaste {pesos(monto)} por transferencia al cliente?
        </h3>
        <p className="mt-1 text-sm text-neutral-500">Esta venta entró por transferencia: la plata se le devuelve a mano desde la app de Mercado Pago.</p>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-4 grid gap-2">
          <button type="button" disabled={guardando} onClick={si} className="rounded-xl bg-emerald-600 py-3 font-bold text-white disabled:opacity-50">
            {guardando ? "Guardando…" : "Sí, ya la envié"}
          </button>
          <button type="button" disabled={guardando} onClick={() => onListo(false)} className="rounded-xl border border-neutral-300 py-3 font-bold text-neutral-700">
            Todavía no
          </button>
        </div>
      </div>
    </div>
  );
}
