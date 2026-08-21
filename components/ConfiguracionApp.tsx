"use client";

import { useMemo, useState, useTransition } from "react";
import {
  guardarConfigPuntos,
  guardarConfigLiquidaciones,
  guardarConfigRentabilidad,
  guardarConfigMercadoPago,
} from "@/app/(app)/configuracion/actions";

export default function ConfiguracionApp({
  puntosActivo,
  puntosCadaMonto,
  puntosOtorgados,
  impCreditosPorcentaje,
  sircrebPorcentaje,
  impDebitosPorcentaje,
  ivaGeneralPorcentaje,
  iibbPorcentaje,
  mpComisionDineroCuenta,
  mpComisionDebito,
  mpComisionCuotasSinInteres,
  mpComisionPrepaga,
  mpComisionCredito,
}: {
  puntosActivo: boolean;
  puntosCadaMonto: number;
  puntosOtorgados: number;
  impCreditosPorcentaje: number;
  sircrebPorcentaje: number;
  impDebitosPorcentaje: number;
  ivaGeneralPorcentaje: number;
  iibbPorcentaje: number;
  mpComisionDineroCuenta: number;
  mpComisionDebito: number;
  mpComisionCuotasSinInteres: number;
  mpComisionPrepaga: number;
  mpComisionCredito: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [guardado, setGuardado] = useState(false);
  const [activo, setActivo] = useState(puntosActivo);
  const [cadaMonto, setCadaMonto] = useState(puntosCadaMonto);
  const [otorgados, setOtorgados] = useState(puntosOtorgados);
  const [compraEjemplo, setCompraEjemplo] = useState(23500);

  const [isPendingLiq, startTransitionLiq] = useTransition();
  const [guardadoLiq, setGuardadoLiq] = useState(false);
  const [impCreditos, setImpCreditos] = useState(impCreditosPorcentaje);
  const [sircreb, setSircreb] = useState(sircrebPorcentaje);
  const [impDebitos, setImpDebitos] = useState(impDebitosPorcentaje);

  const [isPendingRent, startTransitionRent] = useTransition();
  const [guardadoRent, setGuardadoRent] = useState(false);
  const [ivaGeneral, setIvaGeneral] = useState(ivaGeneralPorcentaje);
  const [iibb, setIibb] = useState(iibbPorcentaje);

  const [isPendingMp, startTransitionMp] = useTransition();
  const [guardadoMp, setGuardadoMp] = useState(false);
  const [mpDineroCuenta, setMpDineroCuenta] = useState(mpComisionDineroCuenta);
  const [mpDebito, setMpDebito] = useState(mpComisionDebito);
  const [mpCuotas, setMpCuotas] = useState(mpComisionCuotasSinInteres);
  const [mpPrepaga, setMpPrepaga] = useState(mpComisionPrepaga);
  const [mpCredito, setMpCredito] = useState(mpComisionCredito);

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

  function handleSubmitLiq(formData: FormData) {
    setGuardadoLiq(false);
    startTransitionLiq(async () => {
      await guardarConfigLiquidaciones(formData);
      setGuardadoLiq(true);
    });
  }

  function handleSubmitRent(formData: FormData) {
    setGuardadoRent(false);
    startTransitionRent(async () => {
      await guardarConfigRentabilidad(formData);
      setGuardadoRent(true);
    });
  }

  function handleSubmitMp(formData: FormData) {
    setGuardadoMp(false);
    startTransitionMp(async () => {
      await guardarConfigMercadoPago(formData);
      setGuardadoMp(true);
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

      <form action={handleSubmitLiq} className="bg-white border border-neutral-200 rounded-xl p-5 mt-5">
        <h2 className="text-base font-semibold text-neutral-900 mb-1">📊 Liquidaciones — tasas generales</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Se aplican igual para todas las marcas en consignación. El royalty y el IVA sobre royalty son por marca —
          se cargan en la ficha de cada una, no acá.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="imp_creditos_porcentaje">
              Imp. a los Créditos (%)
            </label>
            <input
              id="imp_creditos_porcentaje"
              name="imp_creditos_porcentaje"
              type="number"
              step="0.01"
              value={impCreditos}
              onChange={(e) => setImpCreditos(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-neutral-400 mt-1">Se descuenta de lo que se le rinde a la marca.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="sircreb_porcentaje">
              SIRCREB (%)
            </label>
            <input
              id="sircreb_porcentaje"
              name="sircreb_porcentaje"
              type="number"
              step="0.01"
              value={sircreb}
              onChange={(e) => setSircreb(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-neutral-400 mt-1">Lo absorbe WiiGo — solo informativo, no se le descuenta a la marca.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="imp_debitos_porcentaje">
              Imp. a los Débitos (%)
            </label>
            <input
              id="imp_debitos_porcentaje"
              name="imp_debitos_porcentaje"
              type="number"
              step="0.01"
              value={impDebitos}
              onChange={(e) => setImpDebitos(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-neutral-400 mt-1">Lo cobra el banco al transferir — lo absorbe WiiGo, solo proyección.</p>
          </div>
        </div>

        {guardadoLiq && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4">
            Configuración guardada.
          </p>
        )}

        <button
          type="submit"
          disabled={isPendingLiq}
          className="w-full rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPendingLiq ? "Guardando..." : "Guardar tasas"}
        </button>
      </form>

      <form action={handleSubmitMp} className="bg-white border border-neutral-200 rounded-xl p-5 mt-5">
        <h2 className="text-base font-semibold text-neutral-900 mb-1">💳 Comisión de Mercado Pago</h2>
        <p className="text-sm text-neutral-500 mb-4">
          No es una sola tasa — Mercado Pago cobra distinto según cómo pagó el cliente. Cargá cada una con el IVA ya
          incluido, tal cual la publica Mercado Pago. Al confirmar un cobro por Mercado Pago se va a elegir cuál de
          estas se usó, para que Liquidaciones y Rentabilidad apliquen la correcta.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="mp_comision_dinero_cuenta">
              Dinero en cuenta MP (%)
            </label>
            <input
              id="mp_comision_dinero_cuenta"
              name="mp_comision_dinero_cuenta"
              type="number"
              step="0.01"
              value={mpDineroCuenta}
              onChange={(e) => setMpDineroCuenta(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="mp_comision_debito">
              Tarjeta de débito (%)
            </label>
            <input
              id="mp_comision_debito"
              name="mp_comision_debito"
              type="number"
              step="0.01"
              value={mpDebito}
              onChange={(e) => setMpDebito(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="mp_comision_cuotas_sin_interes">
              Cuotas sin interés (%)
            </label>
            <input
              id="mp_comision_cuotas_sin_interes"
              name="mp_comision_cuotas_sin_interes"
              type="number"
              step="0.01"
              value={mpCuotas}
              onChange={(e) => setMpCuotas(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="mp_comision_prepaga">
              Tarjeta prepaga (%)
            </label>
            <input
              id="mp_comision_prepaga"
              name="mp_comision_prepaga"
              type="number"
              step="0.01"
              value={mpPrepaga}
              onChange={(e) => setMpPrepaga(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="mp_comision_credito">
              Tarjeta de crédito (%)
            </label>
            <input
              id="mp_comision_credito"
              name="mp_comision_credito"
              type="number"
              step="0.01"
              value={mpCredito}
              onChange={(e) => setMpCredito(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        {guardadoMp && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4">
            Configuración guardada.
          </p>
        )}

        <button
          type="submit"
          disabled={isPendingMp}
          className="w-full rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPendingMp ? "Guardando..." : "Guardar tasas"}
        </button>
      </form>

      <form action={handleSubmitRent} className="bg-white border border-neutral-200 rounded-xl p-5 mt-5">
        <h2 className="text-base font-semibold text-neutral-900 mb-1">📈 Rentabilidad — Marca Propia</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Para calcular la contribución marginal real de los productos de WiiGo Dietética.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="iva_general_porcentaje">
              IVA incluido en el precio (%)
            </label>
            <input
              id="iva_general_porcentaje"
              name="iva_general_porcentaje"
              type="number"
              step="0.01"
              value={ivaGeneral}
              onChange={(e) => setIvaGeneral(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-neutral-400 mt-1">Se saca de la venta para calcular la facturación neta — el IVA no es un costo.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="iibb_porcentaje">
              Ingresos Brutos (%)
            </label>
            <input
              id="iibb_porcentaje"
              name="iibb_porcentaje"
              type="number"
              step="0.01"
              value={iibb}
              onChange={(e) => setIibb(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-neutral-400 mt-1">
              Alícuota sobre la facturación neta — solo se aplica a ventas por banco/Mercado Pago, no a efectivo.
            </p>
          </div>
        </div>

        {guardadoRent && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4">
            Configuración guardada.
          </p>
        )}

        <button
          type="submit"
          disabled={isPendingRent}
          className="w-full rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPendingRent ? "Guardando..." : "Guardar tasas"}
        </button>
      </form>
    </div>
  );
}
