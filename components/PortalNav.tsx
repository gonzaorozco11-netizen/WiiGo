"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Menú del portal de marcas.
//
// El Tablero primero —es la pantalla de inicio y lo que la marca viene a
// mirar— y Mis tareas al lado, que es lo único accionable. El número naranja
// alcanza para llamar la atención sin tener que robarle el primer lugar.
//
// Con cuatro, un menú desplegable sería peor que cuatro links a la vista. Las
// secciones que se agreguen van acá, y cada página vuelve a controlar el plan
// del lado del servidor: esconder un link no protege nada.
const ITEMS = [
  { href: "/portal", texto: "Tablero" },
  { href: "/portal/tareas", texto: "Mis tareas" },
  { href: "/portal/calendario", texto: "Calendario" },
  { href: "/portal/productos", texto: "Mis productos" },
  { href: "/portal/cambios", texto: "Pedir un cambio" },
];

/**
 * El número al lado de "Mis tareas" es lo que trae de vuelta a la marca.
 *
 * Cuenta lo que espera algo de ella, no el total de nada: un número que no
 * baja cuando hacés algo deja de significar nada a la segunda semana.
 */
export default function PortalNav({ pendientes = 0 }: { pendientes?: number }) {
  const ruta = usePathname();

  return (
    <nav className="portal-nav">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} className={ruta === i.href ? "activa" : undefined}>
          {i.texto}
          {i.href === "/portal/tareas" && pendientes > 0 && (
            <span className="nav-pendientes">{pendientes}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
