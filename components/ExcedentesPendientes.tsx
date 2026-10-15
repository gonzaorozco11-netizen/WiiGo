"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolverExcedente, type ExcedentePendiente } from "@/app/(app)/reposicion/actions";

// Lo que llegó de más y todavía nadie resolvió.
//
// No es "aceptar o rechazar": la mercadería YA está en la góndola y ya se
// puede vender —entró al stock cuando la operativa la contó— así que lo único
// que falta es decidir si se queda o si la marca la retira.
//
// Es la bandeja de administración y no la de la operativa a propósito: el que
// abre la caja no conoce el tope de góndola acordado con cada marca, y el
// mostrador con el repartidor al lado no es lugar para negociar espacio. Ver
// lib/recepcionDiferencias.ts, que es donde vive la regla.
//
// Mientras esté sin resolver, la marca lee "sobran 4" en su portal sin saber
// si eso es mercadería suya que va a volver o stock en consignación que se le
// va a liquidar cuando se venda. Son dos cosas muy distintas para su plata, y
// por eso esto no puede quedar pendiente para siempre.

export default function ExcedentesPendientes({ items }: { items: ExcedentePendiente[] }) {
  const [hecho, setHecho] = useState<string | null>(null);

  // Vacío no se dibuja: lo normal es que no haya nada, y una tarjeta que dice
  // "no hay nada" ocupa el mismo lugar que una que sí tiene algo.
  if (items.length === 0 && !hecho) return null;

  return (
    <section className="border border-neutral-200 rounded-xl bg-white overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Llegó de más</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Ya está en la góndola y se vende. Falta decidir si se queda o si la marca lo retira —
            hasta que lo decidas, ella no sabe cuál de las dos cosas es.
          </p>
        </div>
        {items.length > 0 && (
          <span className="text-[11px] font-bold uppercase tracking-wide bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-2.5 py-1">
            {items.length} sin resolver
          </span>
        )}
      </div>

      {items.map((e) => (
        <Excedente key={e.idDetalleRecepcion} e={e} onListo={setHecho} />
      ))}

      {hecho && (
        <p className="px-4 py-3 bg-emerald-50 border-t border-emerald-200 text-emerald-800 text-xs">
          {hecho}
        </p>
      )}
    </section>
  );
}

function Excedente({
  e,
  onListo,
}: {
  e: ExcedentePendiente;
  onListo: (msg: string) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [trabajando, empezar] = useTransition();

  function resolver(resolucion: "SE_QUEDA" | "A_DEVOLVER") {
    setError(null);
    empezar(async () => {
      const r = await resolverExcedente(e.idDetalleRecepcion, resolucion);
      if (r.error) return setError(r.error);
      onListo(
        resolucion === "SE_QUEDA"
          ? `${e.producto}: las ${e.deMas} de más se quedan. Entran en la liquidación cuando se vendan.`
          : `${e.producto}: ${e.deMas} a devolver. Aparecen en Recepción para entregárselas al repartidor.`
      );
      router.refresh();
    });
  }

  return (
    <div className="border-b border-neutral-100 last:border-0 px-4 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <b className="text-sm font-semibold text-neutral-900">{e.producto}</b>
          <span className="block text-xs text-neutral-500 mt-0.5">
            {e.marca} · recibida el {fechaCorta(e.recibidaEl)}
            {e.recibidaPor ? ` por ${e.recibidaPor}` : ""}
          </span>
        </div>
        <div className="text-right flex-none">
          <span className="block text-base font-semibold tabular-nums text-amber-700">
            +{e.deMas}
          </span>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            anunció {e.anunciadas}, llegaron {e.llegaron}
          </span>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2.5">
          {error}
        </p>
      )}

      <div className="flex gap-2 items-center mt-2.5 flex-wrap">
        <button
          onClick={() => resolver("SE_QUEDA")}
          disabled={trabajando}
          className="text-sm font-semibold bg-emerald-700 text-white rounded-lg px-4 py-2 disabled:opacity-50"
        >
          {trabajando ? "Guardando…" : "Se quedan"}
        </button>
        <button
          onClick={() => resolver("A_DEVOLVER")}
          disabled={trabajando}
          className="text-sm font-semibold bg-white text-neutral-700 border border-neutral-300 rounded-lg px-4 py-2 disabled:opacity-50"
        >
          Que las retire
        </button>
        {/* Ninguno de los dos botones toca el stock: la mercadería entró al
            recibirla y sigue ahí. Si se devuelve, la salida se carga cuando se
            entrega de verdad. Decirlo acá evita que alguien ajuste el stock a
            mano "para compensar". */}
        <span className="flex-1 text-right text-[11px] text-neutral-500">
          Las dos opciones dejan el stock como está. Si se devuelve, la salida se carga al
          entregárselas.
        </span>
      </div>
    </div>
  );
}

function fechaCorta(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
