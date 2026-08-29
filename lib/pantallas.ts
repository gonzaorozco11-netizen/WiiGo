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
  { clave: "ventas", label: "Transacciones", grupo: "Ventas" },
  { clave: "cobros-efectivo", label: "Cobros en efectivo", grupo: "Ventas" },
  { clave: "clientes", label: "Clientes", grupo: "Ventas" },
  { clave: "profesionales", label: "Profesionales", grupo: "Ventas" },
  { clave: "situacion-marca", label: "Situación de marca", grupo: "Marcas y Proveedores" },
  { clave: "liquidaciones", label: "Liquidaciones", grupo: "Marcas y Proveedores" },
  { clave: "proveedores", label: "Proveedores", grupo: "Marcas y Proveedores" },
  { clave: "dashboard", label: "Dashboard", grupo: "Finanzas" },
  { clave: "gastos", label: "Gastos", grupo: "Finanzas" },
  { clave: "gastos-ingresos", label: "Gastos e Ingresos", grupo: "Finanzas" },
  { clave: "resumen-ventas", label: "Resumen de ventas", grupo: "Finanzas" },
  { clave: "resultado-mes", label: "Resultado del mes", grupo: "Finanzas" },
  { clave: "iva-a-pagar", label: "IVA a pagar", grupo: "Contabilidad" },
  { clave: "rentabilidad", label: "Rentabilidad", grupo: "Finanzas" },
  { clave: "turnos", label: "Turnos", grupo: "Local" },
  { clave: "locales", label: "Locales", grupo: "Local" },
  { clave: "pantallas", label: "Pantallas", grupo: "Local" },
  { clave: "organizacion", label: "Organización", grupo: "Equipo" },
];
