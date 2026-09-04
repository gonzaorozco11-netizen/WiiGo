"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Menú del portal de marcas.
//
// Son dos pantallas: mirar cómo va y pedir un cambio. Con dos, un menú
// desplegable sería peor que dos links a la vista. Las secciones que se
// agreguen van acá, y cada página vuelve a controlar el plan del lado del
// servidor: esconder un link no protege nada.
const ITEMS = [
  { href: "/portal", texto: "Tablero" },
  { href: "/portal/cambios", texto: "Pedir un cambio" },
];

export default function PortalNav() {
  const ruta = usePathname();

  return (
    <nav className="portal-nav">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} className={ruta === i.href ? "activa" : undefined}>
          {i.texto}
        </Link>
      ))}
    </nav>
  );
}
