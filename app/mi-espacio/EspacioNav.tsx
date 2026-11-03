"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PEDIDOS_ABIERTOS_PROFESIONALES } from "@/lib/pedidosProfesional";

const SECCIONES = [
  { href: "/mi-espacio", label: "Inicio" },
  { href: "/mi-espacio/ficha", label: "Mi ficha" },
  { href: "/mi-espacio/objetivos", label: "Objetivos" },
  // Dos solapas a propósito: en una arma, en la otra sigue lo que armó.
  // Mientras los pedidos están cerrados, una sola con «Pronto».
  ...(PEDIDOS_ABIERTOS_PROFESIONALES
    ? [
        { href: "/mi-espacio/pedidos", label: "Armar pedido" },
        { href: "/mi-espacio/mis-pedidos", label: "Mis pedidos" },
      ]
    : [{ href: "/mi-espacio/pedidos", label: "Pedidos", pronto: true }]),
  { href: "/mi-espacio/saldo", label: "Mi saldo" },
];

export default function EspacioNav() {
  const pathname = usePathname();
  return (
    <nav className="esp-nav" aria-label="Tu espacio">
      {SECCIONES.map((s) => (
        <Link key={s.href} href={s.href} aria-current={pathname === s.href ? "page" : undefined}>
          {s.label}
          {"pronto" in s && s.pronto && <span className="pronto">Pronto</span>}
        </Link>
      ))}
    </nav>
  );
}
