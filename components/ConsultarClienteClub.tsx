"use client";

import { useState, useTransition } from "react";
import { consultarClienteClub, type FichaClub } from "@/app/(app)/club/actions";
import SumarClienteClub from "@/components/SumarClienteClub";

// WiiGo Club en una sola hoja (Gonzalo, 21/11): arriba se suma un cliente (el
// formulario de siempre, SumarClienteClub) y abajo se busca por DNI (nombre, desde
// cuándo está, puntos). Si el buscado no está, el DNI pasa solo al formulario de arriba.

const fecha = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

export default function ConsultarClienteClub() {
  const [dni, setDni] = useState("");
  const [res, setRes] = useState<{ cliente: FichaClub | null; dni: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const limpio = dni.replace(/\D/g, "");
    start(async () => {
      const r = await consultarClienteClub(limpio);
      if (r.error) {
        setError(r.error);
        setRes(null);
      } else setRes({ cliente: r.cliente, dni: limpio });
    });
  }

  return (
    <div className="space-y-4">
      {/* Arriba sumar, abajo buscar (Gonzalo, 21/11). */}
      <div className="bg-white border border-neutral-200 rounded-xl p-4">
        <p className="text-sm font-bold text-neutral-900 mb-2">⭐ Sumar un cliente</p>
        <SumarClienteClub key={res && !res.cliente ? res.dni : "vacio"} dniInicial={res && !res.cliente ? res.dni : ""} />
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl p-4">
        <p className="text-sm font-bold text-neutral-900 mb-2">🔎 Buscar un cliente</p>
        <form onSubmit={buscar} className="flex gap-2">
          <input
            value={dni}
            onChange={(e) => setDni(e.target.value)}
            inputMode="numeric"
            placeholder="DNI, sin puntos"
            aria-label="DNI"
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button type="submit" disabled={pendiente || !dni.trim()} className="rounded-lg bg-neutral-900 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {pendiente ? "Buscando..." : "Buscar"}
          </button>
        </form>
        {error && <p className="text-xs text-red-600 font-semibold mt-2">{error}</p>}

        {res?.cliente && (
          <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
            <p className="text-base font-bold text-emerald-900">
              ⭐ {res.cliente.nombre} {res.cliente.apellido ?? ""}
            </p>
            <p className="text-xs text-emerald-800">DNI {res.cliente.dni}</p>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="rounded-lg bg-white px-3 py-2">
                <p className="text-2xl font-extrabold text-emerald-800 tabular-nums">{res.cliente.puntos.toLocaleString("es-AR")}</p>
                <p className="text-[11px] text-neutral-500">puntos acumulados</p>
              </div>
              <div className="rounded-lg bg-white px-3 py-2">
                <p className="text-sm font-bold text-neutral-900">{res.cliente.desde ? fecha(res.cliente.desde) : "—"}</p>
                <p className="text-[11px] text-neutral-500">se unió a WiiGo Club</p>
              </div>
            </div>
            <p className="text-xs text-neutral-600 mt-2">
              {res.cliente.compras
                ? `${res.cliente.compras} ${res.cliente.compras === 1 ? "compra" : "compras"} · la última el ${fecha(res.cliente.ultimaCompra!)}`
                : "Todavía no compró con su DNI."}
            </p>
          </div>
        )}

        {res && !res.cliente && (
          <p className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
            El DNI {res.dni} <b>no está en WiiGo Club</b>. Sumalo arriba: el DNI ya quedó puesto.
          </p>
        )}
      </div>
    </div>
  );
}
