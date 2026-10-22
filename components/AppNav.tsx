"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/login/actions";

// Menú lateral del sistema interno.
//
// Antes era una barra arriba con desplegables: con doce categorías ocupaba
// dos renglones y cada desplegable tapaba la pantalla. Ahora es una columna a
// la izquierda: tocás una categoría y sus pantallas se despliegan abajo. Se
// abre una sola a la vez (al abrir otra, la anterior se cierra) para que el
// menú no se haga largo, y la categoría de la pantalla en la que estás
// aparece abierta sola. En la tablet y el celular se esconde y se abre con el
// botón de las tres rayas.

// `permiso` marca los ítems que NO son pantallas del catálogo general y se
// habilitan con un permiso puntual (Caja Administración, Nómina). Los que no
// lo llevan se filtran por el sistema de "pantallas" de siempre. Hace falta
// distinguirlo por ítem —y no por grupo— porque Tesorería mezcla las dos
// cosas: Caja Administración va por permiso y Gastos e Ingresos por pantalla.
type NavItem = { href: string; label: string; permiso?: "cajaAdmin" | "nomina" };
type NavGroup = { label: string; icono: keyof typeof ICONOS; items: NavItem[] };

// Trazos de los íconos (24 × 24, línea). Uno por categoría, para encontrarla
// de un vistazo sin leer.
const ICONOS = {
  inicio: "M3 11 12 4l9 7M5 10v10h14V10",
  tareas: "M9 11l2 2 4-4M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z",
  compras: "M6 7h15l-1.5 8.5a2 2 0 0 1-2 1.5H9a2 2 0 0 1-2-1.6L5 3H3M9 20.5h.01M17 20.5h.01",
  catalogo: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01",
  stock: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  operaciones: "M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 21h10M12 17v4",
  base: "M4 5c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  marcas: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  finanzas: "M3 3v18h18M7 15l4-4 3 3 5-6",
  contabilidad: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 7h6M9 11h6M9 15h3",
  tesoreria: "M4 6h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM2 10h20M16 15h.01",
  rrhh: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a8 8 0 0 1 16 0v1",
  local: "M3 9l1.5-5h15L21 9M4 9v11h16V9M3 9h18M10 20v-6h4v6",
  equipo: "M12 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM5 21.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM19 21.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 7.5v4M12 11.5 6.5 17M12 11.5l5.5 5.5",
  configuracion: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  auditoria: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
} as const;

// Agrupado por área de trabajo (como un sistema de gestión real) en vez de
// una lista plana de links — más fácil de escanear a medida que se agregan
// pantallas nuevas.
const GROUPS: NavGroup[] = [
  // Compras va primero y en orden de etapa: es un recorrido, no una lista de
  // pantallas sueltas. Cada una la usa una persona distinta.
  {
    label: "Compras",
    icono: "compras",
    items: [
      { href: "/compras", label: "Órdenes de compra" },
      { href: "/compras/recepcion", label: "Recepción" },
      { href: "/compras/costeo", label: "Costeo de recibidos" },
      { href: "/compras/reclamos", label: "Reclamos" },
    ],
  },
  {
    label: "Catálogo",
    icono: "catalogo",
    items: [
      { href: "/productos", label: "Productos" },
      { href: "/codigos", label: "Códigos de barras" },
      { href: "/carteles", label: "Carteles de góndola" },
      { href: "/objetivos", label: "Objetivos del asesor" },
      { href: "/catalogo-asesor", label: "Catálogo asesor" },
      // Estudiar los productos, y aprobar lo que escribe la IA para eso.
      { href: "/aprender", label: "Aprender" },
      { href: "/aprender/revisar", label: "Aprender: revisar" },
    ],
  },
  {
    label: "Stock",
    icono: "stock",
    // "Abastecimiento (marcas)" vivía acá y se fue: montaba los mismos modales
    // que Compras. Lo único propio —devolverle mercadería fallada a la marca—
    // se mudó a Compras → Recepción.
    items: [
      { href: "/stock", label: "Stock" },
      // Solo consulta (precio y cuánto hay), para el equipo del local.
      { href: "/stock/consulta", label: "Precio y stock" },
      // Cuánto tiene que haber, no cuánto hay. Al lado de Stock porque se
      // miran juntas.
      { href: "/stock/objetivos", label: "Mínimos y objetivos" },
    ],
  },
  {
    label: "Operaciones",
    icono: "operaciones",
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
    icono: "base",
    items: [
      { href: "/clientes", label: "Clientes" },
      { href: "/profesionales", label: "Profesionales" },
    ],
  },
  // Todo lo que tenga que ver con tus contrapartes. Una marca no es un
  // producto: es con quién trabajás.
  {
    label: "Marcas y Proveedores",
    icono: "marcas",
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
    icono: "finanzas",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/resumen-ventas", label: "Resumen de ventas" },
      { href: "/resultado-mes", label: "Estado de Resultados" },
      { href: "/rentabilidad", label: "Rentabilidad" },
    ],
  },
  {
    label: "Contabilidad",
    icono: "contabilidad",
    items: [{ href: "/iva-a-pagar", label: "IVA a pagar" }],
  },
  {
    label: "Tesorería",
    icono: "tesoreria",
    items: [
      { href: "/gastos-ingresos", label: "Gastos e Ingresos" },
      { href: "/tesoreria", label: "Caja Administración", permiso: "cajaAdmin" },
    ],
  },
  {
    label: "RR.HH.",
    icono: "rrhh",
    // En el orden en que se usan: cómo viene el mes, quién es cada uno,
    // quién vino, y con eso cerrar y pagar (adelantos y aguinaldo adentro).
    items: [
      { href: "/rrhh", label: "Tablero", permiso: "nomina" },
      { href: "/rrhh/legajos", label: "Legajos", permiso: "nomina" },
      { href: "/rrhh/asistencia", label: "Asistencia", permiso: "nomina" },
      { href: "/rrhh/sueldos", label: "Sueldos", permiso: "nomina" },
    ],
  },
  {
    label: "Local",
    icono: "local",
    items: [
      { href: "/locales", label: "Locales" },
      { href: "/pantallas", label: "Pantallas" },
      // Va en Local y no en Marcas porque es lo que pasa en el salón.
      { href: "/calendario", label: "Calendario" },
    ],
  },
  {
    label: "Equipo",
    icono: "equipo",
    items: [{ href: "/organizacion", label: "Organización" }],
  },
];

/**
 * De una ruta a la clave de pantalla con la que se guarda el permiso.
 *
 * Las barras van a guion porque el catálogo (lib/pantallas.ts) las guarda
 * así: `/compras/recepcion` ↔ `compras-recepcion`. Sin esta conversión, las
 * pantallas de Compras con sub-ruta NUNCA aparecían en el menú de nadie que
 * tuviera una lista de pantallas asignada.
 */
function clave(href: string) {
  return href.replace(/^\//, "").replace(/\//g, "-");
}

function Icono({ nombre, className = "" }: { nombre: keyof typeof ICONOS; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`w-[18px] h-[18px] shrink-0 ${className}`}
    >
      <path d={ICONOS[nombre]} />
    </svg>
  );
}

/**
 * Qué ítem del menú corresponde a la pantalla abierta.
 *
 * Gana el href más largo que coincide: en /compras/recepcion coinciden
 * "/compras" y "/compras/recepcion", y tiene que quedar marcada la segunda.
 * Con "empieza con" a secas quedaban marcadas las dos.
 */
function itemActivo(pathname: string): { grupo: string | null; item: NavItem } | null {
  let mejor: { grupo: string | null; item: NavItem } | null = null;
  const candidatos: { grupo: string | null; item: NavItem }[] = [
    ...GROUPS.flatMap((g) => g.items.map((item) => ({ grupo: g.label, item }))),
    { grupo: null, item: { href: "/mis-tareas", label: "Mis Tareas" } },
    { grupo: null, item: { href: "/configuracion", label: "Configuración" } },
    { grupo: null, item: { href: "/auditoria", label: "Auditoría" } },
  ];
  for (const c of candidatos) {
    const coincide = pathname === c.item.href || pathname.startsWith(`${c.item.href}/`);
    if (coincide && (!mejor || c.item.href.length > mejor.item.href.length)) mejor = c;
  }
  return mejor;
}

export default function AppNav({
  pantallas,
  esAdmin,
  puedeVerCajaAdmin,
  puedeGestionarNomina,
  puedeEditarConfiguracion,
  pendientesAprobacion = 0,
  etiquetasVencidas = 0,
  nombre,
}: {
  pantallas: string[] | null;
  esAdmin: boolean;
  puedeVerCajaAdmin: boolean;
  puedeGestionarNomina: boolean;
  /** Configuración no está en el catálogo de pantallas: la abre el admin o
   *  quien tenga el permiso puntual de editarla (ver configuracion/page.tsx). */
  puedeEditarConfiguracion: boolean;
  /** Solicitudes de marcas esperando respuesta. */
  pendientesAprobacion?: number;
  /** Etiquetas cuyo precio ya cambió y el cartel todavía no. Van en rojo. */
  etiquetasVencidas?: number;
  /** Quién está adentro, para el pie del menú. */
  nombre: string | null;
}) {
  const pathname = usePathname();
  const activo = itemActivo(pathname);
  // La categoría de la pantalla abierta arranca desplegada.
  const [abierto, setAbierto] = useState<string | null>(activo?.grupo ?? null);
  // En la tablet y el celular el menú es un cajón que se abre con un botón.
  const [cajon, setCajon] = useState(false);

  // Al navegar: se cierra el cajón y se despliega la categoría de la pantalla
  // nueva (si el link vino de otro lado, por ejemplo desde el inicio).
  useEffect(() => {
    setCajon(false);
    const grupo = itemActivo(pathname)?.grupo ?? null;
    if (grupo) setAbierto(grupo);
  }, [pathname]);

  // pantallas === null: sin restricción, ve todo el menú (Dueño, o un
  // operativo sin rol asignado todavía — nunca arrancar a nadie en blanco).
  const puedeVer = (href: string) => pantallas === null || pantallas.includes(clave(href));
  const puedeVerItem = (item: NavItem) => {
    if (item.permiso === "cajaAdmin") return puedeVerCajaAdmin;
    if (item.permiso === "nomina") return puedeGestionarNomina;
    return puedeVer(item.href);
  };
  const grupos = GROUPS.map((g) => ({ ...g, items: g.items.filter(puedeVerItem) })).filter((g) => g.items.length > 0);
  const contador = pendientesAprobacion + etiquetasVencidas;

  const claseLink = (marcado: boolean) =>
    `flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-sm font-semibold text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
      marcado ? "bg-accent-tint text-accent" : "text-neutral-800 hover:bg-neutral-100"
    }`;

  const menu = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        {/* El logo lleva al inicio: es lo primero que toca cualquiera para
            volver. Sin la bajada ("estaciones de bienestar"): acá adentro
            entra el equipo todos los días y ya sabe qué es WiiGo. */}
        <Link href="/" className="hover:opacity-70 transition-opacity" aria-label="Ir al inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wiigo-wordmark.png" alt="WiiGo" className="h-7 w-auto block" />
        </Link>
        <button
          type="button"
          onClick={() => setCajon(false)}
          className="lg:hidden text-2xl leading-none text-neutral-500 px-2"
          aria-label="Cerrar menú"
        >
          ×
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3" aria-label="Menú principal">
        {/* Inicio va primero y suelto: es la pantalla a la que uno vuelve. */}
        <Link href="/" className={claseLink(pathname === "/")}>
          <Icono nombre="inicio" className={pathname === "/" ? "text-accent" : "text-neutral-500"} />
          Inicio
        </Link>
        {/* Sin filtro de pantalla: todo el mundo tiene tareas, y la lista ya
            viene recortada a lo que cada uno puede ver. */}
        <Link href="/mis-tareas" className={`mt-0.5 ${claseLink(activo?.item.href === "/mis-tareas")}`}>
          <Icono nombre="tareas" className={activo?.item.href === "/mis-tareas" ? "text-accent" : "text-neutral-500"} />
          Mis Tareas
          {/* El contador a la vista, sin abrir nada. En rojo si hay etiquetas
              vencidas: el precio ya cambió y el cartel todavía dice otra cosa. */}
          {contador > 0 && (
            <span
              className={`ml-auto text-[10.5px] font-bold px-1.5 py-0.5 rounded-full ${
                etiquetasVencidas > 0 ? "bg-red-100 text-red-700" : "bg-neutral-200 text-neutral-700"
              }`}
            >
              {contador}
            </span>
          )}
        </Link>

        <div className="h-px bg-neutral-200 mx-2.5 my-2.5" />

        {grupos.map((grupo) => {
          const estaAbierto = abierto === grupo.label;
          const tieneActivo = activo?.grupo === grupo.label;
          return (
            <div key={grupo.label}>
              <button
                type="button"
                onClick={() => setAbierto((a) => (a === grupo.label ? null : grupo.label))}
                aria-expanded={estaAbierto}
                className={claseLink(false)}
              >
                <Icono nombre={grupo.icono} className={estaAbierto || tieneActivo ? "text-accent" : "text-neutral-500"} />
                {grupo.label}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  aria-hidden="true"
                  className={`ml-auto w-3.5 h-3.5 text-neutral-400 transition-transform ${estaAbierto ? "rotate-90" : ""}`}
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
              {estaAbierto && (
                <ul className="ml-[19px] mb-1.5 mt-0.5">
                  {grupo.items.map((item) => {
                    const marcado = activo?.item.href === item.href;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`block pl-4 pr-2.5 py-1.5 text-[13.5px] rounded-r-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            marcado
                              ? "border-l-2 border-accent bg-accent-tint text-accent font-semibold"
                              : "border-l border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
                          }`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-neutral-200 px-2.5 py-2.5">
        {puedeEditarConfiguracion && (
          <Link href="/configuracion" className={claseLink(activo?.item.href === "/configuracion")}>
            <Icono nombre="configuracion" className={activo?.item.href === "/configuracion" ? "text-accent" : "text-neutral-500"} />
            Configuración
          </Link>
        )}
        {/* Solo el Dueño: la línea de tiempo de todo lo que se movió de plata,
            nunca delegable. */}
        {esAdmin && (
          <Link href="/auditoria" className={`mt-0.5 ${claseLink(activo?.item.href === "/auditoria")}`}>
            <Icono nombre="auditoria" className={activo?.item.href === "/auditoria" ? "text-accent" : "text-neutral-500"} />
            Auditoría
          </Link>
        )}
        <div className="flex items-center gap-2.5 px-2.5 pt-2.5 mt-1">
          <span className="w-8 h-8 rounded-full bg-accent-tint text-accent grid place-items-center text-xs font-bold shrink-0">
            {iniciales(nombre)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-neutral-900 truncate">{nombre ?? ""}</span>
            <span className="block text-xs text-neutral-400">{esAdmin ? "Dueño" : "Operativo"}</span>
          </span>
          <form action={logout}>
            <button className="text-xs text-neutral-500 hover:text-neutral-900" type="submit">
              Salir
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Tablet y celular: barra arriba con el botón que abre el menú. */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 bg-white border-b border-neutral-200 px-4 py-2.5 print:hidden">
        <button
          type="button"
          onClick={() => setCajon(true)}
          className="w-10 h-9 grid place-items-center rounded-lg border border-neutral-200 text-neutral-700"
          aria-label="Abrir menú"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-5 h-5" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Link href="/" aria-label="Ir al inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wiigo-wordmark.png" alt="WiiGo" className="h-6 w-auto block" />
        </Link>
        {contador > 0 && (
          <Link
            href="/mis-tareas"
            className={`ml-auto text-xs font-bold px-2 py-1 rounded-full ${
              etiquetasVencidas > 0 ? "bg-red-100 text-red-700" : "bg-neutral-200 text-neutral-700"
            }`}
          >
            {contador} pendientes
          </Link>
        )}
      </div>

      {/* Computadora: columna fija a la izquierda. */}
      <aside className="hidden lg:block w-60 shrink-0 sticky top-0 h-screen bg-white border-r border-neutral-200 print:hidden">
        {menu}
      </aside>

      {/* Cajón de la tablet y el celular. */}
      {cajon && (
        <div className="lg:hidden fixed inset-0 z-40 print:hidden">
          <button type="button" className="absolute inset-0 bg-black/35" aria-label="Cerrar menú" onClick={() => setCajon(false)} />
          <aside className="absolute top-0 bottom-0 left-0 w-[82%] max-w-[300px] bg-white shadow-2xl">{menu}</aside>
        </div>
      )}
    </>
  );
}

function iniciales(nombre: string | null) {
  if (!nombre) return "·";
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "·";
}

/** Dónde estás, arriba del contenido: "Operaciones › Ventas". */
export function MigaDePan() {
  const pathname = usePathname();
  const activo = itemActivo(pathname);
  if (pathname === "/" || !activo) return null;
  return (
    <p className="text-xs text-neutral-400 mb-3 print:hidden">
      {activo.grupo && <>{activo.grupo} › </>}
      <span className="font-semibold text-neutral-500">{activo.item.label}</span>
    </p>
  );
}
