"use client";

import { useMemo, useState, useTransition } from "react";
import { marcarDevueltaAMarca, type MercaderiaADevolver } from "@/app/(app)/reposicion/actions";
import { useRouter } from "next/navigation";

// Mercadería apartada que hay que devolverle a la marca.
//
// Agrupada por marca y no por fecha: la entrega es un solo acto por marca —
// viene el repositor de Star Nutrition y se le da todo junto. Ordenar por
// fecha obligaría a buscar los renglones de esa marca desperdigados.

function fechaCorta(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
  });
}

function diasDesde(iso: string) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function DevolverAMarca({ items }: { items: MercaderiaADevolver[] }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const porMarca = useMemo(() => {
    const mapa = new Map<string, MercaderiaADevolver[]>();
    items.forEach((i) => mapa.set(i.marca, [...(mapa.get(i.marca) ?? []), i]));
    // La marca con lo más viejo esperando va primero: es lo que más tiempo
    // lleva ocupando lugar en el depósito.
    return [...mapa.entries()].sort((a, b) => {
      const viejoA = Math.min(...a[1].map((i) => new Date(i.fecha).getTime()));
      const viejoB = Math.min(...b[1].map((i) => new Date(i.fecha).getTime()));
      return viejoA - viejoB;
    });
  }, [items]);

  if (items.length === 0) return null;

  const unidadesTotal = items.reduce((a, i) => a + i.cantidad, 0);

  function entregar(ids: string[]) {
    setError(null);
    startTransition(async () => {
      const r = await marcarDevueltaAMarca(ids);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
      <p className="text-sm font-semibold text-amber-900 mb-0.5">
        📦 Para devolverle a la marca ({unidadesTotal} {unidadesTotal === 1 ? "unidad" : "unidades"})
      </p>
      <p className="text-xs text-amber-800 mb-3">
        Productos que un cliente devolvió fallados, vencidos o abiertos. No volvieron a la góndola: están apartados
        esperando que pase el repositor.
      </p>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      <ul className="flex flex-col gap-2">
        {porMarca.map(([marca, renglones]) => {
          const unidades = renglones.reduce((a, r) => a + r.cantidad, 0);
          const masViejo = Math.max(...renglones.map((r) => diasDesde(r.fecha)));
          const abierto = abierta === marca;
          return (
            <li key={marca} className="bg-white border border-amber-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2.5">
                <button
                  onClick={() => setAbierta(abierto ? null : marca)}
                  className="text-left flex-1 min-w-[180px]"
                >
                  <span className="block text-sm font-semibold text-neutral-900">{marca}</span>
                  <span className="block text-xs text-neutral-500">
                    {unidades} {unidades === 1 ? "unidad" : "unidades"} ·{" "}
                    {renglones.length === 1 ? "1 producto" : `${renglones.length} productos`}
                    {/* Más de un mes juntando polvo ya es plata parada: se marca. */}
                    {masViejo >= 30 && (
                      <span className="text-red-600 font-semibold"> · hace {masViejo} días</span>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => entregar(renglones.map((r) => r.idDetalleDev))}
                  disabled={pendiente}
                  className="text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg px-3 py-1.5 disabled:opacity-50"
                >
                  {pendiente ? "..." : "Ya se lo entregué"}
                </button>
              </div>

              {abierto && (
                <ul className="border-t border-amber-100 divide-y divide-amber-50">
                  {renglones.map((r) => (
                    <li key={r.idDetalleDev} className="px-3 py-2 flex justify-between gap-3 flex-wrap">
                      <span className="text-sm text-neutral-700">
                        <b className="font-semibold text-neutral-900">{r.cantidad}×</b> {r.producto}
                        <span className="block text-xs text-neutral-400">
                          {r.numeroVenta ? `Pedido #${String(r.numeroVenta).padStart(4, "0")} · ` : ""}
                          {fechaCorta(r.fecha)} · {r.motivo}
                        </span>
                      </span>
                      <button
                        onClick={() => entregar([r.idDetalleDev])}
                        disabled={pendiente}
                        className="text-xs text-amber-800 hover:underline self-start disabled:opacity-50"
                      >
                        Entregar solo este
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
