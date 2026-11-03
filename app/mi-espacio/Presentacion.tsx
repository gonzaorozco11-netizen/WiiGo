"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { marcarPresentacionVista } from "./actions";
import type { DatosPresentacion } from "@/lib/primerosPasos";
import { PEDIDOS_ABIERTOS_PROFESIONALES } from "@/lib/pedidosProfesional";

// La presentación de bienvenida: 5 pasos la primera vez que entra (después de
// aceptar la autorización de imagen). Se vuelve a abrir con ?presentacion=1
// («Ver de nuevo la presentación» en Inicio). Vista previa aprobada:
// https://claude.ai/artifact/RFEFyMgpwcLpXwp2odSQii

type Paso = { fondo: string; ilustracion: React.ReactNode; titulo: string; lead: string; puntos: [string, React.ReactNode][] };

function armarPasos(d: DatosPresentacion): Paso[] {
  return [
    {
      fondo: "s1",
      ilustracion: <span className="pr-emoji">🌿</span>,
      titulo: `Bienvenida a tu espacio en WiiGo, ${d.nombre}`,
      lead: "Acá manejás todo lo tuyo en WiiGo: tu ficha en la pantalla del local, tu código, tus pacientes y tu saldo.",
      puntos: [
        ["📺", <><b>Tu ficha sale en las pantallas del local</b>: los clientes te conocen y reservan turno.</>],
        ["🤝", <><b>Recomendás productos</b> y tus pacientes los consiguen en WiiGo.</>],
        ["⏱️", <>Te lleva <b>dos minutos</b> ver cómo funciona.</>],
      ],
    },
    {
      fondo: "s2",
      ilustracion: d.codigo ? <span className="pr-codigo">{d.codigo}</span> : <span className="pr-emoji">🏷️</span>,
      titulo: "Tu código",
      lead: d.codigo ? "Tus pacientes lo dicen en la caja de WiiGo, junto con su DNI." : "WiiGo te va a dar tu código: tus pacientes lo dicen en la caja, junto con su DNI.",
      puntos: [
        ["🎁", <><b>Tu paciente</b> tiene {d.pctCliente} de descuento en su primera compra.</>],
        ["💚", <><b>Vos sumás</b> {d.pctProfesional} de todo lo que compre durante {d.meses} meses, aunque no diga el código.</>],
        ["🏷️", <>Lo pagan <b>las marcas</b>, no tus pacientes.</>],
      ],
    },
    {
      fondo: "s3",
      ilustracion: <span className="pr-emoji">🪪</span>,
      titulo: "Tu ficha, en la pantalla del local",
      lead: "Es lo que ven los clientes cuando buscan una profesional.",
      puntos: [
        ["📷", <>Foto, presentación, en qué ayudás, formación y redes.</>],
        ["👀", <>A un lado editás y al otro ves <b>cómo queda en la pantalla</b>.</>],
        ["✅", <>WiiGo la revisa antes de que salga. Si algo hay que cambiar, te llega la nota.</>],
      ],
    },
    PEDIDOS_ABIERTOS_PROFESIONALES
      ? {
          fondo: "s4",
          ilustracion: <span className="pr-emoji">🛍️</span>,
          titulo: "Pedidos y tu saldo",
          lead: "Armale el pedido a tu paciente en la consulta y mandalo al local.",
          puntos: [
            ["📲", <>El local lo arma y le avisa por WhatsApp. <b>Lo paga cuando lo retira.</b></>],
            ["💳", <><b>Tu saldo</b> es en pesos y por marca: lo usás en la caja con tu DNI y tu PIN.</>],
            ["📋", <>En <b>Mis pedidos</b> ves cómo va cada uno y qué llevó cada paciente.</>],
          ],
        }
      : {
          fondo: "s4",
          ilustracion: <span className="pr-emoji">💳</span>,
          titulo: "Tu saldo y tus pacientes",
          lead: "Lo que sumás con tus pacientes queda en tu saldo, para usar en el local.",
          puntos: [
            ["💳", <><b>Tu saldo</b> es en pesos y por marca: lo usás en la caja con tu DNI y tu PIN.</>],
            ["🙋", <>Sumá pacientes desde <b>Mi saldo → Sumar paciente</b>, o cuando dicen tu código en la caja.</>],
            ["🛍️", <><b>¡Próximamente!</b> Vas a poder armarle el pedido a tu paciente y mandarlo al local.</>],
          ],
        },
    {
      fondo: "s5",
      ilustracion: <span className="pr-emoji">🏆</span>,
      titulo: "Tus objetivos y el podio del mes",
      lead: `Cada semana: pacientes con tu código, ${d.historiasSemana} historias con @wiigo.arg y un reel cada ${d.reelCadaDias} días.`,
      puntos: [
        ["⭐", <>Sumás puntos y entrás al <b>ranking del mes</b> (las demás no ven tu nombre).</>],
        ["📺", <>Las <b>3 primeras</b> salen en las pantallas del local, con pauta y repost de WiiGo.</>],
        ["❓", <>¿Dudas? Tocá <b>«¿Alguna duda?»</b>, abajo a la derecha, en cualquier pantalla.</>],
      ],
    },
  ];
}

export default function Presentacion({ datos, abrirSola }: { datos: DatosPresentacion; abrirSola: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const pedida = params.get("presentacion") === "1";
  const [abierta, setAbierta] = useState(abrirSola || pedida);
  const [i, setI] = useState(0);
  const pasos = armarPasos(datos);

  useEffect(() => {
    if (pedida) {
      setI(0);
      setAbierta(true);
    }
  }, [pedida]);

  function cerrar() {
    setAbierta(false);
    marcarPresentacionVista();
    if (pedida) router.replace(pathname);
  }

  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, pasos.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierta]);

  if (!abierta) return null;
  const p = pasos[i];
  const ultimo = i === pasos.length - 1;

  return (
    <div className="pr-fondo" role="dialog" aria-modal="true" aria-labelledby="pr-titulo">
      <div className="pr-modal">
        <div className={`pr-ilus ${p.fondo}`}>{p.ilustracion}</div>
        <div className="pr-cuerpo">
          <p className="pr-paso">
            Paso {i + 1} de {pasos.length}
          </p>
          <h2 id="pr-titulo">{p.titulo}</h2>
          <p className="pr-lead">{p.lead}</p>
          <ul className="pr-puntos">
            {p.puntos.map(([icono, texto], k) => (
              <li key={k}>
                <span className="pr-i" aria-hidden="true">
                  {icono}
                </span>
                <span>{texto}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="pr-pie">
          <div className="pr-puntitos" aria-hidden="true">
            {pasos.map((_, k) => (
              <i key={k} className={k === i ? "on" : ""} />
            ))}
          </div>
          <div className="pr-botones">
            {!ultimo && (
              <button type="button" className="pr-saltear" onClick={cerrar}>
                Saltear
              </button>
            )}
            {i > 0 && (
              <button type="button" className="pr-btn sec" onClick={() => setI(i - 1)}>
                Atrás
              </button>
            )}
            <button type="button" className="pr-btn" onClick={() => (ultimo ? cerrar() : setI(i + 1))} autoFocus>
              {ultimo ? "Empezar" : "Siguiente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
