"use client";

import { useMemo, useState, useTransition } from "react";
import {
  guardarConfigPuntos,
  guardarConfigImpuestos,
  guardarConfigRentabilidad,
  guardarConfigMercadoPago,
  guardarConfigGastos,
  conectarMercadoPagoQR,
} from "@/app/(app)/configuracion/actions";

export default function ConfiguracionApp({
  puntosActivo,
  puntosCadaMonto,
  puntosOtorgados,
  puntosTopeCanjePorcentaje,
  impCreditosPorcentaje,
  sircrebPorcentaje,
  impDebitosPorcentaje,
  ivaGeneralPorcentaje,
  iibbPorcentaje,
  margenMinimoPorcentaje,
  mpComisionDineroCuenta,
  mpComisionDebito,
  mpComisionCuotasSinInteres,
  mpComisionPrepaga,
  mpComisionCredito,
  mpExternalPosId,
  gastosTopeSinAutorizacion,
}: {
  puntosActivo: boolean;
  puntosCadaMonto: number;
  puntosOtorgados: number;
  puntosTopeCanjePorcentaje: number;
  impCreditosPorcentaje: number;
  sircrebPorcentaje: number;
  impDebitosPorcentaje: number;
  ivaGeneralPorcentaje: number;
  iibbPorcentaje: number;
  margenMinimoPorcentaje: number;
  mpComisionDineroCuenta: number;
  mpComisionDebito: number;
  mpComisionCuotasSinInteres: number;
  mpComisionPrepaga: number;
  mpComisionCredito: number;
  mpExternalPosId: string | null;
  gastosTopeSinAutorizacion: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [guardado, setGuardado] = useState(false);
  const [errorPuntos, setErrorPuntos] = useState<string | null>(null);
  const [activo, setActivo] = useState(puntosActivo);
  const [cadaMonto, setCadaMonto] = useState(puntosCadaMonto);
  const [otorgados, setOtorgados] = useState(puntosOtorgados);
  const [topeCanje, setTopeCanje] = useState(puntosTopeCanjePorcentaje);
  const [compraEjemplo, setCompraEjemplo] = useState(23500);

  const [isPendingLiq, startTransitionLiq] = useTransition();
  const [guardadoLiq, setGuardadoLiq] = useState(false);
  const [errorLiq, setErrorLiq] = useState<string | null>(null);
  const [impCreditos, setImpCreditos] = useState(impCreditosPorcentaje);
  const [sircreb, setSircreb] = useState(sircrebPorcentaje);
  const [impDebitos, setImpDebitos] = useState(impDebitosPorcentaje);
  const [ivaGeneral, setIvaGeneral] = useState(ivaGeneralPorcentaje);

  const [isPendingRent, startTransitionRent] = useTransition();
  const [guardadoRent, setGuardadoRent] = useState(false);
  const [errorRent, setErrorRent] = useState<string | null>(null);
  const [iibb, setIibb] = useState(iibbPorcentaje);
  const [margenMinimo, setMargenMinimo] = useState(margenMinimoPorcentaje);

  const [isPendingMp, startTransitionMp] = useTransition();
  const [guardadoMp, setGuardadoMp] = useState(false);
  const [errorMp, setErrorMp] = useState<string | null>(null);
  const [mpDineroCuenta, setMpDineroCuenta] = useState(mpComisionDineroCuenta);
  const [mpDebito, setMpDebito] = useState(mpComisionDebito);
  const [mpCuotas, setMpCuotas] = useState(mpComisionCuotasSinInteres);
  const [mpPrepaga, setMpPrepaga] = useState(mpComisionPrepaga);
  const [mpCredito, setMpCredito] = useState(mpComisionCredito);

  const [isPendingQr, startTransitionQr] = useTransition();
  const [errorQr, setErrorQr] = useState<string | null>(null);
  const [posIdQr, setPosIdQr] = useState(mpExternalPosId);

  function handleConectarQr() {
    setErrorQr(null);
    startTransitionQr(async () => {
      const res = await conectarMercadoPagoQR();
      if (res.error) setErrorQr(res.error);
      else if (res.posId) setPosIdQr(res.posId);
    });
  }

  const [isPendingGastos, startTransitionGastos] = useTransition();
  const [guardadoGastos, setGuardadoGastos] = useState(false);
  const [errorGastos, setErrorGastos] = useState<string | null>(null);
  const [topeGastos, setTopeGastos] = useState(gastosTopeSinAutorizacion);

  const puntosCalculados = useMemo(() => {
    if (!cadaMonto || cadaMonto <= 0) return 0;
    return Math.floor((compraEjemplo / cadaMonto) * otorgados);
  }, [compraEjemplo, cadaMonto, otorgados]);

  const valorPorPunto = otorgados > 0 ? cadaMonto / otorgados : 0;
  const maxCanjeEjemplo = Math.round(compraEjemplo * (topeCanje / 100));

  function handleSubmit(formData: FormData) {
    setGuardado(false);
    setErrorPuntos(null);
    startTransition(async () => {
      const res = await guardarConfigPuntos(formData);
      if (res.error) setErrorPuntos(res.error);
      else setGuardado(true);
    });
  }

  function handleSubmitLiq(formData: FormData) {
    setGuardadoLiq(false);
    setErrorLiq(null);
    startTransitionLiq(async () => {
      const res = await guardarConfigImpuestos(formData);
      if (res.error) setErrorLiq(res.error);
      else setGuardadoLiq(true);
    });
  }

  function handleSubmitRent(formData: FormData) {
    setGuardadoRent(false);
    setErrorRent(null);
    startTransitionRent(async () => {
      const res = await guardarConfigRentabilidad(formData);
      if (res.error) setErrorRent(res.error);
      else setGuardadoRent(true);
    });
  }

  function handleSubmitMp(formData: FormData) {
    setGuardadoMp(false);
    setErrorMp(null);
    startTransitionMp(async () => {
      const res = await guardarConfigMercadoPago(formData);
      if (res.error) setErrorMp(res.error);
      else setGuardadoMp(true);
    });
  }

  function handleSubmitGastos(formData: FormData) {
    setGuardadoGastos(false);
    setErrorGastos(null);
    startTransitionGastos(async () => {
      const res = await guardarConfigGastos(formData);
      if (res.error) setErrorGastos(res.error);
      else setGuardadoGastos(true);
    });
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Configuración</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Parámetros generales del sistema WiiGo. Los usuarios se mudaron a Organización → Usuarios.
      </p>

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

        <div className="border-t border-dashed border-neutral-200 pt-4 mb-5">
          <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="puntos_tope_canje_porcentaje">
            Tope de canje — % máximo de una compra que se puede pagar con puntos
          </label>
          <div className="flex items-center gap-2 mb-2">
            <input
              id="puntos_tope_canje_porcentaje"
              name="puntos_tope_canje_porcentaje"
              type="number"
              min={0}
              max={100}
              value={topeCanje}
              onChange={(e) => setTopeCanje(Number(e.target.value))}
              className="w-24 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <span className="text-sm text-neutral-500">%</span>
          </div>
          <p className="text-xs text-neutral-400 mb-2">
            En 0% el canje queda desactivado. 1 punto vale ${valorPorPunto.toLocaleString("es-AR", { maximumFractionDigits: 2 })} al canjear (misma tasa que la acumulación).
          </p>
          <p className="text-sm text-neutral-600">
            Compra de ${compraEjemplo.toLocaleString("es-AR")} → como máximo se pueden pagar{" "}
            <strong className="text-neutral-900">${maxCanjeEjemplo.toLocaleString("es-AR")}</strong> con puntos.
          </p>
        </div>

        {errorPuntos && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{errorPuntos}</p>
        )}
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
        <h2 className="text-base font-semibold text-neutral-900 mb-1">💰 Impuestos y comisiones bancarias</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Estos 4 valores los usan tanto <b>Liquidaciones</b> (lo que se le rinde a cada marca) como{" "}
          <b>Rentabilidad</b> (el margen real de Marca Propia) — cambiarlos acá afecta a los dos. El royalty y el IVA
          sobre royalty son por marca, se cargan en la ficha de cada una, no acá.
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
            <p className="text-xs text-neutral-400 mt-1">
              Se descuenta a todas las marcas por igual en toda venta no efectivo — no es configurable por marca.
            </p>
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
            <p className="text-xs text-neutral-400 mt-1">
              Tasa usada para retenerlo preventivamente en la liquidación de las marcas que tengan tildado "SIRCREB" en
              Costos de cobro a trasladar (ficha de la marca) — no es ganancia de WiiGo, queda en su cuenta corriente
              de retenciones. Si la marca no lo tiene tildado, lo sigue absorbiendo WiiGo como hasta ahora.
            </p>
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
            <p className="text-xs text-neutral-400 mt-1">Lo cobra el banco al transferir — lo absorbe WiiGo siempre, nunca se le traslada a ninguna marca. Solo proyección en Rentabilidad.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="iva_general_porcentaje">
              IVA general (%)
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
            <p className="text-xs text-neutral-400 mt-1">
              Se usa para el IVA que se suma a la comisión de Mercado Pago cobrada a las marcas, y para sacar la
              facturación neta de los productos propios en Rentabilidad.
            </p>
          </div>
        </div>

        {errorLiq && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{errorLiq}</p>
        )}
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
          No es una sola tasa — Mercado Pago cobra distinto según cómo pagó el cliente. Cargá el número base tal cual
          lo publica Mercado Pago (ej. Débito 1,39%) — el sistema le suma el IVA arriba solo, no hace falta
          calcularlo a mano. Al confirmar un cobro por Mercado Pago se va a elegir cuál de estas se usó, para que
          Liquidaciones y Rentabilidad apliquen la correcta.
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

        {errorMp && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{errorMp}</p>
        )}
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

      <div className="bg-white border border-neutral-200 rounded-xl p-5 mt-5">
        <h2 className="text-base font-semibold text-neutral-900 mb-1">📱 QR de Mercado Pago (totem)</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Conecta esta cuenta de Mercado Pago con el self-checkout para que aparezca un QR real al elegir esa forma
          de pago. Es un paso único — no hace falta repetirlo salvo que cambies de cuenta de Mercado Pago.
        </p>

        {posIdQr ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">
            ✅ Conectado — caja <span className="font-mono">{posIdQr}</span>
          </p>
        ) : (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            Todavía no está conectado.
          </p>
        )}

        {errorQr && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{errorQr}</p>}

        <button
          type="button"
          onClick={handleConectarQr}
          disabled={isPendingQr}
          className="w-full rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPendingQr ? "Conectando..." : posIdQr ? "Volver a conectar" : "Conectar Mercado Pago QR"}
        </button>
      </div>

      <form action={handleSubmitRent} className="bg-white border border-neutral-200 rounded-xl p-5 mt-5">
        <h2 className="text-base font-semibold text-neutral-900 mb-1">📈 Rentabilidad — Marca Propia</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Para calcular la contribución marginal real de los productos de WiiGo Dietética. También usa los impuestos
          y comisiones cargados arriba (Impuestos y comisiones bancarias, y Comisión de Mercado Pago).
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
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
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="margen_minimo_porcentaje">
              Margen mínimo de venta (%)
            </label>
            <input
              id="margen_minimo_porcentaje"
              name="margen_minimo_porcentaje"
              type="number"
              step="0.01"
              value={margenMinimo}
              onChange={(e) => setMargenMinimo(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-neutral-400 mt-1">
              Por debajo de esto, el producto avisa que puede estar perdiendo plata (IIBB + costos de cobro + colchón).
            </p>
          </div>
        </div>

        {errorRent && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{errorRent}</p>
        )}
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

      <form action={handleSubmitGastos} className="bg-white border border-neutral-200 rounded-xl p-5 mt-5">
        <h2 className="text-base font-semibold text-neutral-900 mb-1">🧾 Gastos — autorización</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Por encima de este monto, un usuario operativo necesita la contraseña de un administrador para confirmar
          el gasto. Los administradores nunca necesitan autorización.
        </p>

        <div className="mb-4">
          <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="gastos_tope_sin_autorizacion">
            Tope sin autorización ($)
          </label>
          <input
            id="gastos_tope_sin_autorizacion"
            name="gastos_tope_sin_autorizacion"
            type="number"
            step="1"
            value={topeGastos}
            onChange={(e) => setTopeGastos(Number(e.target.value))}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {errorGastos && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{errorGastos}</p>
        )}
        {guardadoGastos && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4">
            Configuración guardada.
          </p>
        )}

        <button
          type="submit"
          disabled={isPendingGastos}
          className="w-full rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPendingGastos ? "Guardando..." : "Guardar tope"}
        </button>
      </form>
    </div>
  );
}
