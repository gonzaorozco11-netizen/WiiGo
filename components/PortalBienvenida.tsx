"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { BienvenidaPortal } from "@/app/portal/actions";

// La bienvenida del portal: cuatro pantallas, una idea cada una.
//
// No es un tour de globitos señalando botones. Esos sirven para un sistema que
// se usa todos los días; la marca entra una vez cada dos semanas, ve el tour,
// lo saltea y a la segunda visita no se acuerda de nada. Además se rompe cada
// vez que se mueve un botón.
//
// Esto explica el NEGOCIO, que es lo que de verdad no entienden: qué es el
// portal, cómo se reparte cada venta, cuándo cobran y qué se espera de ellos.
// Cada pantalla termina en una acción, nunca en un "Entendido".
//
// Se guarda por navegador y no en la base a propósito: a la marca la atiende
// una persona distinta cada vez, y el que entra en marzo nunca vio la pantalla
// 1. Que le vuelva a aparecer es lo que queremos. Para el que ya la vio, el
// botón "¿Cómo funciona?" la reabre cuando quiera.

const CLAVE = "wiigo_bienvenida_vista";
const PASOS = 4;

function pesos(v: number) {
  return `$${Math.round(v).toLocaleString("es-AR")}`;
}

export default function PortalBienvenida({ datos }: { datos: BienvenidaPortal | null }) {
  const [abierta, setAbierta] = useState(false);
  const [paso, setPaso] = useState(1);
  const router = useRouter();

  // En el primer render del cliente, no en el del servidor: localStorage no
  // existe del lado del servidor y el HTML tiene que coincidir.
  useEffect(() => {
    try {
      if (!localStorage.getItem(`${CLAVE}_v1`)) setAbierta(true);
    } catch {
      // Navegador con el almacenamiento bloqueado: que no se abra sola antes
      // que romper la pantalla.
    }
  }, []);

  function cerrar(irATareas: boolean) {
    try {
      localStorage.setItem(`${CLAVE}_v1`, "1");
    } catch {
      /* da igual: como mucho se vuelve a ver */
    }
    setAbierta(false);
    setPaso(1);
    if (irATareas) router.push("/portal/tareas");
  }

  if (!datos) return null;

  return (
    <>
      <button type="button" className="bv-abrir" onClick={() => setAbierta(true)}>
        ¿Cómo funciona?
      </button>

      {abierta && (
        <div className="bv-fondo" role="dialog" aria-modal="true" aria-label="Cómo funciona WiiGo">
          <div className="bv" onClick={(e) => e.stopPropagation()}>
            <div className="bv-pasos" aria-hidden="true">
              {Array.from({ length: PASOS }, (_, i) => (
                <span key={i} className={i < paso ? "hecho" : undefined} />
              ))}
              <b className="mono">{paso} de {PASOS}</b>
            </div>

            {paso === 1 && <Uno datos={datos} />}
            {paso === 2 && <Dos datos={datos} />}
            {paso === 3 && <Tres />}
            {paso === 4 && <Cuatro datos={datos} />}

            <div className="bv-pie">
              {paso === 1 ? (
                <button type="button" className="bv-saltear" onClick={() => cerrar(false)}>
                  Saltear
                </button>
              ) : (
                <button type="button" className="bv-saltear" onClick={() => setPaso(paso - 1)}>
                  ← Volver
                </button>
              )}
              {paso < PASOS ? (
                <button type="button" className="bv-seguir" onClick={() => setPaso(paso + 1)}>
                  Siguiente →
                </button>
              ) : (
                <button type="button" className="bv-seguir" onClick={() => cerrar(true)}>
                  Empezar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Uno({ datos }: { datos: BienvenidaPortal }) {
  return (
    <div className="bv-cuerpo">
      <h2>Hola, {datos.nombreMarca}</h2>
      <p className="bv-intro">
        {datos.productos > 0 ? (
          <>
            Tus <b>{datos.productos} productos</b> están en el local de WiiGo
            {datos.local ? `, en ${datos.local}` : ""}. Desde acá ves cuántos quedan en góndola,
            cuánto se vendió y cuánto te toca de cada venta.
          </>
        ) : (
          <>
            Acá vas a ver tus productos en el local de WiiGo{datos.local ? `, en ${datos.local}` : ""}:
            cuántos quedan en góndola, cuánto se vendió y cuánto te toca de cada venta.
          </>
        )}
      </p>

      <div className="bv-caja">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <div>
          <b>Nada de lo que toques acá cambia la góndola por tu cuenta</b>
          <p>
            Un precio nuevo, una foto, un producto: todo nos llega como una solicitud y lo aprobamos
            antes de que salga a la venta. Podés mirar y probar sin miedo a romper nada.
          </p>
        </div>
      </div>
    </div>
  );
}

function Dos({ datos }: { datos: BienvenidaPortal }) {
  const e = datos.ejemplo;
  if (!e) {
    return (
      <div className="bv-cuerpo">
        <h2>Cómo se reparte cada venta</h2>
        <p className="bv-intro">
          De lo que paga el cliente se descuenta la comisión de WiiGo, su IVA y lo que cobra el medio
          de pago. El resto es tuyo. Cuando tengas un producto con precio cargado, acá va a salir la
          cuenta con tus propios números.
        </p>
      </div>
    );
  }

  // La dona, con hueco entre porciones. El radio y la circunferencia van fijos
  // acá porque el SVG también lo son.
  const R = 86;
  const C = 2 * Math.PI * R;
  const HUECO = 2;
  const util = C - HUECO * e.partes.length;
  let acum = 0;

  return (
    <div className="bv-cuerpo">
      <h2>Cómo se reparte cada venta</h2>
      <p className="bv-intro">
        Tu <b>{e.nombre}</b>, pagado con tarjeta a {pesos(e.precio)}. De ahí sale todo:
      </p>

      <div className="bv-reparto">
        <div className="bv-dona">
          <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label={`De ${pesos(e.precio)}, ${e.etiquetaResultado} ${pesos(e.resultado)}`}>
            <g transform="rotate(-90 100 100)" fill="none" strokeLinecap="round" strokeWidth="22">
              {e.partes.map((p) => {
                const largo = (p.porcentaje / 100) * util;
                const offset = -acum;
                acum += largo + HUECO;
                return (
                  <circle
                    key={p.etiqueta}
                    cx="100"
                    cy="100"
                    r={R}
                    stroke={p.color}
                    strokeDasharray={`${largo} ${C - largo}`}
                    strokeDashoffset={offset}
                  />
                );
              })}
            </g>
          </svg>
          <div className="bv-dona-centro">
            <b className="mono">{pesos(e.resultado)}</b>
            <span>{e.etiquetaResultado}</span>
          </div>
        </div>

        <ul className="bv-partes">
          {e.partes.map((p) => (
            <li key={p.etiqueta} className={p.fuerte ? "fuerte" : undefined}>
              <span className="llave" style={{ background: p.color }} />
              <span className="et">{p.etiqueta}</span>
              <span className="mono v">{pesos(p.monto)}</span>
              <span className="mono pct">{p.porcentaje.toFixed(1).replace(".", ",")}%</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="bv-nota">
        {e.hayCosto ? (
          <>
            Eso es lo que te queda <b>después</b> de pagar la mercadería. Y si el cliente paga en
            efectivo no hay cobro con tarjeta ni esos impuestos, así que te queda más: por eso
            conviene tener un precio en efectivo más bajo, que lo elegís vos.
          </>
        ) : (
          <>
            Eso es lo que te giramos, <b>todavía sin descontar lo que te costó la mercadería</b>.
            Cargá tu costo en Mis productos y acá vas a ver tu ganancia de verdad.
          </>
        )}
      </p>
    </div>
  );
}

function Tres() {
  const momentos = [
    ["Se vende en el local", "Lo ves acá el mismo día, venta por venta."],
    [
      "Cerramos el período",
      "Se arma la liquidación con todo lo vendido desde el cierre anterior. Todavía no hay un día fijo: te avisamos cuando cerremos.",
    ],
    [
      "Te llega el detalle",
      "Producto por producto, con el reparto de cada venta. Si algo no cierra, se revisa antes de pagar.",
    ],
    ["Cobrás", "Por transferencia, a la cuenta que nos dejaste. Te avisamos cuando salga el pago."],
  ];

  return (
    <div className="bv-cuerpo">
      <h2>Cuándo cobrás</h2>
      <p className="bv-intro">
        Se te paga lo <b>vendido</b>, no lo entregado. Lo que sigue en góndola es tuyo.
      </p>

      <ol className="bv-linea">
        {momentos.map(([titulo, detalle], i) => (
          <li key={titulo}>
            <div className="bv-hito">
              <span className={i === momentos.length - 1 ? "punto fin" : "punto"}>
                {i === momentos.length - 1 ? "✓" : i + 1}
              </span>
              {i < momentos.length - 1 && <span className="raya" />}
            </div>
            <div>
              <b>{titulo}</b>
              <p>{detalle}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Cuatro({ datos }: { datos: BienvenidaPortal }) {
  const items = [
    {
      n: datos.sinCosto,
      clase: "rojo",
      titulo: "El costo de cada producto",
      texto:
        "Lo que te cuesta a vos. No lo ve ningún cliente: sirve para que veas tu ganancia real, y sin eso no entrás en la liquidación.",
    },
    {
      n: datos.sinFoto,
      clase: "ocre",
      titulo: "Las fotos que faltan",
      texto:
        "Cuadradas y sobre fondo blanco. Te las revisamos al subirlas. Sin foto el producto no sale en las pantallas del local.",
    },
    {
      n: datos.sinFicha,
      clase: "ocre",
      titulo: "La información nutricional",
      texto: "Lo que está impreso en el envase. Es lo que el cliente lee antes de decidir.",
    },
  ].filter((i) => i.n > 0);

  return (
    <div className="bv-cuerpo">
      <h2>Qué necesitamos de vos</h2>
      {items.length === 0 ? (
        <p className="bv-intro">
          Nada pendiente: tus productos están completos. Si cargás uno nuevo, lo que falte te va a
          aparecer en <b>Mis tareas</b>.
        </p>
      ) : (
        <>
          <p className="bv-intro">
            {items.length === 1 ? "Una cosa." : `${items.length} cosas.`} Las podemos esperar, pero no
            las podemos poner nosotros.
          </p>
          <div className="bv-items">
            {items.map((i) => (
              <div className={`bv-item ${i.clase}`} key={i.titulo}>
                <span className="n">{i.n}</span>
                <div>
                  <b>{i.titulo}</b>
                  <p>{i.texto}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
