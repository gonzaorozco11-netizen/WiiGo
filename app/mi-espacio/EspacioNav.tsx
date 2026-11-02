"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECCIONES = [
  { href: "/mi-espacio", label: "Inicio" },
  { href: "/mi-espacio/ficha", label: "Mi ficha" },
  { href: "/mi-espacio/objetivos", label: "Objetivos" },
  // Dos solapas a propósito: en una arma, en la otra sigue lo que armó.
  { href: "/mi-espacio/pedidos", label: "Armar pedido" },
  { href: "/mi-espacio/mis-pedidos", label: "Mis pedidos" },
  { href: "/mi-espacio/saldo", label: "Mi saldo" },
];

export default function EspacioNav() {
  const pathname = usePathname();
  return (
    <nav className="esp-nav" aria-label="Tu espacio">
      {SECCIONES.map((s) => (
        <Link key={s.href} href={s.href} aria-current={pathname === s.href ? "page" : undefined}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
