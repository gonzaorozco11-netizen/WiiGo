"use client";

import { useEffect, useState, useTransition } from "react";
import type { ProveedorConSaldo, LiquidacionSinFactura } from "@/app/(app)/proveedores/actions";
import { liquidacionesSinFactura, cargarFacturaLiquidacion } from "@/app/(app)/proveedores/actions";

// La factura del proveedor contra una liquidación ya generada.
//
// Es el paso que hace nacer el crédito fiscal: hasta que esta factura no se
// carga, el IVA de todo lo que se vendió de este proveedor no aparece en IVA
// a pagar. Antes no había dónde cargarla y se perdía entero.

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function fechaCorta(iso: string) {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function hoyISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

export default function FacturaLiquidacionModal({
  proveedor,
  onClose,
}: {
  proveedor: ProveedorConSaldo;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [cargando, setCargando] = useState(true);
  const [pendientes, setPendientes] = useState<LiquidacionSinFactura[]>([]);
  const [elegida, setElegida] = useState<LiquidacionSinFactura | null>(null);
  const [numero, setNumero] = useState("");
  const [neto, setNeto] = useState("");
  const [iva, setIva] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    liquidacionesSinFactura(proveedor.id_proveedor)
      .then((l) => {
        setPendientes(l);
        // Con una sola pendiente no tiene sentido hacer elegir: se abre esa.
        if (l.length === 1) elegir(l[0]);
      })
      .finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedor.id_proveedor]);

  function elegir(l: LiquidacionSinFactura) {
    setElegida(l);
    // El monto de la liquidación ya viene con IVA: se desarma para precargar
    // los dos campos, pero manda lo que diga la factura de papel.
    const total = l.montoFinal;
    const netoEstimado = Math.round((total / 1.21) * 100) / 100;
    setNeto(String(netoEstimado));
    setIva(String(Math.round((total - netoEstimado) * 100) / 100));
  }

  const totalFactura = (Number(neto) || 0) + (Number(iva) || 0);
  const diferencia = elegida ? totalFactura - elegida.montoFinal : 0;

  function handleSubmit() {
    if (!elegida) return;
    setError(null);
    setAviso(null);
    startTransition(async () => {
      const res = await cargarFacturaLiquidacion({
        idLiquidacion: elegida.idLiquidacion,
        numero,
        neto: Number(neto) || 0,
        iva: Number(iva) || 0,
        fecha,
      });
      if (res.error) setError(res.error);
      else if (res.aviso) setAviso(res.aviso);
      else onClose();
    });
  }

  const campo =
    "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-200 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-accent uppercase">WiiGo</p>
            <h2 className="text-xl font-semibold text-neutral-900">Cargar la factura</h2>
            <p className="text-xs text-neutral-400 mt-0.5">{proveedor.nombre} · genera el crédito fiscal</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {cargando ? (
            <p className="text-sm text-neutral-400 text-center py-6">Buscando liquidaciones…</p>
          ) : pendientes.length === 0 ? (
            <p className="text-sm text-neutral-500 text-center py-6 border border-dashed border-neutral-200 rounded-xl">
              Todas las liquidaciones de {proveedor.nombre} ya tienen su factura cargada.
            </p>
          ) : (
            <>
              {pendientes.length > 1 && (
                <div>
                  <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">
                    ¿De qué liquidación es la factura?
                  </label>
                  <div className="space-y-1.5">
                    {pendientes.map((l) => (
                      <button
                        key={l.idLiquidacion}
                        onClick={() => elegir(l)}
                        className={`w-full text-left border rounded-lg px-3 py-2.5 flex justify-between gap-3 ${
                          elegida?.idLiquidacion === l.idLiquidacion
                            ? "border-accent bg-accent-tint"
                            : "border-neutral-200 hover:border-neutral-300"
                        }`}
                      >
                        <span className="text-sm">
                          Del {fechaCorta(l.fechaDesde)} al {fechaCorta(l.fechaHasta)}
                        </span>
                        <span className="text-sm font-semibold tabular-nums">${formatearMonto(l.montoFinal)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {elegida && (
                <>
                  <div className="bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2.5 text-sm">
                    <span className="text-neutral-500">La liquidación calculó </span>
                    <b className="tabular-nums">${formatearMonto(elegida.montoFinal)}</b>
                    <span className="text-neutral-500">
                      {" "}
                      · del {fechaCorta(elegida.fechaDesde)} al {fechaCorta(elegida.fechaHasta)}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">
                      Número de factura
                    </label>
                    <input
                      value={numero}
                      onChange={(e) => setNumero(e.target.value)}
                      placeholder="A 0003-00014287"
                      className={campo}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Neto</label>
                      <input type="number" min={0} value={neto} onChange={(e) => setNeto(e.target.value)} className={campo} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">IVA</label>
                      <input type="number" min={0} value={iva} onChange={(e) => setIva(e.target.value)} className={campo} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Total</label>
                      <input value={formatearMonto(totalFactura)} disabled className={`${campo} bg-neutral-50`} />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">
                      Fecha de la factura
                    </label>
                    <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={campo} />
                    <p className="text-xs text-neutral-400 mt-1">
                      El crédito fiscal se computa en el período de esta fecha, no en el de la venta.
                    </p>
                  </div>

                  {Math.abs(diferencia) >= 1 && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      La factura da ${formatearMonto(totalFactura)} y la liquidación calculó $
                      {formatearMonto(elegida.montoFinal)}. Hay {diferencia > 0 ? "de más" : "de menos"} $
                      {formatearMonto(Math.abs(diferencia))}. Se puede cargar igual — manda lo que dice la factura —
                      pero conviene revisarlo con el proveedor.
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">
              {error}
            </p>
          )}
          {aviso && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{aviso}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
            >
              {aviso ? "Listo" : "Cancelar"}
            </button>
            {!aviso && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isPending || !elegida || !numero.trim()}
                className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
              >
                {isPending ? "Guardando…" : "Cargar factura"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
