"use client";

import type { Liquidacion } from "@/lib/supabase";
import type { LineaRendicion } from "@/app/(app)/liquidaciones/actions";

type MarcaInfo = { nombre: string; cuit: string | null; contacto: string | null; email: string | null; telefono: string | null };
type Resumen = {
  ventaBruta: number;
  comisionWiigo: number;
  ivaComision: number;
  impCreditos: number;
  feeMp: number;
  netoARendir: number;
  netoEfectivo: number;
  netoTransferencia: number;
};

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearFecha(fechaISO: string) {
  return new Date(fechaISO).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ComprobanteLiquidacion({
  liquidacion,
  marca,
  lineas,
  resumen,
}: {
  liquidacion: Liquidacion;
  marca: MarcaInfo;
  lineas: LineaRendicion[];
  resumen: Resumen;
}) {
  return (
    <div className="max-w-3xl mx-auto">
      <style>{`
        @media print {
          header, .no-imprimir { display: none !important; }
          main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="no-imprimir flex justify-end mb-4">
        <button
          onClick={() => window.print()}
          className="bg-accent hover:bg-accent-dark text-white font-medium px-4 py-2 rounded-lg text-sm"
        >
          🖨️ Imprimir / Guardar como PDF
        </button>
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl p-8 print:border-0 print:p-0">
        <div className="flex items-start justify-between mb-6 pb-6 border-b border-neutral-200">
          <div>
            <h1 className="text-xl font-bold text-neutral-900">WiiGo</h1>
            <p className="text-sm text-neutral-500">Comprobante de Liquidación</p>
          </div>
          <div className="text-right text-sm text-neutral-500">
            <p>
              Período: {formatearFecha(liquidacion.periodo_desde)} – {formatearFecha(liquidacion.periodo_hasta)}
            </p>
            <p>Fecha de liquidación: {formatearFecha(liquidacion.fecha_liquidacion)}</p>
            {liquidacion.usuario && <p>Confirmado por: {liquidacion.usuario}</p>}
          </div>
        </div>

        <div className="mb-6">
          <p className="text-xs uppercase tracking-wide text-neutral-400 mb-1">Marca</p>
          <p className="font-semibold text-neutral-900">{marca.nombre}</p>
          <div className="text-sm text-neutral-500 flex flex-wrap gap-x-4">
            {marca.cuit && <span>CUIT {marca.cuit}</span>}
            {marca.contacto && <span>{marca.contacto}</span>}
            {marca.email && <span>{marca.email}</span>}
            {marca.telefono && <span>{marca.telefono}</span>}
          </div>
        </div>

        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-neutral-400 border-b border-neutral-300">
              <th className="py-2 pr-2">Fecha / Venta</th>
              <th className="py-2 pr-2">Producto</th>
              <th className="py-2 pr-2">Cant.</th>
              <th className="py-2 pr-2">Pago</th>
              <th className="py-2 pr-2 text-right">Bruta</th>
              <th className="py-2 pr-2 text-right">Comisión</th>
              <th className="py-2 pr-2 text-right">IVA</th>
              <th className="py-2 pr-2 text-right">Imp. créd.</th>
              <th className="py-2 pr-2 text-right">Fee MP</th>
              <th className="py-2 text-right">Neto</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.idDetalle} className="border-b border-neutral-100">
                <td className="py-1.5 pr-2 whitespace-nowrap text-neutral-500">
                  {formatearFecha(l.fecha)} · #{String(l.numeroVenta).padStart(4, "0")}
                </td>
                <td className="py-1.5 pr-2">{l.producto}</td>
                <td className="py-1.5 pr-2">{l.cantidad}</td>
                <td className="py-1.5 pr-2 text-neutral-500">
                  {l.medioPago === "MERCADO_PAGO" ? "Mercado Pago" : l.medioPago === "EFECTIVO" ? "Efectivo" : "—"}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">${formatearMonto(l.ventaBruta)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">-${formatearMonto(l.comisionWiigo)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{l.ivaComision > 0 ? `-$${formatearMonto(l.ivaComision)}` : "—"}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{l.impCreditos > 0 ? `-$${formatearMonto(l.impCreditos)}` : "—"}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{l.feeMp > 0 ? `-$${formatearMonto(l.feeMp)}` : "—"}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold">${formatearMonto(l.netoARendir)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 mb-8 text-sm">
          <div className="flex justify-between mb-1">
            <span className="text-neutral-500">Venta bruta total</span>
            <span>${formatearMonto(resumen.ventaBruta)}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-neutral-500">Comisión WiiGo + IVA</span>
            <span>-${formatearMonto(resumen.comisionWiigo + resumen.ivaComision)}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-neutral-500">Impuesto a los Créditos</span>
            <span>-${formatearMonto(resumen.impCreditos)}</span>
          </div>
          <div className="flex justify-between mb-3">
            <span className="text-neutral-500">Fee Mercado Pago</span>
            <span>-${formatearMonto(resumen.feeMp)}</span>
          </div>
          <div className="flex justify-between font-bold text-base border-t border-neutral-300 pt-2">
            <span>Efectivo entregado</span>
            <span>${formatearMonto(resumen.netoEfectivo)}</span>
          </div>
          <div className="flex justify-between font-bold text-base">
            <span>Transferido por banco</span>
            <span>${formatearMonto(resumen.netoTransferencia)}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-10 mt-16 text-sm">
          <div className="text-center">
            <div className="border-t border-neutral-400 pt-2">Entregado por (WiiGo)</div>
          </div>
          <div className="text-center">
            <div className="border-t border-neutral-400 pt-2">Recibido por ({marca.nombre})</div>
          </div>
        </div>
      </div>
    </div>
  );
}
