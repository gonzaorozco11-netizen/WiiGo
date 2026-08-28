"use client";

import { useEffect, useState, type ReactNode } from "react";
import { calcularResultadoMes, type ResultadoMes } from "@/app/(app)/resultado-mes/actions";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function mesActualISO() {
  return new Date().toISOString().slice(0, 7);
}

function formatearPeriodo(periodo: string) {
  const [anio, mes] = periodo.split("-");
  return `${MESES[Number(mes) - 1] ?? mes} ${anio}`;
}

function sumarMes(periodo: string, delta: number) {
  const [anio, mes] = periodo.split("-").map(Number);
  const d = new Date(anio, mes - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ResultadoMesApp() {
  const [periodo, setPeriodo] = useState(mesActualISO());
  const [datos, setDatos] = useState<ResultadoMes | null>(null);
  const [cargando, setCargando] = useState(true);
  const [expandido, setExpandido] = useState(false);

  useEffect(() => {
    setCargando(true);
    calcularResultadoMes(periodo)
      .then(setDatos)
      .finally(() => setCargando(false));
  }, [periodo]);

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <h1 className="text-lg font-semibold text-neutral-900">Resultado del mes</h1>
        <div className="flex items-center gap-1 bg-white border border-neutral-200 rounded-lg px-1 py-1 shadow-sm">
          <button onClick={() => setPeriodo((p) => sumarMes(p, -1))} className="px-2 py-1 text-neutral-400 hover:text-neutral-700 font-bold">
            ‹
          </button>
          <span className="text-sm font-bold px-2">{formatearPeriodo(periodo)}</span>
          <button onClick={() => setPeriodo((p) => sumarMes(p, 1))} className="px-2 py-1 text-neutral-400 hover:text-neutral-700 font-bold">
            ›
          </button>
        </div>
      </div>
      <p className="text-sm text-neutral-500 mb-5 max-w-lg">
        Se arma solo, juntando lo que ya pasó en el mes en cada módulo — Ventas, Liquidaciones, Gastos e Ingresos y
        Gastos. No hay nada para cargar acá.
      </p>

      {cargando || !datos ? (
        <p className="text-sm text-neutral-400 text-center py-12">Calculando...</p>
      ) : (
        <>
          <BloqueResultado titulo="Ingresos" color="emerald" total={datos.totalIngresos} signo="+">
            {datos.ingresos.length === 0 ? (
              <FilaVacia />
            ) : (
              datos.ingresos.map((i) => <Fila key={i.nombre} nombre={i.nombre} fuente={i.fuente} monto={i.monto} />)
            )}
          </BloqueResultado>

          <BloqueResultado titulo="Costos" color="red" total={datos.totalCostos} signo="-">
            <Fila nombre="CMV — mercadería propia vendida" fuente="Resumen de ventas" monto={datos.cmv} />
            <button
              onClick={() => setExpandido((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 border-t border-neutral-100 hover:bg-neutral-50 text-left"
            >
              <span className="text-sm text-neutral-800">
                <span className="text-neutral-400 mr-1.5">{expandido ? "▾" : "▸"}</span>
                Costos contables
                <span className="block text-[11px] text-neutral-400 ml-4">Impuestos y retenciones — tocá para ver el detalle</span>
              </span>
              <span className="text-sm font-medium tabular-nums text-neutral-800">-${formatearMonto(datos.totalCostosContablesDevengado)}</span>
            </button>
            {expandido && (
              <div className="bg-neutral-50">
                <div className="flex justify-end gap-4 px-4 pt-1.5 pb-0.5 text-[10px] font-bold uppercase text-neutral-400">
                  <span className="w-20 text-right">Devengado</span>
                  <span className="w-20 text-right">Pagado</span>
                </div>
                {datos.costosContables.map((c) => (
                  <div key={c.nombre} className="flex items-center justify-between px-4 py-1.5 pl-8 border-t border-neutral-100 text-xs">
                    <span className="text-neutral-600">{c.nombre}</span>
                    <span className="flex gap-4 tabular-nums">
                      <span className="w-20 text-right text-neutral-400">${formatearMonto(c.devengado)}</span>
                      <span className="w-20 text-right text-red-600 font-semibold">-${formatearMonto(c.pagado)}</span>
                    </span>
                  </div>
                ))}
                {datos.totalCostosContablesPagado !== datos.totalCostosContablesDevengado && (
                  <p className="text-[11px] text-neutral-500 px-4 py-2 border-t border-neutral-100">
                    Diferencia devengado vs. pagado: ${formatearMonto(Math.abs(datos.totalCostosContablesDevengado - datos.totalCostosContablesPagado))}
                    {datos.totalCostosContablesPagado < datos.totalCostosContablesDevengado ? " pendiente de pagar." : " pagado de más / adelantado."}
                  </p>
                )}
              </div>
            )}
          </BloqueResultado>

          <BloqueResultado titulo="Gastos" color="amber" total={datos.totalGastos} signo="-">
            {datos.gastos.length === 0 ? (
              <FilaVacia />
            ) : (
              datos.gastos.map((g) => <Fila key={g.nombre} nombre={g.nombre} fuente={g.fuente} monto={g.monto} />)
            )}
          </BloqueResultado>

          <div className="bg-accent rounded-2xl p-6 text-white mt-6">
            <p className="text-xs opacity-85 mb-2">
              Ingresos (${formatearMonto(datos.totalIngresos)}) − Costos (${formatearMonto(datos.totalCostos)}) − Gastos (${formatearMonto(datos.totalGastos)})
            </p>
            <p className="text-[11px] font-bold uppercase tracking-wide opacity-85">Resultado de {formatearPeriodo(periodo)}</p>
            <p className="text-3xl font-extrabold tracking-tight tabular-nums">${formatearMonto(datos.resultado)}</p>
          </div>
        </>
      )}
    </div>
  );
}

const COLOR_BLOQUE: Record<string, { bg: string; text: string }> = {
  emerald: { bg: "bg-emerald-50", text: "text-emerald-700" },
  red: { bg: "bg-red-50", text: "text-red-700" },
  amber: { bg: "bg-amber-50", text: "text-amber-700" },
};

function BloqueResultado({
  titulo,
  color,
  total,
  signo,
  children,
}: {
  titulo: string;
  color: keyof typeof COLOR_BLOQUE;
  total: number;
  signo: "+" | "-";
  children: ReactNode;
}) {
  const c = COLOR_BLOQUE[color];
  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden mb-3.5">
      <div className={`flex items-center justify-between px-4 py-3 ${c.bg}`}>
        <h2 className={`text-xs font-extrabold uppercase tracking-wide ${c.text}`}>{titulo}</h2>
        <span className={`text-base font-extrabold tabular-nums ${c.text}`}>
          {signo}${formatearMonto(total)}
        </span>
      </div>
      {children}
    </div>
  );
}

function Fila({ nombre, fuente, monto }: { nombre: string; fuente: string; monto: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-100 text-sm">
      <span>
        {nombre}
        <span className="block text-[11px] text-neutral-400">{fuente}</span>
      </span>
      <span className="tabular-nums font-medium">${formatearMonto(monto)}</span>
    </div>
  );
}

function FilaVacia() {
  return <p className="px-4 py-3 border-t border-neutral-100 text-xs text-neutral-400">Sin movimientos este mes.</p>;
}
