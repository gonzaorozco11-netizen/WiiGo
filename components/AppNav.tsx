"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/marcas", label: "Marcas" },
  { href: "/productos", label: "Productos" },
  { href: "/stock", label: "Stock" },
  { href: "/reposicion", label: "Abastecimiento" },
  { href: "/turnos", label: "Turnos" },
  { href: "/gastos", label: "Gastos" },
  { href: "/cobros-efectivo", label: "Cobros en efectivo" },
  { href: "/ventas", label: "Ventas" },
  { href: "/liquidaciones", label: "Liquidaciones" },
  { href: "/rentabilidad", label: "Rentabilidad" },
  { href: "/pos", label: "Vender" },
  { href: "/clientes", label: "Clientes" },
  { href: "/locales", label: "Locales" },
  { href: "/catalogo-asesor", label: "Catálogo asesor" },
  { href: "/usuarios", label: "Usuarios", soloAdmin: true },
  { href: "/configuracion", label: "Configuración" },
];

export default function AppNav({ rol }: { rol: string | null }) {
  const pathname = usePathname();
  const items = ITEMS.filter((item) => !item.soloAdmin || rol === "admin");

  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map((item) => {
        const activo = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              activo
                ? "text-sm font-semibold text-accent"
                : "text-sm text-neutral-600 hover:text-neutral-900"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
