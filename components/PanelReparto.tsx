"use client";

import type { MargenSimulado } from "@/lib/margenMarca";

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

type Parte = { etiqueta: string; color: string; monto: number };

/**
 * Los cinco pedazos, que suman el precio exacto.
 *
 * El IVA va junto con la comisión y no como pedazo propio: WiiGo le factura a
 * ELLA la comisión, así que cuánto IVA le toca depende de cómo facture —
 * restarle uno supuesto sería mostrarle una ganancia más chica que la real por
 * una cuenta que nadie hizo.
 */
function partes(m: MargenSimulado, costo: number): Parte[] {
  return [
    { etiqueta: "Costo mercadería", color: COLORES.prod, monto: costo },
    {
      // Sin IVA trasladado el renglón no puede decir "+ IVA": en efectivo
      // suele no cobrarse, y el nombre quedaría prometiendo una baja que no
      // está en el número de al lado.
      etiqueta: m.ivaComision > 0 ? "Comisión WiiGo + IVA" : "Comisión WiiGo",
      color: COLORES.wiigo,
      monto: m.comisionWiigo + m.ivaComision,
    },
    {
      etiqueta: "Otros costos",
      color: COLORES.banco,
      monto: m.comisionMp + m.impCreditos + m.impDebitos,
    },
    { etiqueta: "SIRCREB", color: COLORES.sircreb, monto: m.sircreb },
    { etiqueta: "Te queda a vos", color: COLORES.queda, monto: m.leQueda ?? 0 },
  ];
}

/**
 * La dona: un arco por pedazo, con un hueco entre ellos y las puntas
 * redondeadas. Pegados se leían como un solo anillo partido en vez de como
 * cinco cosas distintas; el aro gris de atrás sostiene el círculo cuando algún
 * pedazo da cero.
 */
function Dona({ partes, centro, flojo }: { partes: Parte[]; centro: string; flojo: boolean }) {
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
        <Dona partes={todos} centro={`$${enteros(queda)}`} flojo={flojo} />
        <div className="detalle-gasto">
          <p className="sale">Lo que sale</p>
          <ul>
            {salen.map((p) => (
              <li key={p.etiqueta}>
                <i className="llave" style={{ background: p.color }} />
                <span>{p.etiqueta}</span>
                <b>${enteros(p.monto)}</b>
              </li>
            ))}
          </ul>
          {esEfectivo && m.comisionMp === 0 && m.sircreb === 0 && (
            <p className="porque">
              Sin Mercado Pago, sin impuestos bancarios y sin SIRCREB: esa plata no pasa por el banco.
            </p>
          )}
        </div>
      </div>

      <p className="cierre">
        De los <b className="mono">${enteros(m.precio)}</b> que paga el cliente, te queda el{" "}
        <b className={flojo ? "rojo" : "verde"}>{pct1(sobrePrecio)}%</b>.
      </p>
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

  return (
    <div className="panel-rep">
      <p className="panel-tit">{titulo}</p>

      <div className={efectivo ? "duo" : "duo solo"}>
        <Columna m={credito} costo={costo} corto="Crédito" gana={!ganaEfectivo} />
        {efectivo && <Columna m={efectivo} costo={costo} corto="Efectivo" gana={ganaEfectivo} />}
      </div>

      <p className="panel-pie">
        {!efectivo ? (
          <>Sin precio en efectivo no hay con qué comparar. </>
        ) : diferencia > 0.5 ? (
          <>
            {ganaEfectivo ? "En efectivo" : "Con tarjeta"} te quedan{" "}
            <b className={ganaEfectivo ? "verde" : undefined}>${enteros(diferencia)}</b> más por unidad.{" "}
          </>
        ) : (
          <>Te queda lo mismo con cualquiera de los dos medios de pago. </>
        )}
        <span className="chico">
          De lo que te queda todavía salen <b>tus impuestos y tus gastos</b> —tu IVA según cómo
          facturás, Ingresos Brutos, alquiler, sueldos— que WiiGo no conoce y no calcula.
        </span>
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
