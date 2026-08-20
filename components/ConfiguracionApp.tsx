"use client";

import { useMemo, useState, useTransition } from "react";
import { guardarConfigPuntos } from "@/app/(app)/configuracion/actions";

export default function ConfiguracionApp({
  puntosActivo,
  puntosCadaMonto,
  puntosOtorgados,
}: {
  puntosActivo: boolean;
  puntosCadaMonto: number;
  puntosOtorgados: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [guardado, setGuardado] = useState(false);
  const [activo, setActivo] = useState(puntosActivo);
  const [cadaMonto, setCadaMonto] = useState(puntosCadaMonto);
  const [otorgados, setOtorgados] = useState(puntosOtorgados);
  const [compraEjemplo, setCompraEjemplo] = useState(23500);

  const puntosCalculados = useMemo(() => {
    if (!cadaMonto || cadaMonto <= 0) return 0;
    return Math.floor((compraEjemplo / cadaMonto) * otorgados);
  }, [compraEjemplo, cadaMonto, otorgados]);

  function handleSubmit(formData: FormData) {
    setGuardado(false);
    startTransition(async () => {
      await guardarConfigPuntos(formData);
      setGuardado(true);
    });
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Configuración</h1>
      <p className="text-sm text-neutral-500 mb-6">Parámetros generales del sistema WiiGo.</p>

      <form action={handleSubmit} className="bg-white border border-neutral-200 rounded-xl p-5">
        <h2 className="text-base font-semibold text-neutral-900 mb-1">⭐ WiiGo Club</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Configurá cómo acumulan puntos los clientes en sus compras.
        </p>

        <label className="flex items-center justify-between mb-4 cursor-pointer">
          <span className="text-sm font-medium text-neutral-700">Acumulación de puntos</span>
          <span className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${activo ? "text-emerald-700" : "text-neutral-400"}`}>
              {activo ? "ACTIVADA" : "DESACTIVADA"}
            </span>
            <input
              type="checkbox"
              name="puntos_activo"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
              className="h-5 w-9 rounded-full appearance-none bg-neutral-200 checked:bg-accent relative transition-colors cursor-pointer
                before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform
                checked:before:translate-x-4"
            />
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="puntos_cada_monto">
              Cada $
            </label>
            <input
              id="puntos_cada_monto"
              name="puntos_cada_monto"
              type="number"
              value={cadaMonto}
              onChange={(e) => setCadaMonto(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="puntos_otorgados">
              Puntos otorgados
            </label>
            <input
              id="puntos_otorgados"
              name="puntos_otorgados"
              type="number"
              value={otorgados}
              onChange={(e) => setOtorgados(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        <div className="bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2 mb-4">
          <p className="text-xs text-neutral-500">Regla actual</p>
          <p className="text-sm font-semibold text-neutral-900">
            {otorgados} puntos cada ${cadaMonto.toLocaleString("es-AR")}
          </p>
        </div>

        <div className="mb-5">
          <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="compra_ejemplo">
            Ejemplo — Compra de ejemplo
          </label>
          <input
            id="compra_ejemplo"
            type="number"
            value={compraEjemplo}
            onChange={(e) => setCompraEjemplo(Number(e.target.value))}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <p className="text-sm text-neutral-600">
            Compra de ${compraEjemplo.toLocaleString("es-AR")} →{" "}
            <strong className="text-neutral-900">{puntosCalculados} puntos</strong>
          </p>
        </div>

        {guardado && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4">
            Configuración guardada.
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPending ? "Guardando..." : "Guardar configuración"}
        </button>
      </form>
    </div>
  );
}
