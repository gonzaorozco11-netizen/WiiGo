"use client";

import { useEffect, useState } from "react";
import { calcularIvaAPagar, type IvaAPagar } from "@/app/(app)/contabilidad/actions";

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

export default function IvaAPagarApp() {
  const [periodo, setPeriodo] = useState(mesActualISO());
  const [datos, setDatos] = useState<IvaAPagar | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    calcularIvaAPagar(periodo)
      .then(setDatos)
      .finally(() => setCargando(false));
  }, [periodo]);

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <h1 className="text-lg font-semibold text-neutral-900">IVA a pagar</h1>
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
        IVA Débito (lo que cobrás) menos IVA Crédito (lo que te devuelven en tus compras) = lo que corresponde
        ingresarle a AFIP este período. Se arma solo con lo mismo que ya calculan Rentabilidad, Liquidaciones, Gastos
        y Gastos e Ingresos.
      </p>

      {cargando || !datos ? (
        <p className="text-sm text-neutral-400 text-center py-12">Calculando...</p>
      ) : (
        <>
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden mb-3.5">
            <div className="flex items-center justify-between px-4 py-3 bg-red-50">
              <h2 className="text-xs font-extrabold uppercase tracking-wide text-red-700">IVA Débito — lo que cobrás</h2>
              <span className="text-base font-extrabold tabular-nums text-red-700">${formatearMonto(datos.totalDebito)}</span>
            </div>
            {datos.debito.length === 0 ? (
              <p className="px-4 py-3 text-xs text-neutral-400">Sin movimientos con IVA este mes.</p>
            ) : (
              datos.debito.map((i) => (
                <div key={i.nombre} className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-100 text-sm">
                  <span>
                    {i.nombre}
                    <span className="block text-[11px] text-neutral-400">{i.fuente}</span>
                  </span>
                  <span className="tabular-nums font-medium">${formatearMonto(i.monto)}</span>
                </div>
              ))
            )}
          </div>

          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden mb-3.5">
            <div className="flex items-center justify-between px-4 py-3 bg-emerald-50">
              <h2 className="text-xs font-extrabold uppercase tracking-wide text-emerald-700">IVA Crédito — lo que te devuelven</h2>
              <span className="text-base font-extrabold tabular-nums text-emerald-700">${formatearMonto(datos.totalCredito)}</span>
            </div>
            {datos.credito.length === 0 ? (
              <p className="px-4 py-3 text-xs text-neutral-400">Sin compras con IVA este mes.</p>
            ) : (
              datos.credito.map((i) => (
                <div key={i.nombre} className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-100 text-sm">
                  <span>
                    {i.nombre}
                    <span className="block text-[11px] text-neutral-400">{i.fuente}</span>
                  </span>
                  <span className="tabular-nums font-medium">${formatearMonto(i.monto)}</span>
                </div>
              ))
            )}
          </div>

          <div className="bg-accent rounded-2xl p-6 text-white mt-6">
            <p className="text-xs opacity-85 mb-2">
              Débito (${formatearMonto(datos.totalDebito)}) − Crédito (${formatearMonto(datos.totalCredito)})
            </p>
            <p className="text-[11px] font-bold uppercase tracking-wide opacity-85">IVA a pagar de {formatearPeriodo(periodo)}</p>
            <p className="text-3xl font-extrabold tracking-tight tabular-nums">${formatearMonto(datos.ivaAPagar)}</p>
          </div>

          <p className="text-xs text-neutral-400 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2.5 mt-4">
            ℹ Este número solo va a ser exacto para las facturas donde hayas tildado "Esta factura discrimina IVA" al
            cargarla (en Gastos y en Proveedores) — las que se cargaron antes de hoy, o sin tildar ese check, no
            suman acá.
          </p>
        </>
      )}
    </div>
  );
}
