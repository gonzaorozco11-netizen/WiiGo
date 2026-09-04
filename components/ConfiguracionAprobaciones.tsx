"use client";

import { useState, useTransition } from "react";
import { guardarConfigAprobaciones } from "@/app/(app)/configuracion/actions";
import type { PoliticaDescuentos } from "@/lib/solicitudesMarca";

// Las reglas de la bandeja de Aprobaciones.
//
// La idea de fondo: el dueño define la política una vez acá, y de ahí en más
// administración aprueba sola todo lo que entra dentro de la política. Solo
// escala lo que se sale. Por eso cada campo dice, abajo, qué pasa cuando el
// pedido de la marca no cumple.

export default function ConfiguracionAprobaciones({ politica }: { politica: PoliticaDescuentos }) {
  const [isPending, startTransition] = useTransition();
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hora, setHora] = useState(politica.horaAplicacion);
  const [variacion, setVariacion] = useState(politica.variacionPrecioAlerta);
  const [maxSinConsulta, setMaxSinConsulta] = useState(politica.maxSinConsulta);
  const [comisionMinima, setComisionMinima] = useState(politica.comisionMinima);
  const [duracionMax, setDuracionMax] = useState(politica.duracionMaxDias);
  const [maxProductos, setMaxProductos] = useState(politica.maxProductosPorMarca);
  const [diasEntre, setDiasEntre] = useState(politica.diasEntrePromos);

  function handleSubmit(formData: FormData) {
    setGuardado(false);
    setError(null);
    startTransition(async () => {
      const res = await guardarConfigAprobaciones(formData);
      if (res.error) setError(res.error);
      else setGuardado(true);
    });
  }

  const campo =
    "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent";
  const etiqueta = "block text-sm font-medium text-neutral-700 mb-1";
  const ayuda = "text-xs text-neutral-500 mt-1";

  return (
    <form action={handleSubmit} className="bg-white border border-neutral-200 rounded-xl p-5 mt-5">
      <h2 className="text-base font-semibold text-neutral-900 mb-1">✅ Aprobaciones — precios y descuentos</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Hasta dónde puede aprobar administración sola. Todo lo que se sale de estas reglas no se rechaza: queda
        marcado y pasa al dueño.
      </p>

      <div className="mb-4">
        <label className={etiqueta} htmlFor="etiqueta_hora_aplicacion">
          Hora en que entran los precios nuevos
        </label>
        <input
          id="etiqueta_hora_aplicacion"
          name="etiqueta_hora_aplicacion"
          type="time"
          min="20:00"
          max="23:30"
          value={hora}
          onChange={(e) => setHora(e.target.value)}
          className={campo}
        />
        <p className={ayuda}>
          Con el local cerrado. Un precio aprobado hoy entra a las {hora || "23:00"} de esta noche; si ya pasó esa
          hora, mañana. Así el cartel de góndola se cambia al cierre y nunca hay una venta en el medio con el cartel
          diciendo una cosa y la caja cobrando otra. Entre las 20:00 y las 23:30: el proceso automático corre a las
          23:30 y fuera de esa ventana el cambio quedaría para el día siguiente en pleno horario de venta.
        </p>
      </div>

      <div className="mb-4">
        <label className={etiqueta} htmlFor="precio_variacion_alerta">
          Marcar en rojo desde (%)
        </label>
        <input
          id="precio_variacion_alerta"
          name="precio_variacion_alerta"
          type="number"
          step="1"
          value={variacion}
          onChange={(e) => setVariacion(Number(e.target.value))}
          className={campo}
        />
        <p className={ayuda}>
          Un cambio de precio de más de {variacion}% aparece resaltado en la bandeja. Se puede aprobar igual: casi
          siempre es un cero de más al tipear, pero a veces es real.
        </p>
      </div>

      <div className="border-t border-neutral-100 pt-4 mb-4">
        <p className="text-sm font-semibold text-neutral-800 mb-3">Descuentos y promos</p>

        <div className="mb-4">
          <label className={etiqueta} htmlFor="descuento_max_sin_consulta">
            Descuento máximo sin consultar (%)
          </label>
          <input
            id="descuento_max_sin_consulta"
            name="descuento_max_sin_consulta"
            type="number"
            step="1"
            value={maxSinConsulta}
            onChange={(e) => setMaxSinConsulta(Number(e.target.value))}
            className={campo}
          />
          <p className={ayuda}>Arriba de {maxSinConsulta}% la promo la tenés que aprobar vos.</p>
        </div>

        <div className="mb-4">
          <label className={etiqueta} htmlFor="descuento_comision_minima">
            Comisión mínima que te tiene que quedar (%)
          </label>
          <input
            id="descuento_comision_minima"
            name="descuento_comision_minima"
            type="number"
            step="0.5"
            value={comisionMinima}
            onChange={(e) => setComisionMinima(Number(e.target.value))}
            className={campo}
          />
          <p className={ayuda}>
            Esta es la regla que importa de verdad: no cuánto descuenta la marca, sino con cuánto quedás vos después
            del descuento. Si la promo deja tu comisión abajo de {comisionMinima}%, escala.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={etiqueta} htmlFor="descuento_duracion_max_dias">
              Duración máx. (días)
            </label>
            <input
              id="descuento_duracion_max_dias"
              name="descuento_duracion_max_dias"
              type="number"
              step="1"
              value={duracionMax}
              onChange={(e) => setDuracionMax(Number(e.target.value))}
              className={campo}
            />
          </div>
          <div>
            <label className={etiqueta} htmlFor="descuento_max_productos_marca">
              Productos en promo
            </label>
            <input
              id="descuento_max_productos_marca"
              name="descuento_max_productos_marca"
              type="number"
              step="1"
              value={maxProductos}
              onChange={(e) => setMaxProductos(Number(e.target.value))}
              className={campo}
            />
          </div>
          <div>
            <label className={etiqueta} htmlFor="descuento_dias_entre_promos">
              Espera entre promos
            </label>
            <input
              id="descuento_dias_entre_promos"
              name="descuento_dias_entre_promos"
              type="number"
              step="1"
              value={diasEntre}
              onChange={(e) => setDiasEntre(Number(e.target.value))}
              className={campo}
            />
          </div>
        </div>
        <p className={ayuda}>
          Cada marca puede tener {maxProductos} productos en promo a la vez, por hasta {duracionMax} días, y el mismo
          producto no puede volver a estar en promo antes de {diasEntre} días. Es lo que evita el descuento
          permanente disfrazado de oferta.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>
      )}
      {guardado && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4">
          Reglas guardadas. Se aplican a las solicitudes nuevas; las que ya están en la bandeja mantienen la regla con
          la que entraron.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
      >
        {isPending ? "Guardando..." : "Guardar reglas"}
      </button>
    </form>
  );
}
