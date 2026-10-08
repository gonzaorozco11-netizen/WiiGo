"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  aprobarPropuesta,
  rechazarPropuesta,
  type PropuestaPendiente,
} from "@/app/(app)/reposicion/actions";

// Lo que espera que administración decida: mercadería que no salió de una
// orden de Compras.
//
// Son dos situaciones que parecen la misma y no lo son, y por eso el bloque
// las distingue antes de que se lea nada:
//
//   Llegó sin pedido  — la mercadería YA está en el depósito, frenada. Hay
//     que resolverla hoy. Franja roja.
//   La propuso la marca — todavía no salió de ella. Puede esperar. Franja
//     azul.
//
// Por lo mismo los botones dicen cosas distintas: lo que ya llegó entra al
// stock de una —el operativo lo contó al cargarlo, no hace falta recibirlo
// dos veces— y lo propuesto genera una orden que después se recibe normal.

export default function PropuestasPendientes({ propuestas }: { propuestas: PropuestaPendiente[] }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  // Vacío no se dibuja: una tarjeta que dice "no hay nada" ocupa el mismo
  // lugar que una que sí tiene algo, y lo normal es que no haya nada.
  if (propuestas.length === 0 && !hecho) return null;

  return (
    <section className="border border-neutral-200 rounded-xl bg-white overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Esperando tu aprobación</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Mercadería que nadie pidió desde Compras. Hasta que decidas, no entra al stock ni se vende.
          </p>
        </div>
        {propuestas.length > 0 && (
          <span className="text-[11px] font-bold uppercase tracking-wide bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-2.5 py-1">
            {propuestas.length} esperando
          </span>
        )}
      </div>

      {propuestas.map((p) => (
        <Propuesta
          key={p.idOrden}
          p={p}
          abierta={abierta === p.idOrden}
          onAbrir={() => setAbierta((a) => (a === p.idOrden ? null : p.idOrden))}
          onListo={(msg) => {
            setAbierta(null);
            setHecho(msg);
          }}
        />
      ))}

      {hecho && (
        <p className="px-4 py-3 bg-emerald-50 border-t border-emerald-200 text-emerald-800 text-xs">
          {hecho}
        </p>
      )}
    </section>
  );
}

function Propuesta({
  p,
  abierta,
  onAbrir,
  onListo,
}: {
  p: PropuestaPendiente;
  abierta: boolean;
  onAbrir: () => void;
  onListo: (msg: string) => void;
}) {
  const router = useRouter();
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [trabajando, empezar] = useTransition();

  const esLlego = p.origen === "SIN_PEDIDO";
  const cantidadDe = (idDetalle: string, original: number) => cantidades[idDetalle] ?? original;
  const total = p.items.reduce((a, i) => a + cantidadDe(i.idDetalle, i.cantidad), 0);
  const original = p.items.reduce((a, i) => a + i.cantidad, 0);

  function ajustes() {
    return p.items
      .filter((i) => cantidades[i.idDetalle] != null && cantidades[i.idDetalle] !== i.cantidad)
      .map((i) => ({ idDetalle: i.idDetalle, cantidad: cantidades[i.idDetalle] }));
  }

  function aprobar() {
    setError(null);
    empezar(async () => {
      const r = await aprobarPropuesta(p.idOrden, ajustes());
      if (r.error) setError(r.error);
      else {
        onListo(`${p.marca} — ${r.aviso ?? "aprobada"}`);
        router.refresh();
      }
    });
  }

  function rechazar() {
    setError(null);
    empezar(async () => {
      const r = await rechazarPropuesta(p.idOrden, motivo);
      if (r.error) setError(r.error);
      else {
        onListo(`${p.marca} — rechazada. La marca ve el motivo en su portal.`);
        router.refresh();
      }
    });
  }

  return (
    <div className="border-b border-neutral-100 last:border-0">
      <button
        onClick={onAbrir}
        aria-expanded={abierta}
        className={`w-full flex items-start gap-3 px-4 py-3 text-left ${abierta ? "bg-neutral-50" : "hover:bg-neutral-50"}`}
      >
        <span className={`w-[3px] self-stretch rounded-sm flex-none ${esLlego ? "bg-red-600" : "bg-blue-600"}`} />
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <b className="text-sm font-semibold text-neutral-900">{p.marca}</b>
            <span
              className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 border ${
                esLlego
                  ? "bg-red-50 text-red-800 border-red-200"
                  : "bg-blue-50 text-blue-800 border-blue-200"
              }`}
            >
              {esLlego ? "Llegó sin pedido" : "La propuso la marca"}
            </span>
          </span>
          <span className="block text-xs text-neutral-500 mt-0.5">
            {p.local} · {fechaCorta(p.fecha)}
          </span>
          {esLlego && (
            <span className="block text-xs text-red-700 mt-1 font-medium">
              ⚠ La mercadería ya está en el depósito, frenada hasta que decidas.
            </span>
          )}
        </span>
        <span className="text-right flex-none">
          <span className="block text-base font-semibold tabular-nums text-neutral-900">{total}</span>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            {total === original ? "unidades" : `de ${original}`}
          </span>
        </span>
      </button>

      {abierta && (
        <div className="px-4 pb-4 bg-neutral-50 border-t border-neutral-100">
          <p
            className={`text-xs rounded-lg px-3 py-2.5 my-3 border ${
              esLlego
                ? "bg-red-50 border-red-200 text-red-800"
                : "bg-blue-50 border-blue-200 text-blue-800"
            }`}
          >
            {esLlego
              ? "Esto ya lo contó el operativo y está en el depósito. Si lo añadís, entra al stock con estas cantidades y se puede vender. Si lo rechazás, se le devuelve a la marca."
              : "Todavía no salió de la marca. Si lo aprobás, se convierte en una orden normal y queda en Recepción esperando la entrega."}
          </p>

          <div className="border border-neutral-200 rounded-lg overflow-hidden bg-white">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200 text-[10px] uppercase tracking-wide text-neutral-400">
                  <th className="text-left font-bold px-3 py-2">Producto</th>
                  <th className="text-right font-bold px-3 py-2 w-20">{esLlego ? "Llegó" : "Propone"}</th>
                  <th className="text-right font-bold px-3 py-2 w-28">Aceptás</th>
                </tr>
              </thead>
              <tbody>
                {p.items.map((i) => {
                  const c = cantidadDe(i.idDetalle, i.cantidad);
                  return (
                    <tr key={i.idDetalle} className="border-b border-neutral-50 last:border-0">
                      <td className="px-3 py-2">
                        {i.producto}
                        <span className="block text-[11px] text-neutral-400">
                          hay {i.stock} en góndola
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{i.cantidad}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={c}
                          disabled={trabajando}
                          onChange={(e) =>
                            setCantidades((prev) => ({
                              ...prev,
                              [i.idDetalle]: Math.max(0, Number(e.target.value) || 0),
                            }))
                          }
                          className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-xs text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
                          aria-label={`Cantidad a aceptar de ${i.producto}`}
                        />
                        {c !== i.cantidad && (
                          <span className="block text-[10px] font-semibold text-amber-700 mt-0.5">
                            {c === 0 ? "no entra" : `${c > i.cantidad ? "+" : "−"}${Math.abs(c - i.cantidad)}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {p.observaciones && (
            <p className="text-xs text-neutral-600 bg-white border border-neutral-200 rounded-lg px-3 py-2.5 mt-3">
              <b className="text-neutral-900">Dice:</b> {p.observaciones}
            </p>
          )}

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
              {error}
            </p>
          )}

          <div className="flex gap-2 items-center mt-3 flex-wrap">
            <button
              onClick={aprobar}
              disabled={trabajando || total <= 0}
              className="text-sm font-semibold bg-emerald-700 text-white rounded-lg px-4 py-2 disabled:opacity-50"
            >
              {trabajando
                ? "Guardando…"
                : `${esLlego ? "Añadir a stock" : "Aprobar el envío"}${total !== original ? ` (${total})` : ""}`}
            </button>
            <button
              onClick={() => setRechazando(true)}
              disabled={trabajando}
              className="text-sm font-semibold bg-white text-red-700 border border-red-200 rounded-lg px-4 py-2 disabled:opacity-50"
            >
              Rechazar
            </button>
            <span className="flex-1 text-right text-[11px] text-neutral-500">
              {esLlego
                ? "Si contaron mal o aceptás solo una parte, cambiá la cantidad antes de añadir."
                : "Podés bajar una cantidad a 0 para aceptar solo una parte."}
            </span>
          </div>

          {rechazando && (
            <div className="mt-3 bg-white border border-red-200 rounded-lg p-3">
              <label className="block text-xs font-semibold text-red-800 mb-1.5" htmlFor={`mot-${p.idOrden}`}>
                ¿Por qué la rechazás?
              </label>
              <textarea
                id={`mot-${p.idOrden}`}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                placeholder="Ej.: no tenemos espacio de góndola para un sabor más este mes."
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400"
              />
              {/* El motivo es obligatorio del lado del servidor también: un
                  rechazo sin motivo se vuelve a mandar igual la semana que
                  viene. */}
              <p className="text-[11px] text-neutral-500 mt-1.5">
                La marca lo va a ver en su portal. Sin motivo, manda lo mismo la semana que viene.
              </p>
              <div className="flex gap-2 mt-2.5">
                <button
                  onClick={rechazar}
                  disabled={trabajando || !motivo.trim()}
                  className="text-sm font-semibold bg-white text-red-700 border border-red-200 rounded-lg px-4 py-2 disabled:opacity-50"
                >
                  Rechazar y avisarle
                </button>
                <button
                  onClick={() => setRechazando(false)}
                  disabled={trabajando}
                  className="text-sm font-semibold bg-white text-neutral-600 border border-neutral-300 rounded-lg px-4 py-2"
                >
                  Volver
                </button>
              </div>
            </div>
          )}
        </div>
      )}
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
