"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Menú del portal de marcas.
//
// En la computadora son links en fila, que es lo que mejor funciona ahí y no
// hay motivo para tocarlo. En el celular esa fila no entraba: empujaba el
// ancho de la página y todo se movía para los costados. Abajo de 900px pasa a
// ser un panel lateral que se abre con el botón de las tres rayas.
//
// El Tablero primero —es la pantalla de inicio— y Mis tareas al lado, que es
// lo único accionable. El número naranja alcanza para llamar la atención sin
// robarle el primer lugar.
//
// Cada página vuelve a controlar el plan del lado del servidor: esconder un
// link no protege nada.
const ITEMS = [
  { href: "/portal", texto: "Tablero" },
  { href: "/portal/tareas", texto: "Mis tareas" },
  { href: "/portal/calendario", texto: "Calendario" },
  { href: "/portal/productos", texto: "Mis productos" },
  { href: "/portal/cambios", texto: "Pedir un cambio" },
  { href: "/portal/avisos", texto: "Avisos" },
];

export default function PortalNav({ pendientes = 0 }: { pendientes?: number }) {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);

  // Al cambiar de pantalla el panel se cierra solo. Si no, se toca un link y
  // queda el panel tapando la pantalla a la que se acaba de entrar.
  useEffect(() => {
    setAbierto(false);
  }, [ruta]);

  // Con el panel abierto, el fondo no se mueve: en el celular, scrollear el
  // contenido de atrás mientras el menú está abierto se siente roto.
  useEffect(() => {
    if (!abierto) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = antes;
    };
  }, [abierto]);

  return (
    <>
      <button
        type="button"
        className="nav-rayas"
        aria-label="Abrir el menú"
        aria-expanded={abierto}
        onClick={() => setAbierto(true)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        {pendientes > 0 && <span className="punto-pendiente" />}
      </button>

      {abierto && <div className="nav-fondo" onClick={() => setAbierto(false)} />}

      <nav className={`portal-nav${abierto ? " abierto" : ""}`}>
        <div className="nav-cab">
          <span>Menú</span>
          <button type="button" aria-label="Cerrar el menú" onClick={() => setAbierto(false)}>
            ✕
          </button>
        </div>

        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} className={ruta === i.href ? "activa" : undefined}>
            {i.texto}
            {i.href === "/portal/tareas" && pendientes > 0 && (
              <span className="nav-pendientes">{pendientes}</span>
            )}
          </Link>
        ))}
      </nav>
    </>
  );
}
