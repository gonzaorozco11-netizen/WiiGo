"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// `permiso` marca los ítems que NO son pantallas del catálogo general y se
// habilitan con un permiso puntual (Caja Administración, Nómina). Los que no
// lo llevan se filtran por el sistema de "pantallas" de siempre. Hace falta
// distinguirlo por ítem —y no por grupo— porque Tesorería mezcla las dos
// cosas: Caja Administración va por permiso y Gastos e Ingresos por pantalla.
type NavItem = { href: string; label: string; permiso?: "cajaAdmin" | "nomina" };
type NavGroup = { label: string; items: NavItem[] };

// Agrupado por área de trabajo (como un sistema de gestión real) en vez de
// una lista plana de 16 links — más fácil de escanear a medida que se
// agregan pantallas nuevas.
const GROUPS: NavGroup[] = [
  {
    label: "Catálogo",
    items: [
      { href: "/marcas", label: "Marcas" },
      { href: "/productos", label: "Productos" },
      { href: "/catalogo-asesor", label: "Catálogo asesor" },
    ],
  },
  {
    label: "Stock",
    items: [
      { href: "/stock", label: "Stock" },
      { href: "/reposicion", label: "Abastecimiento" },
    ],
  },
  {
    label: "Operaciones",
    items: [
      { href: "/pos", label: "POS" },
      { href: "/ficha-asistencia", label: "Ficha Asistencia" },
      { href: "/ventas", label: "Ventas" },
      { href: "/cobros-efectivo", label: "Cobros en efectivo" },
      { href: "/turnos", label: "Turnos" },
    ],
  },
  {
    label: "Base de Datos",
    items: [
      { href: "/clientes", label: "Clientes" },
      { href: "/profesionales", label: "Profesionales" },
    ],
  },
  {
    label: "Marcas y Proveedores",
    items: [
      { href: "/aprobaciones", label: "Aprobaciones" },
      { href: "/situacion-marca", label: "Situación de marca" },
      { href: "/liquidaciones", label: "Liquidaciones" },
      { href: "/proveedores", label: "Proveedores" },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/resumen-ventas", label: "Resumen de ventas" },
      { href: "/resultado-mes", label: "Estado de Resultados" },
      { href: "/rentabilidad", label: "Rentabilidad" },
    ],
  },
  {
    label: "Contabilidad",
    items: [{ href: "/iva-a-pagar", label: "IVA a pagar" }],
  },
  {
    label: "Tesorería",
    items: [
      { href: "/gastos-ingresos", label: "Gastos e Ingresos" },
      { href: "/tesoreria", label: "Caja Administración", permiso: "cajaAdmin" },
    ],
  },
  {
    label: "RR.HH.",
    items: [{ href: "/rrhh", label: "Nómina", permiso: "nomina" }],
  },
  {
    label: "Local",
    items: [
      { href: "/locales", label: "Locales" },
      { href: "/pantallas", label: "Pantallas" },
    ],
  },
  {
    label: "Equipo",
    items: [{ href: "/organizacion", label: "Organización" }],
  },
];

const SUELTO: NavItem = { href: "/configuracion", label: "Configuración" };

// Solo el Dueño (rol admin) ve esto — es la línea de tiempo de todo lo que
// se movió de plata en Fases 1 a 6, nunca delegable a un rol configurable.
const AUDITORIA: NavItem = { href: "/auditoria", label: "🔍 Auditoría" };

function clave(href: string) {
  return href.replace(/^\//, "");
}

export default function AppNav({
  pantallas,
  esAdmin,
  puedeVerCajaAdmin,
  puedeGestionarNomina,
  pendientesAprobacion = 0,
  etiquetasVencidas = 0,
}: {
  pantallas: string[] | null;
  esAdmin: boolean;
  puedeVerCajaAdmin: boolean;
  puedeGestionarNomina: boolean;
  /** Solicitudes de marcas esperando respuesta. */
  pendientesAprobacion?: number;
  /** Etiquetas cuyo precio ya cambió y el cartel todavía no. Van en rojo. */
  etiquetasVencidas?: number;
}) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // pantallas === null: sin restricción, ve todo el menú (Dueño, o un
  // operativo sin rol asignado todavía — nunca arrancar a nadie en blanco).
  const puedeVer = (href: string) => pantallas === null || pantallas.includes(clave(href));
  // Cada ítem se filtra por lo suyo: los marcados con `permiso` usan los
  // permisos puntuales que llegan del layout; el resto, el sistema de
  // pantallas. Así un grupo puede mezclar los dos tipos.
  const puedeVerItem = (item: NavItem) => {
    if (item.permiso === "cajaAdmin") return puedeVerCajaAdmin;
    if (item.permiso === "nomina") return puedeGestionarNomina;
    return puedeVer(item.href);
  };
  const grupos = GROUPS.map((g) => ({ ...g, items: g.items.filter(puedeVerItem) })).filter((g) => g.items.length > 0);

  // Cerrar el desplegable al hacer click afuera o al navegar.
  useEffect(() => {
    function alClickearAfuera(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setAbierto(null);
    }
    document.addEventListener("mousedown", alClickearAfuera);
    return () => document.removeEventListener("mousedown", alClickearAfuera);
  }, []);

  useEffect(() => setAbierto(null), [pathname]);

  function esActivo(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav ref={navRef} className="flex flex-wrap items-center gap-1">
      {grupos.map((grupo) => {
        const grupoActivo = grupo.items.some((i) => esActivo(i.href));
        const grupoAbierto = abierto === grupo.label;
        return (
          <div key={grupo.label} className="relative">
            <button
              type="button"
              onClick={() => setAbierto((actual) => (actual === grupo.label ? null : grupo.label))}
              className={`flex items-center gap-1 text-sm font-semibold px-2.5 py-1.5 rounded-lg ${
                grupoActivo || grupoAbierto ? "text-accent bg-accent-tint" : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {grupo.label}
              {/* El contador se ve desde afuera, con el grupo cerrado: nadie
                  tiene que acordarse de abrir para enterarse de que hay algo
                  esperando. En rojo si hay etiquetas vencidas, que es lo
                  único con riesgo real. */}
              {grupo.items.some((i) => i.href === "/aprobaciones") && pendientesAprobacion + etiquetasVencidas > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    etiquetasVencidas > 0 ? "bg-red-100 text-red-700" : "bg-neutral-200 text-neutral-700"
                  }`}
                >
                  {pendientesAprobacion + etiquetasVencidas}
                </span>
              )}
              <span className="text-[9px] opacity-60">▾</span>
            </button>
            {grupoAbierto && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg py-1.5 min-w-[195px] z-20">
                {grupo.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block px-3 py-2 mx-1 rounded-lg text-sm ${
                      esActivo(item.href) ? "text-accent font-semibold bg-accent-tint" : "text-neutral-700 hover:bg-neutral-50"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Link
        href={SUELTO.href}
        className={`text-sm font-semibold px-2.5 py-1.5 rounded-lg ${
          esActivo(SUELTO.href) ? "text-accent bg-accent-tint" : "text-neutral-600 hover:text-neutral-900"
        }`}
      >
        {SUELTO.label}
      </Link>
      {esAdmin && (
        <Link
          href={AUDITORIA.href}
          className={`text-sm font-semibold px-2.5 py-1.5 rounded-lg ${
            esActivo(AUDITORIA.href) ? "text-accent bg-accent-tint" : "text-neutral-600 hover:text-neutral-900"
          }`}
        >
          {AUDITORIA.label}
        </Link>
      )}
    </nav>
  );
}
