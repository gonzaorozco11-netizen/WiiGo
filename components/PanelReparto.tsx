"use client";

import { useState } from "react";
import { ETIQUETA_RETENCION, type MargenSimulado } from "@/lib/margenMarca";

// A dónde va cada peso que paga el cliente.
//
// Vive solo acá y lo usan las dos pantallas donde la marca mira un precio:
// Mis productos (el precio de hoy) y Cambios y altas → Precios (el que está
// por mandar). Cuando la marca y WiiGo discuten un número, tienen que estar
// mirando el mismo dibujo — con dos paneles parecidos, la discusión se vuelve
// sobre cuál de las dos pantallas tiene razón.
//
// Antes eran dos cosas distintas y ninguna estaba bien del todo:
//
//   Mis productos tenía la dona MÁS una tabla de cinco filas debajo que
//   repetía los mismos números en el mismo orden con los mismos colores. El
//   dato estaba dos veces y la pantalla era el doble de larga.
//
//   Precios tenía dos columnas de texto sin dibujo, y le faltaba el renglón
//   de SIRCREB: se descontaba de la transferencia pero no figuraba en la
//   lista, así que las bajas no cerraban con el total. Una marca que suma las
//   cuatro líneas y le da distinto deja de creerle a la pantalla.
//
// Lo que quedó: la dona con el detalle al lado, adentro del mismo cuadro.
// Sin columna de porcentajes —la dona ya ES el porcentaje— y sin los
// renglones en cero del efectivo, que ocupaban tres líneas para informar que
// no pasa nada.

function pesos(v: number) {
  return v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function enteros(v: number) {
  return Math.round(v).toLocaleString("es-AR");
}
function pct1(v: number) {
  return (Math.round(v * 10) / 10).toLocaleString("es-AR");
}

const COLORES = {
  prod: "#8a9a78",
  wiigo: "#536243",
  banco: "#bd8f3e",
  sircreb: "#b4bcc6",
  queda: "#4c8459",
} as const;

type Parte = {
  etiqueta: string;
  color: string;
  monto: number;
  /** De dónde sale ese número. Se abre con la lupa del renglón. */
  porque: string;
};

/**
 * Los cinco pedazos, que suman el precio exacto.
 *
 * El IVA va junto con la comisión y no como pedazo propio: WiiGo le factura a
 * ELLA la comisión, así que cuánto IVA le toca depende de cómo facture —
 * restarle uno supuesto sería mostrarle una ganancia más chica que la real por
 * una cuenta que nadie hizo.
 */
function partes(m: MargenSimulado, costo: number): Parte[] {
  const royalty = m.precio > 0 ? (m.comisionWiigo / m.precio) * 100 : 0;
  return [
    {
      etiqueta: "Costo mercadería",
      color: COLORES.prod,
      monto: costo,
      porque:
        "Lo que vos dijiste que te cuesta cada unidad. Lo cargás en Mis productos y solo lo vemos vos y WiiGo — no sale en ninguna pantalla del local.",
    },
    {
      // Sin IVA trasladado el renglón no puede decir "+ IVA": en efectivo
      // suele no cobrarse, y el nombre quedaría prometiendo una baja que no
      // está en el número de al lado.
      etiqueta: m.ivaComision > 0 ? "Comisión WiiGo + IVA" : "Comisión WiiGo",
      color: COLORES.wiigo,
      monto: m.comisionWiigo + m.ivaComision,
      porque:
        `El ${pct1(royalty)}% de lo que paga el cliente, que es lo que cobra WiiGo por tener tu producto en góndola y venderlo` +
        (m.ivaComision > 0 ? ", más el IVA de esa comisión." : ". En efectivo no se te traslada el IVA."),
    },
    {
      etiqueta: "Otros costos",
      color: COLORES.banco,
      monto: m.comisionMp + m.impCreditos + m.impDebitos,
      porque:
        "Lo que cobra Mercado Pago por cobrar con tarjeta o QR, con su IVA, más los impuestos a los créditos y débitos bancarios. En efectivo no hay ninguno: esa plata no pasa por el banco.",
    },
    {
      etiqueta: ETIQUETA_RETENCION,
      color: COLORES.sircreb,
      monto: m.sircreb,
      // Describe lo que pasa y no lo que va a pasar después.
      //
      // Antes decía "se computa a cuenta en tu declaración, así que lo
      // recuperás". Eso es una promesa sobre plata ajena que esta pantalla no
      // está en condiciones de hacer: la retención se practica sobre la
      // cuenta por la que entra el cobro, y qué se hace con ella es una
      // decisión de WiiGo, no un hecho del régimen. Mientras esa decisión no
      // esté tomada, acá se dice solo lo que es seguro.
      porque:
        "Lo que se retiene de Ingresos Brutos en cada cobro con tarjeta o QR. Es plata que no entra con la venta. En efectivo no hay ninguna, porque el cobro no pasa por el banco.",
    },
    {
      etiqueta: "Te queda a vos",
      color: COLORES.queda,
      monto: m.leQueda ?? 0,
      porque: "Lo que paga el cliente menos todo lo de arriba, tu costo incluido.",
    },
  ];
}

/**
 * La dona: un arco por pedazo, con un hueco entre ellos y las puntas
 * redondeadas. Pegados se leían como un solo anillo partido en vez de como
 * cinco cosas distintas; el aro gris de atrás sostiene el círculo cuando algún
 * pedazo da cero.
 */
function Dona({ partes, centro, flojo }: { partes: Parte[]; centro: string; flojo: boolean }) {
  // `centro` es el porcentaje y no los pesos: los pesos están abajo, en el
  // renglón de "Ganás", y ponerlos en los dos lugares es decir dos veces lo
  // mismo en 100 px. El agujero de una torta es donde va la proporción.
  const R = 44;
  const C = 2 * Math.PI * R;
  const HUECO = C * (2.2 / 360);
  const total = partes.reduce((a, p) => a + Math.max(p.monto, 0), 0);
  let acumulado = 0;

  return (
    <div className="dona-rep">
      <svg viewBox="0 0 126 126" width="118" height="118" aria-hidden="true">
        <circle cx="63" cy="63" r={R} fill="none" stroke="#eef0e9" strokeWidth="15" />
        {/* Arranca arriba y gira como un reloj: es como se lee una torta. */}
        <g transform="rotate(-90 63 63)">
          {partes.map((p, i) => {
            const porcion = total > 0 ? Math.max(p.monto, 0) / total : 0;
            const largo = Math.max(porcion * C - HUECO, 0.1);
            const offset = -(acumulado * C + HUECO / 2);
            acumulado += porcion;
            return (
              <circle
                key={i}
                cx="63"
                cy="63"
                r={R}
                fill="none"
                stroke={p.color}
                strokeWidth="15"
                strokeLinecap="round"
                strokeDasharray={`${largo} ${C - largo}`}
                strokeDashoffset={offset}
              />
            );
          })}
        </g>
      </svg>
      <div className="centro">
        <b className={flojo ? "flojo" : undefined}>{centro}</b>
        <span>te queda</span>
      </div>
    </div>
  );
}

/**
 * Cuándo lo que le queda se pinta en rojo.
 *
 * No es "poco margen" en abstracto: es que de ese número todavía salen sus
 * propios impuestos y gastos, así que por debajo de este piso la venta no le
 * deja nada. Vale la pena que lo vea sin tener que hacer la cuenta.
 */
const MARGEN_FLOJO = 5;

/** Clave de la lupa del renglón final. No es una parte de la lista. */
const GANA = "__gana";

function Columna({
  m,
  costo,
  corto,
  gana,
}: {
  m: MargenSimulado;
  costo: number;
  corto: string;
  gana: boolean;
}) {
  const queda = m.leQueda ?? 0;
  const sobrePrecio = m.precio > 0 ? (queda / m.precio) * 100 : 0;
  const flojo = sobrePrecio < MARGEN_FLOJO;
  const esEfectivo = corto === "Efectivo";

  const todos = partes(m, costo);
  // Solo lo que SALE: lo que le queda ya está en el centro de la dona, en el
  // mismo verde que su pedazo. Repetirlo abajo era la mitad de la tabla vieja.
  // Los que dan cero no se listan: en efectivo eran tres renglones diciendo
  // que no pasa nada.
  const salen = todos.slice(0, -1).filter((p) => p.monto > 0);

  // Cuál explicación está abierta. Una por columna y una sola a la vez: dos
  // párrafos abiertos empujan la dona de al lado y se pierde la comparación,
  // que es para lo que están las dos columnas.
  const [abierta, setAbierta] = useState<string | null>(null);
  const abiertaParte = salen.find((p) => p.etiqueta === abierta) ?? null;

  return (
    <div className={gana ? "gana" : undefined}>
      <span className="sello">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          {esEfectivo ? (
            <>
              <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
              <circle cx="8" cy="8" r="1.9" />
            </>
          ) : (
            <>
              <rect x="1.5" y="3.5" width="13" height="9" rx="2" />
              <path d="M1.5 6.75h13" />
            </>
          )}
        </svg>
        {corto}
        {gana && (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6.4l2.4 2.4 4.6-5" />
          </svg>
        )}
      </span>

      <div className="cuerpo-rep">
        <Dona partes={todos} centro={`${pct1(sobrePrecio)}%`} flojo={flojo} />
        <div className="detalle-gasto">
          <p className="sale">Lo que sale</p>
          <ul>
            {salen.map((p) => {
              const abierto = abierta === p.etiqueta;
              return (
                <li key={p.etiqueta}>
                  <i className="llave" style={{ background: p.color }} />
                  <span>{p.etiqueta}</span>
                  {/* La lupa y no un signo de pregunta: lo que hace es
                      MOSTRAR de dónde sale el número, no ofrecer ayuda. Y es
                      un botón de verdad para que ande con el dedo y con el
                      teclado — un title= no se abre en un teléfono. */}
                  <button
                    type="button"
                    className={`lupa${abierto ? " abierta" : ""}`}
                    aria-expanded={abierto}
                    aria-label={`De dónde sale ${p.etiqueta}`}
                    onClick={() => setAbierta(abierto ? null : p.etiqueta)}
                  >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                      strokeWidth="1.8" strokeLinecap="round">
                      <circle cx="7" cy="7" r="4.6" />
                      <path d="M10.4 10.4 14 14" />
                    </svg>
                  </button>
                  <b>${enteros(p.monto)}</b>
                  {/* El porcentaje al lado del importe: los pesos dicen cuánto,
                      el porcentaje dice si es mucho. Sin él, "$2.202" no se
                      puede juzgar sin hacer la cuenta contra el precio. */}
                  <em>{pct1(m.precio > 0 ? (p.monto / m.precio) * 100 : 0)}%</em>
                </li>
              );
            })}
          </ul>
          {abiertaParte && <p className="porque abierta">{abiertaParte.porque}</p>}
          {!abiertaParte && esEfectivo && m.comisionMp === 0 && m.sircreb === 0 && (
            <p className="porque">
              Sin Mercado Pago, sin impuestos bancarios y sin retenciones: esa plata no pasa por el
              banco.
            </p>
          )}
        </div>
      </div>

      {/* El renglón que responde la pregunta, abajo de todo el desglose: la
          marca lee la lista para entender POR QUÉ, pero lo que vino a saber es
          cuánto gana. En pesos y en porcentaje, porque las dos cosas se usan
          para distinto — los pesos para decidir este precio, el porcentaje
          para comparar contra sus otros productos. */}
      <p className="gana-final">
        {/* Un precio por debajo del costo no "gana" menos: pierde. Decirlo
            «Ganás −$500» obliga a leer el signo para entender que está
            regalando plata en cada venta. */}
        <span>{queda < 0 ? "Perdés" : "Ganás"}</span>
        <b className={flojo ? "rojo" : undefined}>${pesos(Math.abs(queda))}</b>
        <em className={flojo ? "rojo" : undefined}>
          · {pct1(Math.abs(sobrePrecio))}%
        </em>
        {/* La aclaración de que todavía no es ganancia limpia vivía abajo del
            panel, suelta, y ahí era un renglón de letra chica que nadie
            leía dos veces. Colgada del número al que se refiere se lee cuando
            hace falta y no ocupa lugar el resto del tiempo. */}
        <button
          type="button"
          className={`lupa${abierta === GANA ? " abierta" : ""}`}
          aria-expanded={abierta === GANA}
          aria-label="De dónde sale este número"
          onClick={() => setAbierta(abierta === GANA ? null : GANA)}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round">
            <circle cx="7" cy="7" r="4.6" />
            <path d="M10.4 10.4 14 14" />
          </svg>
        </button>
        <small>de los ${enteros(m.precio)} que paga el cliente</small>
      </p>
      {abierta === GANA && (
        <p className="porque abierta">
          Es lo que paga el cliente menos todo lo de arriba, tu costo incluido. De ahí todavía salen{" "}
          <b>tus impuestos y tus gastos</b> —tu IVA según cómo facturás, Ingresos Brutos, alquiler,
          sueldos— que WiiGo no conoce y no calcula.
        </p>
      )}
    </div>
  );
}

export default function PanelReparto({
  credito,
  efectivo,
  costo,
  titulo = "A dónde va cada peso que paga el cliente",
}: {
  credito: MargenSimulado;
  /**
   * Puede faltar: hay productos sin precio de contado, y en el formulario de
   * precios el campo está vacío hasta que se escribe. Con una sola columna el
   * panel igual sirve —es la misma cuenta— así que no se esconde entero.
   */
  efectivo?: MargenSimulado | null;
  costo: number;
  /** Lo cambia Precios, para aclarar que son los que está por mandar. */
  titulo?: string;
}) {
  const qC = credito.leQueda ?? 0;
  const qE = efectivo?.leQueda ?? 0;
  const ganaEfectivo = Boolean(efectivo) && qE > qC;
  const diferencia = Math.abs(qE - qC);

  /**
   * Hasta qué descuento de contado da lo mismo cobrar de una forma o de la
   * otra. ES EL NÚMERO para fijar el precio en efectivo, y hasta ahora no
   * estaba en ninguna pantalla.
   *
   * En efectivo no hay Mercado Pago, ni impuestos bancarios, ni SIRCREB. Ese
   * ahorro es lo que se puede regalar en el cartel sin perder plata. Pasado
   * ese punto el descuento sale del bolsillo de la marca.
   *
   * No es la resta de las dos tasas: el descuento también achica la base
   * sobre la que se cobra la comisión, así que se despeja
   * P(1−d)(1−te) = P(1−tc), de donde d = 1 − (1−tc)/(1−te). Con la resta
   * daría 14,1% donde el número real es 14,8%, y esas siete décimas son
   * plata en cada venta.
   */
  const tasaCredito = credito.precio > 0 ? (credito.precio - credito.leTransferimos) / credito.precio : 0;
  const tasaEfectivo =
    efectivo && efectivo.precio > 0 ? (efectivo.precio - efectivo.leTransferimos) / efectivo.precio : 0;
  const descuentoParejo =
    efectivo && tasaEfectivo < 1 ? (1 - (1 - tasaCredito) / (1 - tasaEfectivo)) * 100 : null;
  const offActual =
    efectivo && credito.precio > 0 ? ((credito.precio - efectivo.precio) / credito.precio) * 100 : null;
  const seLePasa =
    descuentoParejo !== null && offActual !== null && offActual > descuentoParejo + 0.05;
  // Sin descuento los dos precios son el mismo, y entonces el porcentaje de
  // cada columna SÍ se puede comparar derecho: la diferencia la hacen las
  // comisiones, no la base.
  const hayDescuento = offActual !== null && offActual > 0.05;

  return (
    <div className="panel-rep">
      <p className="panel-tit">{titulo}</p>

      <div className={efectivo ? "duo" : "duo solo"}>
        <Columna m={credito} costo={costo} corto="Crédito" gana={!ganaEfectivo} />
        {efectivo && <Columna m={efectivo} costo={costo} corto="Efectivo" gana={ganaEfectivo} />}
      </div>

      <p className={`panel-pie${seLePasa ? " alerta" : ""}`}>
        {!efectivo ? (
          <>Sin precio en efectivo no hay con qué comparar.</>
        ) : diferencia > 0.5 ? (
          <>
            {ganaEfectivo ? "En efectivo" : "Con tarjeta"} te quedan{" "}
            <b className={ganaEfectivo ? "verde" : undefined}>${enteros(diferencia)}</b> más por unidad.
          </>
        ) : (
          <>Te queda lo mismo con cualquiera de los dos medios de pago.</>
        )}

        {/* La pregunta que se hace sola mirando las dos columnas: «en efectivo
            el porcentaje es más alto, ¿por qué dice que conviene la tarjeta?».
            Se contesta acá en vez de dejarla para una llamada.
            Solo si los precios son distintos: con el mismo precio las dos
            tortas son del mismo tamaño y la frase sería mentira — ahí el
            porcentaje difiere por las comisiones, no por la base. */}
        {hayDescuento && efectivo && (
          <span className="chico">
            Se compara en <b>pesos</b>: el {pct1((qE / efectivo.precio) * 100)}% es sobre $
            {enteros(efectivo.precio)} y el {pct1((qC / credito.precio) * 100)}% sobre $
            {enteros(credito.precio)}.
          </span>
        )}

        {/* El número que sirve para FIJAR el precio de contado, que es lo que
            la marca viene a decidir. Va aunque todavía no haya descuento: ahí
            es justamente cuando le sirve saber hasta dónde puede llegar. */}
        {descuentoParejo !== null && descuentoParejo > 0 && (
          <span className="chico">
            <b>Hasta {pct1(descuentoParejo)}% de descuento</b> te queda lo mismo con los dos: es lo que
            te ahorrás de Mercado Pago, impuestos bancarios y retenciones cobrando en efectivo. Más que
            eso, lo ponés vos.
          </span>
        )}
      </p>
    </div>
  );
}

/** Lo único que se puede decir sin el costo: cuánto se le transfiere. */
export function PanelSinCosto({
  credito,
  efectivo,
  donde = "Mis productos",
}: {
  credito: MargenSimulado;
  efectivo?: MargenSimulado | null;
  /** Dónde se carga el costo. Cambia según de qué pantalla se lo lea. */
  donde?: string;
}) {
  return (
    <div className="panel-rep">
      <p className="panel-tit">A dónde va cada peso que paga el cliente</p>
      <div className="panel-vacio">
        {/* Por qué no hay dibujo, dicho sin rodeos: sin el costo falta
            justamente el pedazo más grande de la torta. */}
        <p>
          Sin tu costo no podemos dibujar la torta: la parte más grande es justo la que falta.
          Cargalo en <b>{donde}</b> y te mostramos cuánto ganás con cada venta, igual que lo ve WiiGo.
        </p>
        <p>
          Por ahora solo sabemos <b>cuánto te transferimos</b>:{" "}
          <b className="mono">${pesos(credito.leTransferimos)}</b> con tarjeta
          {efectivo && (
            <>
              {" "}
              y <b className="mono">${pesos(efectivo.leTransferimos)}</b> en efectivo
            </>
          )}
          .
        </p>
      </div>
    </div>
  );
}
