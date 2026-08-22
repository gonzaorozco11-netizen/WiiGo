"use client";

import { useEffect, useState } from "react";
import type { Marca, Local } from "@/lib/supabase";
import {
  resumenVentasMarca,
  condicionComercialVigente,
  guardarCondicionComercial,
  generarCargoMensual,
  listarFeesIngreso,
  registrarFeeIngreso,
  marcarFeePagado,
  registrarPagoComercial,
  saldoComercialAction,
  historialComercialAction,
  saldosCuentasAction,
  historialCompensacionesAction,
  registrarCompensacionAction,
} from "@/app/(app)/situacion-marca/actions";
import { calcularRendicion, historialLiquidaciones } from "@/app/(app)/liquidaciones/actions";
import { disponibleRealActual } from "@/app/(app)/dashboard/actions";
import { RetencionesMarca } from "@/components/LiquidacionesApp";

function formatearMonto(valor: number) {
  return Math.round(valor).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function formatearFecha(fechaISO: string) {
  const fecha = fechaISO.includes("T") ? new Date(fechaISO) : new Date(`${fechaISO}T00:00:00`);
  return fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const ETIQUETA_TIPO_CARGO: Record<string, string> = {
  FEE_INGRESO: "Fee de ingreso",
  GASTO_FIJO_MENSUAL: "Gasto fijo mensual",
  OTRO_CARGO: "Otro cargo",
  PAGO: "Pago",
  AJUSTE: "Ajuste",
};

export default function SituacionMarcaApp({ marcas, locales }: { marcas: Marca[]; locales: Local[] }) {
  const [idMarca, setIdMarca] = useState(marcas[0]?.id_marca ?? "");
  const marca = marcas.find((m) => m.id_marca === idMarca) ?? null;

  const [cargando, setCargando] = useState(true);
  const [ventas, setVentas] = useState({ esteMes: 0, historico: 0 });
  const [pendienteLiquidar, setPendienteLiquidar] = useState(0);
  const [liquidacionesHist, setLiquidacionesHist] = useState<{ pagado: number; pendiente: number }>({ pagado: 0, pendiente: 0 });
  const [saldoComercial, setSaldoComercial] = useState(0);
  const [saldoRetenciones, setSaldoRetenciones] = useState(0);
  const [saldoLiquidacionesReal, setSaldoLiquidacionesReal] = useState(0);
  const [disponibleReal, setDisponibleReal] = useState<number | null>(null);

  useEffect(() => {
    disponibleRealActual().then(setDisponibleReal);
  }, []);

  function recargarResumen() {
    if (!idMarca) return;
    setCargando(true);
    Promise.all([
      resumenVentasMarca(idMarca),
      calcularRendicion(idMarca, "2000-01-01", new Date().toISOString().slice(0, 10)),
      historialLiquidaciones(idMarca),
      saldoComercialAction(idMarca),
      saldosCuentasAction(idMarca),
    ])
      .then(([v, rendicion, historial, saldoCom, saldosReales]) => {
        setVentas(v);
        setPendienteLiquidar(rendicion.resumen.netoARendir);
        let pagado = 0;
        let pendiente = 0;
        for (const l of historial) {
          if (l.comprobante_path) pagado += l.neto_a_transferir ?? 0;
          else pendiente += l.neto_a_transferir ?? 0;
        }
        setLiquidacionesHist({ pagado, pendiente });
        setSaldoComercial(saldoCom);
        setSaldoLiquidacionesReal(saldosReales.liquidaciones);
      })
      .finally(() => setCargando(false));
  }

  // Lo compensado contra Liquidaciones no tiene un ledger propio — se ve acá
  // como la diferencia entre el pendiente "bruto" y el saldo real ya
  // descontada la compensación (saldosCuentasAction).
  const compensadoLiquidaciones = Math.max(pendienteLiquidar + liquidacionesHist.pendiente - saldoLiquidacionesReal, 0);

  useEffect(recargarResumen, [idMarca]);

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Situación con WiiGo</h1>
      <p className="text-sm text-neutral-500 mb-5 max-w-2xl">
        Toda la relación económica con una marca, en un solo lugar — ventas, lo que WiiGo le debe, lo que la marca le
        debe a WiiGo, y las retenciones pendientes. Cada cuenta por separado, nunca mezcladas en un solo número.
      </p>

      <div className="mb-5">
        <label className="block text-xs font-medium text-neutral-500 mb-1">Marca</label>
        <select
          value={idMarca}
          onChange={(e) => setIdMarca(e.target.value)}
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white font-semibold"
        >
          {marcas.map((m) => (
            <option key={m.id_marca} value={m.id_marca}>
              {m.nombre}
            </option>
          ))}
        </select>
      </div>

      {cargando ? (
        <p className="text-sm text-neutral-400 text-center py-12">Cargando...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3.5 mb-5">
            <div className="bg-white border border-neutral-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">Ventas este mes</p>
              <p className="text-xl font-extrabold text-neutral-900 tabular-nums">${formatearMonto(ventas.esteMes)}</p>
            </div>
            <div className="bg-white border border-neutral-200 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">Ventas históricas</p>
              <p className="text-xl font-extrabold text-neutral-900 tabular-nums">${formatearMonto(ventas.historico)}</p>
            </div>
          </div>

          {/* Cuenta de liquidaciones */}
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden mb-3.5">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
              <div>
                <h2 className="text-sm font-bold text-neutral-900">💰 Cuenta de liquidaciones</h2>
                <p className="text-[11px] text-neutral-400">Plata que WiiGo le debe transferir a la marca por sus ventas</p>
              </div>
              <span className="text-lg font-extrabold text-accent tabular-nums">${formatearMonto(saldoLiquidacionesReal)}</span>
            </div>
            <div className="px-4 py-3 space-y-2 text-sm">
              <div className="flex justify-between border-b border-neutral-100 pb-2">
                <span className="text-neutral-500">Pendiente de liquidar (ventas sin cerrar todavía)</span>
                <span className="font-semibold tabular-nums">${formatearMonto(pendienteLiquidar)}</span>
              </div>
              <div className="flex justify-between border-b border-neutral-100 pb-2">
                <span className="text-neutral-500">Liquidado y pagado (con comprobante subido)</span>
                <span className="font-semibold tabular-nums text-emerald-600">${formatearMonto(liquidacionesHist.pagado)}</span>
              </div>
              <div className="flex justify-between border-b border-neutral-100 pb-2">
                <span className="text-neutral-500">Liquidado, pendiente de pago (sin comprobante)</span>
                <span className="font-semibold tabular-nums text-red-600">${formatearMonto(liquidacionesHist.pendiente)}</span>
              </div>
              {compensadoLiquidaciones > 0 && (
                <div className="flex justify-between">
                  <span className="text-neutral-500">Compensado contra otras cuentas</span>
                  <span className="font-semibold tabular-nums text-teal-600">-${formatearMonto(compensadoLiquidaciones)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Alerta de capital de trabajo (Fase 6) */}
          {disponibleReal !== null && saldoLiquidacionesReal > 0 && (
            <AlertaCapitalTrabajo
              nombreMarca={marca?.nombre ?? "esta marca"}
              pendienteMarca={saldoLiquidacionesReal}
              disponibleReal={disponibleReal}
            />
          )}

          {/* Cuenta comercial */}
          <CuentaComercial idMarca={idMarca} locales={locales} saldo={saldoComercial} onCambio={recargarResumen} />

          {/* Cuenta de retenciones (Fase 1) */}
          <RetencionesMarca idMarca={idMarca} />

          {/* Compensación entre cuentas (Fase 4) */}
          <CompensacionCuentas
            idMarca={idMarca}
            saldos={{ liquidaciones: saldoLiquidacionesReal, comercial: saldoComercial, retenciones: saldoRetenciones }}
            onCambio={recargarResumen}
          />

          {/* Resumen neto */}
          <div className="bg-white border-2 border-neutral-200 rounded-xl p-4 mt-2">
            <h2 className="text-sm font-bold text-neutral-900 mb-1">Situación neta (informativo)</h2>
            <p className="text-[11px] text-neutral-400 mb-3">
              Esto es solo un resumen para tener una idea rápida — las cuentas de arriba son las que mandan, nunca se
              pisan entre sí.
            </p>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between border-b border-dashed border-neutral-200 py-1.5">
                <span>
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-accent mr-2" />
                  WiiGo le debe a {marca?.nombre ?? "la marca"} (liquidaciones)
                </span>
                <span className="font-bold tabular-nums">${formatearMonto(saldoLiquidacionesReal)}</span>
              </div>
              <div className="flex justify-between border-b border-dashed border-neutral-200 py-1.5">
                <span>
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-700 mr-2" />
                  {marca?.nombre ?? "La marca"} le debe a WiiGo (comercial)
                </span>
                <span className="font-bold tabular-nums">${formatearMonto(saldoComercial)}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span>
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-purple-600 mr-2" />
                  Retenciones pendientes de compensar
                </span>
                <span className="font-bold tabular-nums">${formatearMonto(saldoRetenciones)}</span>
              </div>
            </div>
          </div>
          {/* Truco simple: la cuenta de retenciones ya trae su propio saldo — lo
              reflejamos acá también consultándolo una vez más, liviano. */}
          <SaldoRetencionesSync idMarca={idMarca} onSaldo={setSaldoRetenciones} />
        </>
      )}
    </div>
  );
}

// Componente invisible: solo trae el total de retenciones para el resumen
// neto de abajo, sin duplicar la lógica visual de RetencionesMarca.
function SaldoRetencionesSync({ idMarca, onSaldo }: { idMarca: string; onSaldo: (v: number) => void }) {
  useEffect(() => {
    import("@/app/(app)/liquidaciones/actions").then(({ saldosRetencionMarcaAction }) => {
      saldosRetencionMarcaAction(idMarca).then((saldos) => {
        onSaldo(saldos.reduce((acc, s) => acc + s.saldo, 0));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idMarca]);
  return null;
}

function CuentaComercial({
  idMarca,
  locales,
  saldo,
  onCambio,
}: {
  idMarca: string;
  locales: Local[];
  saldo: number;
  onCambio: () => void;
}) {
  const [condicion, setCondicion] = useState<{
    id_condicion: string;
    id_local: string | null;
    metros_ocupados: number | null;
    valor_por_m2: number | null;
    monto_mensual: number;
  } | null>(null);
  const [fees, setFees] = useState<{ id_fee: string; monto: number; estado: string; fecha_creacion: string; observaciones: string | null }[]>([]);
  const [historial, setHistorial] = useState<
    { idMovimiento: string; tipoCargo: string; importe: number; saldoNuevo: number; periodo: string | null; observaciones: string | null; fecha: string }[]
  >([]);
  const [mostrarHistorial, setMostrarHistorial] = useState(false);
  const [mostrarCondicionForm, setMostrarCondicionForm] = useState(false);
  const [mostrarFeeForm, setMostrarFeeForm] = useState(false);
  const [mostrarPagoForm, setMostrarPagoForm] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function recargar() {
    Promise.all([condicionComercialVigente(idMarca), listarFeesIngreso(idMarca), historialComercialAction(idMarca)]).then(
      ([c, f, h]) => {
        setCondicion(c);
        setFees(f as typeof fees);
        setHistorial(h);
      }
    );
  }

  useEffect(recargar, [idMarca]);

  function handleGenerarCargo() {
    setError(null);
    setGuardando(true);
    generarCargoMensual(idMarca)
      .then((res) => {
        if (res.error) setError(res.error);
        else {
          recargar();
          onCambio();
        }
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden mb-3.5">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
        <div>
          <h2 className="text-sm font-bold text-neutral-900">🏬 Cuenta comercial</h2>
          <p className="text-[11px] text-neutral-400">Lo que la marca le debe a WiiGo (fee, gasto fijo, otros cargos)</p>
        </div>
        <span className="text-lg font-extrabold text-amber-700 tabular-nums">${formatearMonto(saldo)}</span>
      </div>

      <div className="px-4 py-3">
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}

        {/* Condición comercial vigente (gasto fijo mensual) */}
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-bold text-neutral-700">Gasto fijo mensual</p>
            <button onClick={() => setMostrarCondicionForm((v) => !v)} className="text-xs font-semibold text-accent">
              {mostrarCondicionForm ? "Cancelar" : condicion ? "Cambiar condición" : "+ Configurar"}
            </button>
          </div>
          {condicion ? (
            <p className="text-sm text-neutral-800">
              ${formatearMonto(condicion.monto_mensual)} / mes
              {condicion.metros_ocupados ? ` — ${condicion.metros_ocupados} m² × $${condicion.valor_por_m2}` : ""}
            </p>
          ) : (
            <p className="text-xs text-neutral-400">Sin condición comercial configurada todavía.</p>
          )}
          {mostrarCondicionForm && (
            <CondicionComercialForm
              idMarca={idMarca}
              locales={locales}
              condicion={condicion}
              onGuardado={() => {
                setMostrarCondicionForm(false);
                recargar();
              }}
            />
          )}
          {condicion && (
            <button
              onClick={handleGenerarCargo}
              disabled={guardando}
              className="mt-2 text-xs font-bold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-40 px-3 py-1.5 rounded-lg"
            >
              {guardando ? "..." : "Generar cargo de este mes"}
            </button>
          )}
        </div>

        {/* Fees de ingreso */}
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-bold text-neutral-700">Fees de ingreso</p>
            <button onClick={() => setMostrarFeeForm((v) => !v)} className="text-xs font-semibold text-accent">
              {mostrarFeeForm ? "Cancelar" : "+ Registrar fee"}
            </button>
          </div>
          {fees.length === 0 ? (
            <p className="text-xs text-neutral-400">Todavía no se registró ningún fee de ingreso.</p>
          ) : (
            <div className="space-y-1.5">
              {fees.map((f) => (
                <FeeRow key={f.id_fee} fee={f} idMarca={idMarca} onCambio={() => { recargar(); onCambio(); }} />
              ))}
            </div>
          )}
          {mostrarFeeForm && (
            <FeeIngresoForm
              idMarca={idMarca}
              locales={locales}
              onGuardado={() => {
                setMostrarFeeForm(false);
                recargar();
                onCambio();
              }}
            />
          )}
        </div>

        {/* Pago / cargo manual */}
        <div className="mb-3">
          <button onClick={() => setMostrarPagoForm((v) => !v)} className="text-xs font-semibold text-accent">
            {mostrarPagoForm ? "Cancelar" : "+ Registrar pago o cargo manual"}
          </button>
          {mostrarPagoForm && (
            <PagoManualForm
              idMarca={idMarca}
              onGuardado={() => {
                setMostrarPagoForm(false);
                recargar();
                onCambio();
              }}
            />
          )}
        </div>

        <button onClick={() => setMostrarHistorial((v) => !v)} className="text-xs font-semibold text-accent">
          {mostrarHistorial ? "▾" : "▸"} Historial de movimientos ({historial.length})
        </button>
        {mostrarHistorial && (
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-neutral-400 border-b border-neutral-200">
                  <th className="p-2">Fecha</th>
                  <th className="p-2">Tipo</th>
                  <th className="p-2 text-right">Importe</th>
                  <th className="p-2 text-right">Saldo</th>
                  <th className="p-2">Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((m) => (
                  <tr key={m.idMovimiento} className="border-b border-neutral-100 last:border-0">
                    <td className="p-2 whitespace-nowrap text-neutral-500">{formatearFecha(m.fecha)}</td>
                    <td className="p-2">{ETIQUETA_TIPO_CARGO[m.tipoCargo] ?? m.tipoCargo}</td>
                    <td className={`p-2 text-right tabular-nums font-semibold ${m.importe >= 0 ? "text-amber-700" : "text-emerald-600"}`}>
                      {m.importe >= 0 ? "+" : ""}${formatearMonto(m.importe)}
                    </td>
                    <td className="p-2 text-right tabular-nums">${formatearMonto(m.saldoNuevo)}</td>
                    <td className="p-2 text-neutral-400">{m.observaciones ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CondicionComercialForm({
  idMarca,
  locales,
  condicion,
  onGuardado,
}: {
  idMarca: string;
  locales: Local[];
  condicion: { id_local: string | null; metros_ocupados: number | null; valor_por_m2: number | null; monto_mensual: number } | null;
  onGuardado: () => void;
}) {
  const [modo, setModo] = useState<"directo" | "m2">(condicion?.metros_ocupados ? "m2" : "directo");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    guardarCondicionComercial(idMarca, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else onGuardado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 pt-2 border-t border-neutral-200 space-y-2">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div>
        <label className="block text-[11px] text-neutral-500 mb-1">Local (opcional)</label>
        <select name="id_local" defaultValue={condicion?.id_local ?? ""} className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs">
          <option value="">Sin local específico</option>
          {locales.map((l) => (
            <option key={l.id_local} value={l.id_local}>{l.nombre}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 text-xs">
        <button type="button" onClick={() => setModo("directo")} className={`flex-1 py-1.5 rounded-lg border font-bold ${modo === "directo" ? "border-accent bg-accent-tint text-accent-dark" : "border-neutral-300 text-neutral-500"}`}>
          Monto fijo
        </button>
        <button type="button" onClick={() => setModo("m2")} className={`flex-1 py-1.5 rounded-lg border font-bold ${modo === "m2" ? "border-accent bg-accent-tint text-accent-dark" : "border-neutral-300 text-neutral-500"}`}>
          Metros × valor m²
        </button>
      </div>
      {modo === "directo" ? (
        <div>
          <label className="block text-[11px] text-neutral-500 mb-1">Monto mensual</label>
          <input name="monto_mensual" type="number" step="1" defaultValue={condicion?.monto_mensual ?? ""} className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-neutral-500 mb-1">Metros ocupados</label>
            <input name="metros_ocupados" type="number" step="0.1" defaultValue={condicion?.metros_ocupados ?? ""} className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
          </div>
          <div>
            <label className="block text-[11px] text-neutral-500 mb-1">Valor por m²</label>
            <input name="valor_por_m2" type="number" step="1" defaultValue={condicion?.valor_por_m2 ?? ""} className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
          </div>
        </div>
      )}
      <div>
        <label className="block text-[11px] text-neutral-500 mb-1">Observaciones</label>
        <input name="observaciones" className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
      </div>
      <button type="submit" disabled={guardando} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg">
        {guardando ? "Guardando..." : "Guardar condición"}
      </button>
      <p className="text-[10px] text-neutral-400">
        Al guardar, la condición anterior queda cerrada con fecha de hoy — los cargos ya generados conservan el monto que tenían en su momento.
      </p>
    </form>
  );
}

function FeeIngresoForm({ idMarca, locales, onGuardado }: { idMarca: string; locales: Local[]; onGuardado: () => void }) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    registrarFeeIngreso(idMarca, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else onGuardado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 pt-2 border-t border-neutral-200 space-y-2">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-neutral-500 mb-1">Monto</label>
          <input name="monto" type="number" step="1" required className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
        </div>
        <div>
          <label className="block text-[11px] text-neutral-500 mb-1">Local (opcional)</label>
          <select name="id_local" className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Sin local específico</option>
            {locales.map((l) => (
              <option key={l.id_local} value={l.id_local}>{l.nombre}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-[11px] text-neutral-500 mb-1">Observaciones</label>
        <input name="observaciones" placeholder="Ej: fee de ingreso Sucursal 1" className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
      </div>
      <button type="submit" disabled={guardando} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg">
        {guardando ? "Guardando..." : "Registrar fee"}
      </button>
    </form>
  );
}

function FeeRow({
  fee,
  idMarca,
  onCambio,
}: {
  fee: { id_fee: string; monto: number; estado: string; fecha_creacion: string; observaciones: string | null };
  idMarca: string;
  onCambio: () => void;
}) {
  const [guardando, setGuardando] = useState(false);

  function handlePagar() {
    setGuardando(true);
    marcarFeePagado(fee.id_fee, idMarca, new FormData())
      .then((res) => {
        if (res.error) alert(res.error);
        else onCambio();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="flex items-center justify-between bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs">
      <div>
        <span className="font-semibold">${formatearMonto(fee.monto)}</span>
        <span className="text-neutral-400 ml-2">{formatearFecha(fee.fecha_creacion)}</span>
        {fee.observaciones && <div className="text-neutral-400">{fee.observaciones}</div>}
      </div>
      {fee.estado === "PENDIENTE" ? (
        <button onClick={handlePagar} disabled={guardando} className="text-accent font-bold border border-accent rounded-lg px-2 py-1 disabled:opacity-40">
          {guardando ? "..." : "Marcar pagado"}
        </button>
      ) : (
        <span className="font-semibold text-emerald-600">{fee.estado}</span>
      )}
    </div>
  );
}

function PagoManualForm({ idMarca, onGuardado }: { idMarca: string; onGuardado: () => void }) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    registrarPagoComercial(idMarca, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else onGuardado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 pt-2 border-t border-neutral-200 space-y-2">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-3 gap-2 items-end">
        <select name="tipo" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs">
          <option value="pago">Pago recibido (baja el saldo)</option>
          <option value="cargo">Cargo nuevo (sube el saldo)</option>
        </select>
        <input name="monto" type="number" step="1" required placeholder="Monto" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
        <input name="descripcion" placeholder="Descripción" className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs" />
      </div>
      <button type="submit" disabled={guardando} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg">
        {guardando ? "Guardando..." : "Registrar"}
      </button>
    </form>
  );
}

const ETIQUETA_CUENTA: Record<string, string> = {
  LIQUIDACIONES: "💰 Liquidaciones",
  COMERCIAL: "🏬 Comercial",
  RETENCIONES: "🧾 Retenciones",
};

type CuentaMarca = "LIQUIDACIONES" | "COMERCIAL" | "RETENCIONES";
type SaldosCuentas = { liquidaciones: number; comercial: number; retenciones: number };

function saldoDe(saldos: SaldosCuentas, cuenta: CuentaMarca) {
  if (cuenta === "LIQUIDACIONES") return saldos.liquidaciones;
  if (cuenta === "COMERCIAL") return saldos.comercial;
  return saldos.retenciones;
}

type CompensacionFila = {
  idCompensacion: string;
  cuentaA: CuentaMarca;
  cuentaB: CuentaMarca;
  importe: number;
  usuario: string | null;
  observaciones: string | null;
  fecha: string;
};

function CompensacionCuentas({
  idMarca,
  saldos,
  onCambio,
}: {
  idMarca: string;
  saldos: SaldosCuentas;
  onCambio: () => void;
}) {
  const [cuentaA, setCuentaA] = useState<CuentaMarca>("LIQUIDACIONES");
  const [cuentaB, setCuentaB] = useState<CuentaMarca>("COMERCIAL");
  const [monto, setMonto] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historial, setHistorial] = useState<CompensacionFila[]>([]);
  const [mostrarHistorial, setMostrarHistorial] = useState(false);

  function recargarHistorial() {
    historialCompensacionesAction(idMarca).then(setHistorial);
  }

  useEffect(recargarHistorial, [idMarca]);

  const maximo = Math.max(Math.min(saldoDe(saldos, cuentaA), saldoDe(saldos, cuentaB)), 0);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    registrarCompensacionAction(idMarca, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else {
          setMonto("");
          setObservaciones("");
          recargarHistorial();
          onCambio();
        }
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="bg-teal-50 border border-teal-200 rounded-xl overflow-hidden mb-3.5">
      <div className="px-4 py-3 border-b border-teal-100">
        <h2 className="text-sm font-bold text-teal-800">⇄ Compensar cuentas</h2>
        <p className="text-[11px] text-teal-700/70">
          Cruzá manualmente lo que se deben entre sí dos de las tres cuentas — nunca es automático.
        </p>
      </div>
      <div className="px-4 py-3">
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] text-teal-700 mb-1">Cuenta A</label>
              <select
                name="cuenta_a"
                value={cuentaA}
                onChange={(e) => setCuentaA(e.target.value as CuentaMarca)}
                className="w-full border border-teal-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
              >
                {(["LIQUIDACIONES", "COMERCIAL", "RETENCIONES"] as CuentaMarca[]).map((c) => (
                  <option key={c} value={c} disabled={c === cuentaB}>
                    {ETIQUETA_CUENTA[c]} — ${formatearMonto(saldoDe(saldos, c))}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-teal-700 mb-1">Cuenta B</label>
              <select
                name="cuenta_b"
                value={cuentaB}
                onChange={(e) => setCuentaB(e.target.value as CuentaMarca)}
                className="w-full border border-teal-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
              >
                {(["LIQUIDACIONES", "COMERCIAL", "RETENCIONES"] as CuentaMarca[]).map((c) => (
                  <option key={c} value={c} disabled={c === cuentaA}>
                    {ETIQUETA_CUENTA[c]} — ${formatearMonto(saldoDe(saldos, c))}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-teal-700 mb-1">Monto a compensar (máximo ${formatearMonto(maximo)})</label>
            <input
              name="importe"
              type="number"
              step="1"
              max={maximo}
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="w-full border border-teal-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] text-teal-700 mb-1">Observaciones (opcional)</label>
            <input
              name="observaciones"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="w-full border border-teal-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
            />
          </div>
          <button
            type="submit"
            disabled={guardando || maximo <= 0}
            className="text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 px-3 py-1.5 rounded-lg"
          >
            {guardando ? "Guardando..." : `Confirmar compensación`}
          </button>
          {maximo <= 0 && <p className="text-[10px] text-teal-700/70">No hay saldo en común entre esas dos cuentas para compensar.</p>}
        </form>

        <button onClick={() => setMostrarHistorial((v) => !v)} className="text-xs font-semibold text-teal-700 mt-3">
          {mostrarHistorial ? "▾" : "▸"} Historial de compensaciones ({historial.length})
        </button>
        {mostrarHistorial && (
          <div className="mt-2 space-y-1.5">
            {historial.length === 0 ? (
              <p className="text-xs text-teal-700/60">Todavía no se registró ninguna compensación.</p>
            ) : (
              historial.map((h) => (
                <div key={h.idCompensacion} className="bg-white border border-teal-200 rounded-lg px-3 py-2 text-xs">
                  <div className="flex justify-between font-semibold">
                    <span>
                      {ETIQUETA_CUENTA[h.cuentaA]} ⇄ {ETIQUETA_CUENTA[h.cuentaB]}
                    </span>
                    <span className="tabular-nums">${formatearMonto(h.importe)}</span>
                  </div>
                  <div className="text-teal-700/60 mt-0.5">
                    {formatearFecha(h.fecha)} · {h.usuario ?? "—"}
                    {h.observaciones && ` · ${h.observaciones}`}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// El disponible real es de TODO el negocio, no de esta marca sola — la
// plata no está separada por marca en el banco. Esto solo avisa, nunca
// bloquea: vos decidís si liquidás igual.
function AlertaCapitalTrabajo({
  nombreMarca,
  pendienteMarca,
  disponibleReal,
}: {
  nombreMarca: string;
  pendienteMarca: number;
  disponibleReal: number;
}) {
  const alcanza = disponibleReal >= pendienteMarca;
  const faltante = Math.max(pendienteMarca - disponibleReal, 0);

  return (
    <div className={`border rounded-xl p-4 mb-3.5 ${alcanza ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
      <p className={`text-sm font-bold mb-1 ${alcanza ? "text-emerald-700" : "text-red-700"}`}>
        {alcanza ? "✓ Alcanza para liquidar sin usar plata propia" : "⚠️ Esta liquidación te va a pedir plata propia"}
      </p>
      <p className="text-[11px] text-neutral-500 mb-3">
        {alcanza
          ? "El disponible real de todo el negocio cubre lo pendiente de esta marca, incluso si liquidás todo ahora mismo."
          : `${nombreMarca} tiene más pendiente de liquidar que el disponible real de todo el negocio.`}
      </p>
      <div className="flex gap-6 text-xs">
        <div>
          <p className="text-neutral-400">Pendiente de esta marca</p>
          <p className="text-base font-extrabold tabular-nums">${formatearMonto(pendienteMarca)}</p>
        </div>
        <div>
          <p className="text-neutral-400">Disponible real (todo el negocio)</p>
          <p className="text-base font-extrabold tabular-nums">${formatearMonto(disponibleReal)}</p>
        </div>
        <div>
          <p className="text-neutral-400">{alcanza ? "Sobra" : "Te faltaría"}</p>
          <p className={`text-base font-extrabold tabular-nums ${alcanza ? "text-emerald-700" : "text-red-700"}`}>
            ${formatearMonto(alcanza ? disponibleReal - pendienteMarca : faltante)}
          </p>
        </div>
      </div>
    </div>
  );
}
