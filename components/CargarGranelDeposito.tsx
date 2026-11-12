"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cargarGranelDelDeposito } from "@/app/(app)/compras/pedir/actions";
import { kgAGramos } from "@/lib/gramos";

// Cargar, una sola vez, el granel que ya estaba guardado en el depósito antes
// de que entrara por el sistema (Gonzalo, 2026-11-12). Pesan cada bolsa y
// anotan los kilos. Entra como una entrega de Alifrut con el costo del día
// (cargarGranelDelDeposito), porque es de Alifrut y se le paga al venderse.
// Después de esto el granel entra solo por Recepción.

export default function CargarGranelDeposito({ idLocal, graneles }: { idLocal: string; graneles: { idVariante: string; nombre: string; gramos: number }[] }) {
  const router = useRouter();
  const vacios = useMemo(() => graneles.filter((g) => g.gramos <= 0).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [graneles]);
  const [abierto, setAbierto] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [kilos, setKilos] = useState<Record<string, string>>({});
  const [guardando, startGuardar] = useTransition();
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  if (vacios.length === 0 && !mensaje) return null;

  const cargas = Object.entries(kilos)
    .map(([idVarianteGranel, texto]) => ({ idVarianteGranel, gramos: kgAGramos(texto) ?? 0 }))
    .filter((c) => c.gramos > 0);
  const totalKg = cargas.reduce((a, c) => a + c.gramos, 0) / 1000;
  const visibles = buscar.trim()
    ? vacios.filter((g) => g.nombre.toLowerCase().includes(buscar.trim().toLowerCase()))
    : vacios;

  function guardar() {
    setMensaje(null);
    startGuardar(async () => {
      const r = await cargarGranelDelDeposito(idLocal, cargas);
      if (r.error) return setMensaje({ tipo: "error", texto: r.error });
      setKilos({});
      setMensaje({ tipo: "ok", texto: `Listo: se cargaron ${r.cargados} ${r.cargados === 1 ? "granel" : "graneles"}. Ya se pueden fraccionar.` });
      router.refresh();
    });
  }

  return (
    <div className="max-w-3xl mx-auto mb-5 rounded-2xl border border-amber-200 bg-amber-50/60">
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} className="w-full text-left px-4 py-3 flex items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-semibold text-amber-900">Cargar lo que ya está en el depósito</span>
          <span className="block text-xs text-amber-800">
            {vacios.length} graneles figuran en 0. Si hay bolsas guardadas, pesalas y anotá los kilos: se hace una sola vez.
          </span>
        </span>
        <span className="text-amber-800 text-lg" aria-hidden="true">
          {abierto ? "▴" : "▾"}
        </span>
      </button>
      {mensaje && (
        <p className={`mx-4 mb-3 rounded-lg px-3 py-2 text-sm ${mensaje.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{mensaje.texto}</p>
      )}
      {abierto && vacios.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs text-amber-900 mb-2">
            Entra como una entrega de Alifrut con el precio de hoy: es de ellos y se les paga cuando se vende. Anotá solo lo que pesaste;
            lo que dejes vacío no se carga.
          </p>
          <input
            type="search"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar un granel…"
            className="w-full mb-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
          <ul className="max-h-[420px] overflow-y-auto flex flex-col gap-1.5 pr-1">
            {visibles.map((g) => (
              <li key={g.idVariante} className="flex items-center justify-between gap-3 rounded-lg bg-white border border-neutral-200 px-3 py-2">
                <span className="text-sm text-neutral-900 min-w-0">{g.nombre}</span>
                <span className="flex items-center gap-1 shrink-0">
                  <input
                    inputMode="decimal"
                    value={kilos[g.idVariante] ?? ""}
                    onChange={(e) => setKilos((p) => ({ ...p, [g.idVariante]: e.target.value.replace(/[^\d,.]/g, "") }))}
                    placeholder="0"
                    aria-label={`Kilos de ${g.nombre}`}
                    className="w-20 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-right"
                  />
                  <span className="text-xs text-neutral-500">kg</span>
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={guardar}
            disabled={guardando || cargas.length === 0}
            className="mt-3 w-full rounded-xl bg-accent hover:bg-accent-dark text-white py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {guardando
              ? "Cargando..."
              : cargas.length === 0
                ? "Anotá los kilos de lo que pesaste"
                : `Cargar ${cargas.length} ${cargas.length === 1 ? "granel" : "graneles"} · ${totalKg.toLocaleString("es-AR", { maximumFractionDigits: 3 })} kg`}
          </button>
        </div>
      )}
    </div>
  );
}
