"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PadFirma from "@/components/PadFirma";
import { firmarMiRecibo } from "@/app/(app)/mis-recibos/actions";
import type { MiRecibo } from "@/lib/misRecibos";

// Mis recibos: cada sueldo pagado con su recibo. Si falta la firma, se firma
// acá con el dedo y queda guardado en su legajo (Gonzalo, 2026-11-12).

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

export default function MisRecibosApp({
  recibos,
  faltaSql,
  sinPersona,
  empresa,
}: {
  recibos: MiRecibo[];
  faltaSql: boolean;
  sinPersona: boolean;
  empresa: string;
}) {
  const router = useRouter();
  const [firmando, setFirmando] = useState<string | null>(null);
  const [firma, setFirma] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function confirmar(idCierre: string) {
    if (!firma) return;
    setGuardando(true);
    setError(null);
    firmarMiRecibo(idCierre, firma)
      .then((r) => {
        if (r.error) setError(r.error);
        else {
          setFirmando(null);
          setFirma(null);
          router.refresh();
        }
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Mis recibos</h1>
      <p className="text-sm text-neutral-500 mb-4">Tus sueldos pagados. Firmá cada recibo cuando te pagan: queda guardado en tu legajo.</p>

      {sinPersona && <p className="text-sm text-neutral-500 bg-white border border-neutral-200 rounded-xl px-4 py-3">Tu usuario no tiene un legajo: no hay recibos para mostrar.</p>}
      {faltaSql && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          Para poder firmar falta un paso de administración (sql/pagos-equipo.sql).
        </p>
      )}
      {!sinPersona && recibos.length === 0 && (
        <p className="text-sm text-neutral-500 bg-white border border-neutral-200 rounded-xl px-4 py-3">Todavía no hay sueldos pagados.</p>
      )}

      <ul className="space-y-2.5">
        {recibos.map((r) => (
          <li key={r.idCierre} className={`bg-white rounded-xl border px-4 py-3.5 ${!r.firmado && !faltaSql ? "border-amber-300" : "border-neutral-200"}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-neutral-900">{r.etiqueta}</span>
              <span className="tabular-nums font-bold text-neutral-900">{pesos(r.neto)}</span>
              <span className="text-xs text-neutral-500">pagado el {fecha(r.fechaPago)}</span>
              <span
                className={`ml-auto text-[11px] font-bold rounded-full px-2 py-px ${
                  r.firmado ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                }`}
              >
                {r.firmado ? `Firmado el ${fecha(r.firmadoEn)}` : "Falta tu firma"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 mt-2.5">
              <a href={`/rrhh/recibo/${r.idCierre}`} className="text-sm font-semibold text-accent hover:underline">
                Ver el recibo
              </a>
              {!r.firmado && !faltaSql && firmando !== r.idCierre && (
                <button
                  type="button"
                  onClick={() => {
                    setFirmando(r.idCierre);
                    setFirma(null);
                    setError(null);
                  }}
                  className="ml-auto bg-accent hover:bg-accent-dark text-white text-sm font-bold rounded-lg px-4 py-1.5"
                >
                  Firmar
                </button>
              )}
            </div>
            {firmando === r.idCierre && (
              <div className="mt-3 border-t border-neutral-100 pt-3">
                <p className="text-sm text-neutral-700 mb-2">
                  Recibí de {empresa} la suma de <b className="tabular-nums">{pesos(r.neto)}</b> como pago de mis haberes de {r.etiqueta.toLowerCase()}.
                </p>
                <PadFirma onCambio={setFirma} />
                {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
                <div className="flex justify-end gap-2 mt-3">
                  <button type="button" onClick={() => setFirmando(null)} className="text-sm text-neutral-500 px-3 py-1.5">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!firma || guardando}
                    onClick={() => confirmar(r.idCierre)}
                    className="bg-accent hover:bg-accent-dark disabled:opacity-40 text-white text-sm font-bold rounded-lg px-4 py-1.5"
                  >
                    {guardando ? "Guardando…" : "Confirmar firma"}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
