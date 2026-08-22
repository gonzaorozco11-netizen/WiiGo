"use client";

import { useEffect, useState } from "react";
import { resumenFinanciero } from "@/app/(app)/dashboard/actions";

type Resumen = Awaited<ReturnType<typeof resumenFinanciero>>;

function formatearMonto(valor: number) {
  return Math.round(valor).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearPorcentaje(valor: number) {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

type Periodo = "HOY" | "SEMANA" | "MES" | "PERSONALIZADO";

function rangoPeriodo(periodo: Periodo, desdePersonalizado: string, hastaPersonalizado: string) {
  const hoy = new Date();
  const hastaISO = hoyISO();
  if (periodo === "HOY") return { desde: hastaISO, hasta: hastaISO };
  if (periodo === "SEMANA") {
    const desde = new Date(hoy);
    desde.setDate(desde.getDate() - 6);
    return { desde: desde.toISOString().slice(0, 10), hasta: hastaISO };
  }
  if (periodo === "MES") {
    const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    return { desde: desde.toISOString().slice(0, 10), hasta: hastaISO };
  }
  return { desde: desdePersonalizado || hastaISO, hasta: hastaPersonalizado || hastaISO };
}

export default function DashboardFinancieroApp() {
  const [periodo, setPeriodo] = useState<Periodo>("MES");
  const [desdePersonalizado, setDesdePersonalizado] = useState(hoyISO());
  const [hastaPersonalizado, setHastaPersonalizado] = useState(hoyISO());
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);

  const { desde, hasta } = rangoPeriodo(periodo, desdePersonalizado, hastaPersonalizado);

  useEffect(() => {
    setCargando(true);
    resumenFinanciero(desde, hasta)
      .then(setResumen)
      .finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Dashboard financiero</h1>
      <p className="text-sm text-neutral-500 mb-4 max-w-2xl">
        Cinco números, no uno solo — para no confundir "vendimos mucho" con "tenemos esa plata disponible".
      </p>

      <div className="inline-flex gap-1 bg-white border border-neutral-200 rounded-lg p-1 mb-5">
        {(
          [
            ["HOY", "Hoy"],
            ["SEMANA", "Últimos 7 días"],
            ["MES", "Este mes"],
            ["PERSONALIZADO", "Personalizado"],
          ] as [Periodo, string][]
        ).map(([valor, etiqueta]) => (
          <button
            key={valor}
            onClick={() => setPeriodo(valor)}
            className={`text-xs font-bold px-3 py-1.5 rounded-md ${
              periodo === valor ? "bg-accent text-white" : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {periodo === "PERSONALIZADO" && (
        <div className="flex items-end gap-3 mb-5">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Desde</label>
            <input
              type="date"
              value={desdePersonalizado}
              onChange={(e) => setDesdePersonalizado(e.target.value)}
              className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Hasta</label>
            <input
              type="date"
              value={hastaPersonalizado}
              onChange={(e) => setHastaPersonalizado(e.target.value)}
              className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm"
            />
          </div>
        </div>
      )}

      {cargando || !resumen ? (
        <p className="text-sm text-neutral-400 text-center py-12">Cargando...</p>
      ) : (
        <>
          {/* Venta */}
          <Kpi
            nombre="Venta"
            explicacion="Todo lo que se vendió en el período — marca propia + marcas en consignación, bruto."
            valor={resumen.venta}
          />

          {/* Ingreso real + desglose */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-3.5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-extrabold text-neutral-900">Ingreso real</p>
                <p className="text-[11px] text-neutral-500 max-w-md">Lo que de esa venta le queda a WiiGo — no la venta total, solo tu parte.</p>
              </div>
              <span className="text-xl font-extrabold text-emerald-700 tabular-nums">${formatearMonto(resumen.ingresoReal)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <SubCard
                etiqueta="Marca propia"
                valor={resumen.ingresoPorOrigen.margenPropia}
                nota="margen WiiGo Dietética"
                total={resumen.ingresoReal}
              />
              <SubCard
                etiqueta="Royalty de marcas"
                valor={resumen.ingresoPorOrigen.royalty}
                nota="comisión consignación"
                total={resumen.ingresoReal}
              />
              <SubCard
                etiqueta="Otros ingresos"
                valor={resumen.ingresoPorOrigen.otrosIngresos}
                nota="fees + gasto fijo"
                total={resumen.ingresoReal}
              />
            </div>
          </div>

          {/* Gastos */}
          <Kpi
            nombre="Gastos del período"
            explicacion="Alquiler, sueldos, servicios e impuestos — todo lo que sale de la caja para operar."
            valor={-resumen.gastos.total}
            tono="rojo"
          />

          {/* Rentabilidad */}
          <Kpi
            nombre="Rentabilidad"
            explicacion="Ingreso real menos los gastos del período — la ganancia real del negocio."
            valor={resumen.rentabilidad}
            tono="indigo"
            porcentaje={`${formatearPorcentaje(resumen.rentabilidadPorcentaje)}% sobre venta`}
          />

          <div className="flex items-center gap-3 my-4 text-[10px] font-bold uppercase tracking-wide text-neutral-400">
            <span className="flex-1 h-px bg-neutral-200" />
            Plata física, no números en papel
            <span className="flex-1 h-px bg-neutral-200" />
          </div>

          {/* Caja */}
          <Kpi
            nombre="Caja"
            explicacion="Cobrado (ya descontada la comisión de Mercado Pago) menos los gastos pagados en el período."
            valor={resumen.caja}
            tono="ambar"
          />

          {/* Disponible real */}
          <Kpi
            nombre="Disponible real"
            explicacion='La respuesta a "¿cuánto de la caja es mío para usar?" — descontando lo que hay que devolver.'
            valor={resumen.disponibleReal}
            tono="teal"
            grande
          />

          {/* Cómo se arma el disponible */}
          <div className="bg-white border border-neutral-200 rounded-xl p-4 mt-2 mb-5">
            <h2 className="text-sm font-bold text-neutral-900 mb-1">Cómo se arma el "Disponible real"</h2>
            <p className="text-[11px] text-neutral-400 mb-3">
              Nunca es un número mágico — sale de sumar y restar estas cuentas reales, todas las marcas juntas (situación actual, no del período elegido).
            </p>
            <div className="text-sm divide-y divide-dashed divide-neutral-200">
              <Fila etiqueta="Caja del período" valor={resumen.caja} />
              <Fila etiqueta="− Liquidaciones pendientes de todas las marcas" valor={-resumen.situacion.liquidaciones} />
              <Fila etiqueta="− Retenciones pendientes de devolver" valor={-resumen.situacion.retenciones} />
              <Fila etiqueta="+ Lo que las marcas te deben (cuenta comercial)" valor={resumen.situacion.comercial} />
              <Fila etiqueta="Disponible real" valor={resumen.disponibleReal} fuerte />
            </div>
          </div>

          {/* Gastos por categoría */}
          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <h2 className="text-sm font-bold text-neutral-900 mb-3">Gastos del período — por categoría</h2>
            {resumen.gastos.porCategoria.length === 0 ? (
              <p className="text-xs text-neutral-400">No hay gastos cargados en este período.</p>
            ) : (
              <div className="text-sm divide-y divide-dashed divide-neutral-200">
                {resumen.gastos.porCategoria.map((c) => (
                  <div key={c.idCategoria} className="flex justify-between py-1.5">
                    <span className="text-neutral-500">{c.nombre}</span>
                    <span className="text-right">
                      <span className="font-semibold tabular-nums">${formatearMonto(c.gastado)}</span>
                      <span className="block text-[10px] text-neutral-400">{formatearPorcentaje(c.pct)}% de los gastos</span>
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 font-bold">
                  <span>Total gastos del período</span>
                  <span className="tabular-nums text-red-600">-${formatearMonto(resumen.gastos.total)}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  nombre,
  explicacion,
  valor,
  tono = "neutro",
  porcentaje,
  grande,
}: {
  nombre: string;
  explicacion: string;
  valor: number;
  tono?: "neutro" | "rojo" | "indigo" | "ambar" | "teal";
  porcentaje?: string;
  grande?: boolean;
}) {
  const estilos: Record<string, string> = {
    neutro: "bg-white border-neutral-200 text-neutral-900",
    rojo: "bg-red-50 border-red-200 text-red-600",
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-600",
    ambar: "bg-amber-50 border-amber-200 text-amber-700",
    teal: "bg-teal-50 border-teal-300 text-teal-700",
  };
  return (
    <div className={`border rounded-xl p-4 mb-3.5 flex items-center justify-between gap-4 ${estilos[tono]} ${grande ? "border-2" : ""}`}>
      <div>
        <p className="text-sm font-extrabold">{nombre}</p>
        <p className="text-[11px] text-neutral-500 max-w-md">{explicacion}</p>
      </div>
      <div className="text-right shrink-0">
        <span className={`font-extrabold tabular-nums ${grande ? "text-2xl" : "text-xl"}`}>
          {valor < 0 ? "-" : ""}${formatearMonto(Math.abs(valor))}
        </span>
        {porcentaje && <span className="block text-[11px] font-bold opacity-75">{porcentaje}</span>}
      </div>
    </div>
  );
}

function SubCard({ etiqueta, valor, nota, total }: { etiqueta: string; valor: number; nota: string; total: number }) {
  const pct = total > 0 ? (valor / total) * 100 : 0;
  return (
    <div className="bg-white border border-emerald-200 rounded-lg p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-1">{etiqueta}</p>
      <p className="text-sm font-extrabold text-neutral-900 tabular-nums">${formatearMonto(valor)}</p>
      <p className="text-[10px] text-neutral-400 mt-0.5">
        {formatearPorcentaje(pct)}% · {nota}
      </p>
    </div>
  );
}

function Fila({ etiqueta, valor, fuerte }: { etiqueta: string; valor: number; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between py-1.5 ${fuerte ? "font-bold pt-2.5" : ""}`}>
      <span className={fuerte ? "" : "text-neutral-500"}>{etiqueta}</span>
      <span className={`tabular-nums ${valor < 0 ? "text-red-600" : fuerte ? "" : ""}`}>
        {valor < 0 ? "-" : valor > 0 && !fuerte ? "+" : ""}${formatearMonto(Math.abs(valor))}
      </span>
    </div>
  );
}
