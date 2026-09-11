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

/**
 * Traduce las dos reglas de descuento a la única pregunta que importa:
 * "¿hasta cuánto puede descontar cada marca sin que me llegue a mí?".
 *
 * Existe porque el piso de comisión, dicho como número suelto, se lee mal: es
 * fácil poner 10% sin darse cuenta de que con royalties del 5% eso escala
 * absolutamente todo. Mostrando la consecuencia por marca, ese error se ve.
 */
function TopeQueHabilita({
  comisionMinima,
  maxSinConsulta,
  marcas,
}: {
  comisionMinima: number;
  maxSinConsulta: number;
  marcas: { nombre: string; royalty: number }[];
}) {
  // Las marcas con el mismo royalty se agrupan: lo que cambia el resultado es
  // el royalty, no el nombre.
  const porRoyalty = new Map<number, string[]>();
  marcas.forEach((m) => porRoyalty.set(m.royalty, [...(porRoyalty.get(m.royalty) ?? []), m.nombre]));
  const grupos = [...porRoyalty.entries()].sort((a, b) => a[0] - b[0]);

  if (grupos.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
      <p className="text-xs font-semibold text-neutral-700 mb-2">
        Con estas dos reglas, hasta acá puede descontar cada marca sin que te llegue a vos:
      </p>
      <ul className="space-y-1.5">
        {grupos.map(([royalty, nombres]) => {
          // El piso de comisión se cumple mientras royalty × (1 − desc) ≥ piso.
          const porPiso = royalty > 0 ? (1 - comisionMinima / royalty) * 100 : 0;
          const tope = Math.min(maxSinConsulta, Math.max(0, porPiso));
          const todoEscala = tope <= 0;
          return (
            <li key={royalty} className="text-xs text-neutral-600 flex justify-between gap-3">
              <span className="truncate">
                <b className="text-neutral-800">{royalty}%</b> de royalty
                <span className="text-neutral-400"> — {nombres.join(", ")}</span>
              </span>
              <span className={`font-semibold whitespace-nowrap ${todoEscala ? "text-red-600" : "text-neutral-800"}`}>
                {todoEscala ? "todo escala a vos" : `hasta ${Math.floor(tope)}% off`}
              </span>
            </li>
          );
        })}
      </ul>
      {grupos.every(([royalty]) => royalty > 0 && (1 - comisionMinima / royalty) * 100 <= 0) && (
        <p className="text-xs text-red-600 mt-2">
          Ninguna marca llega a ese piso: con este valor te va a llegar cada descuento, uno por uno. Bajalo.
        </p>
      )}
    </div>
  );
}

export default function ConfiguracionAprobaciones({
  politica,
  royaltiesMarcas,
}: {
  politica: PoliticaDescuentos;
  royaltiesMarcas: { nombre: string; royalty: number }[];
}) {
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
            Se mide contra el precio de lista, no contra el precio con descuento: tu royalty sigue siendo el mismo
            porcentaje, lo que baja son los pesos. Un royalty del 5% con 20% de descuento equivale a un 4%.
          </p>
          <TopeQueHabilita comisionMinima={comisionMinima} maxSinConsulta={maxSinConsulta} marcas={royaltiesMarcas} />
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
