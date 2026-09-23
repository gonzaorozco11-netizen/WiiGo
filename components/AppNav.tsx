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
  // Compras va primero y en orden de etapa: es un recorrido, no una lista de
  // pantallas sueltas. Cada una la usa una persona distinta.
  {
    label: "Compras",
    items: [
      { href: "/compras", label: "🛒 Órdenes de compra" },
      { href: "/compras/recepcion", label: "📥 Recepción" },
      { href: "/compras/costeo", label: "🧮 Costeo de recibidos" },
      { href: "/compras/reclamos", label: "⚠️ Reclamos" },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { href: "/productos", label: "Productos" },
      { href: "/codigos", label: "Códigos de barras" },
      { href: "/carteles", label: "Carteles de góndola" },
      { href: "/objetivos", label: "Objetivos del asesor" },
      { href: "/catalogo-asesor", label: "Catálogo asesor" },
    ],
  },
  {
    label: "Stock",
    // "Abastecimiento (marcas)" vivía acá y se fue. No era una pantalla
    // parecida a Compras: montaba LOS MISMOS modales y llamaba a LAS MISMAS
    // funciones para crear y recepcionar un pedido a una marca. Lo único
    // propio que tenía —devolverle mercadería fallada a la marca— se mudó a
    // Compras → Recepción, que es el mismo momento y la misma persona.
    items: [{ href: "/stock", label: "Stock" }],
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
  // Acá va todo lo que tenga que ver con tus contrapartes. Marcas vivía en
  // Catálogo, que es para lo que vendés — una marca no es un producto, es
  // con quién trabajás, y verla en otro grupo hacía parecer que había dos.
  {
    label: "Marcas y Proveedores",
    items: [
      // Primero del grupo: es la vista de arriba de las otras cuatro.
      { href: "/panel-proveedores", label: "Panel" },
      { href: "/proveedores", label: "Proveedores" },
      { href: "/marcas", label: "Marcas" },
      { href: "/situacion-marca", label: "Situación de marca" },
      { href: "/liquidaciones", label: "Liquidaciones" },
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
    // Era una sola entrada ("Nómina") con cinco solapas adentro. Se partió
    // porque cada una se usa en un momento distinto: la planilla todo el mes,
    // los sueldos el día 1, el legajo casi nunca.
    items: [
      { href: "/rrhh", label: "Dashboard", permiso: "nomina" },
      { href: "/rrhh/personal", label: "Personal", permiso: "nomina" },
      { href: "/rrhh/planilla", label: "Planilla", permiso: "nomina" },
      { href: "/rrhh/sueldos", label: "Sueldos", permiso: "nomina" },
      { href: "/rrhh/adelantos", label: "Adelantos", permiso: "nomina" },
    ],
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

// Mis Tareas va suelto y adelante, al lado de Inicio.
//
// Es la bandeja de entrada de cada uno: lo que tiene que hacer hoy, con su
// contador a la vista sin abrir nada. Absorbió a Aprobaciones, que era una
// parte de esto (cosas esperando respuesta) disfrazada de pantalla aparte —
// y que además nunca fue solo de marcas: junta solicitudes con etiquetas
// vencidas. A /aprobaciones se sigue llegando desde adentro de Mis Tareas.
const MIS_TAREAS: NavItem = { href: "/mis-tareas", label: "Mis Tareas" };

const SUELTO: NavItem = { href: "/configuracion", label: "Configuración" };

// Solo el Dueño (rol admin) ve esto — es la línea de tiempo de todo lo que
// se movió de plata en Fases 1 a 6, nunca delegable a un rol configurable.
const AUDITORIA: NavItem = { href: "/auditoria", label: "🔍 Auditoría" };

/**
 * De una ruta a la clave de pantalla con la que se guarda el permiso.
 *
 * Las barras van a guion porque el catálogo (lib/pantallas.ts) las guarda
 * así: `/compras/recepcion` ↔ `compras-recepcion`. Sin esta conversión, las
 * tres pantallas de Compras que tienen sub-ruta NUNCA aparecían en el menú de
 * nadie que tuviera una lista de pantallas asignada — el Dueño las veía
 * porque su lista es `null`, y por eso pasó desapercibido. Las páginas sí
 * dejaban entrar por URL, así que el permiso estaba bien: lo que fallaba era
 * solo el menú.
 */
function clave(href: string) {
  return href.replace(/^\//, "").replace(/\//g, "-");
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
      {/* Inicio va primero y suelto, no adentro de un grupo: es la pantalla a
          la que uno vuelve, y tener que abrir un desplegable para volver al
          principio es exactamente lo que nadie hace. */}
      <Link
        href="/"
        className={`text-sm font-semibold px-2.5 py-1.5 rounded-lg ${
          pathname === "/" ? "text-accent bg-accent-tint" : "text-neutral-600 hover:text-neutral-900"
        }`}
      >
        Inicio
      </Link>

      {/* Sin filtro de pantalla: todo el mundo tiene tareas, y la lista ya
          viene recortada a lo que cada uno puede ver. */}
      <Link
        href={MIS_TAREAS.href}
        className={`flex items-center gap-1.5 text-sm font-semibold px-2.5 py-1.5 rounded-lg ${
          esActivo(MIS_TAREAS.href) ? "text-accent bg-accent-tint" : "text-neutral-600 hover:text-neutral-900"
        }`}
      >
        {MIS_TAREAS.label}
        {/* El contador a la vista, sin abrir nada. En rojo si hay etiquetas
            vencidas, que es lo único con riesgo real: el precio ya cambió y
            el cartel de la góndola todavía dice otra cosa. */}
        {pendientesAprobacion + etiquetasVencidas > 0 && (
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              etiquetasVencidas > 0 ? "bg-red-100 text-red-700" : "bg-neutral-200 text-neutral-700"
            }`}
            >
            {pendientesAprobacion + etiquetasVencidas}
          </span>
        )}
      </Link>

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
