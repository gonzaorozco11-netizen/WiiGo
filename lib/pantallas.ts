// Catálogo de pantallas asignables a un rol — la clave coincide con el
// segmento de ruta (ej. "gastos" → /gastos), así se puede usar tanto para
// filtrar el menú (AppNav) como para bloquear la página directamente.
// Configuración, Usuarios/Roles y Auditoría quedan afuera a propósito: son
// siempre solo-admin, nunca delegables (ver project-wiigo-permisos).
export type PantallaDisponible = { clave: string; label: string; grupo: string };

export const PANTALLAS_DISPONIBLES: PantallaDisponible[] = [
  { clave: "marcas", label: "Marcas", grupo: "Catálogo" },
  { clave: "productos", label: "Productos", grupo: "Catálogo" },
  { clave: "catalogo-asesor", label: "Catálogo asesor", grupo: "Catálogo" },
  { clave: "stock", label: "Stock", grupo: "Stock" },
  { clave: "reposicion", label: "Abastecimiento", grupo: "Stock" },
  { clave: "pos", label: "Vender", grupo: "Ventas" },
  { clave: "ventas", label: "Ventas", grupo: "Ventas" },
  { clave: "clientes", label: "Clientes", grupo: "Ventas" },
  { clave: "profesionales", label: "Profesionales", grupo: "Ventas" },
  { clave: "dashboard", label: "Dashboard", grupo: "Finanzas" },
  { clave: "gastos", label: "Gastos", grupo: "Finanzas" },
  { clave: "cobros-efectivo", label: "Cobros en efectivo", grupo: "Finanzas" },
  { clave: "liquidaciones", label: "Liquidaciones", grupo: "Finanzas" },
  { clave: "situacion-marca", label: "Situación de marca", grupo: "Finanzas" },
  { clave: "rentabilidad", label: "Rentabilidad", grupo: "Finanzas" },
  { clave: "turnos", label: "Turnos", grupo: "Local" },
  { clave: "locales", label: "Locales", grupo: "Local" },
  { clave: "pantallas", label: "Pantallas", grupo: "Local" },
  { clave: "organizacion", label: "Organización", grupo: "Equipo" },
];
