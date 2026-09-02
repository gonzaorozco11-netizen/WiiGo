"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Menú del portal de marcas. Las secciones que no entran en el plan no se
// listan — y además cada página vuelve a controlar el plan del lado del
// servidor, porque esconder un link no protege nada.
export default function PortalNav({
  verAnalisis,
  verInteligencia,
}: {
  verAnalisis: boolean;
  verInteligencia: boolean;
}) {
  const pathname = usePathname();

  // Por ahora solo está el resumen. Las secciones que faltan se agregan acá
  // a medida que se construyen, para no dejar links que lleven a un 404.
  const items = [
    { href: "/portal", label: "Resumen", mostrar: true },
    { href: "/portal/productos", label: "Productos", mostrar: verAnalisis && false },
    { href: "/portal/analisis", label: "Análisis", mostrar: verInteligencia && false },
  ].filter((i) => i.mostrar);

  if (items.length < 2) return null;

  return (
    <nav className="flex flex-wrap gap-x-1 gap-y-1 mt-4 -mb-1">
      {items.map((i) => {
        const activo = i.href === "/portal" ? pathname === "/portal" : pathname.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`text-sm font-medium px-3 py-1.5 rounded-lg ${
              activo ? "bg-accent-tint text-accent" : "text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
            }`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
