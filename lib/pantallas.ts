// Catálogo de pantallas asignables a un rol — la clave coincide con el
// segmento de ruta (ej. "gastos" → /gastos), así se puede usar tanto para
// filtrar el menú (AppNav) como para bloquear la página directamente.
// Configuración, Usuarios/Roles y Auditoría quedan afuera a propósito: son
// siempre solo-admin, nunca delegables (ver project-wiigo-permisos).
// Caja Administración y Nómina tampoco están acá — se controlan por los
// permisos puntuales VER_CAJA_ADMIN/GESTIONAR_NOMINA, no por este catálogo.
// Ojo: "Gastos e Ingresos" vive en el grupo Tesorería del menú pero SÍ es
// una pantalla común, así que se asigna desde acá como cualquier otra.
export type PantallaDisponible = { clave: string; label: string; grupo: string };

export const PANTALLAS_DISPONIBLES: PantallaDisponible[] = [
  { clave: "marcas", label: "Marcas", grupo: "Catálogo" },
  { clave: "productos", label: "Productos", grupo: "Catálogo" },
  { clave: "catalogo-asesor", label: "Catálogo asesor", grupo: "Catálogo" },
  { clave: "stock", label: "Stock", grupo: "Stock" },
  { clave: "reposicion", label: "Abastecimiento", grupo: "Stock" },
  { clave: "pos", label: "POS", grupo: "Operaciones" },
  { clave: "ficha-asistencia", label: "Ficha Asistencia", grupo: "Operaciones" },
  { clave: "ventas", label: "Ventas", grupo: "Operaciones" },
  { clave: "cobros-efectivo", label: "Cobros en efectivo", grupo: "Operaciones" },
  { clave: "turnos", label: "Turnos", grupo: "Operaciones" },
  { clave: "gastos-ingresos", label: "Gastos e Ingresos", grupo: "Tesorería" },
  { clave: "clientes", label: "Clientes", grupo: "Base de Datos" },
  { clave: "profesionales", label: "Profesionales", grupo: "Base de Datos" },
  { clave: "aprobaciones", label: "Aprobaciones", grupo: "Marcas y Proveedores" },
  { clave: "situacion-marca", label: "Situación de marca", grupo: "Marcas y Proveedores" },
  { clave: "liquidaciones", label: "Liquidaciones", grupo: "Marcas y Proveedores" },
  { clave: "proveedores", label: "Proveedores", grupo: "Marcas y Proveedores" },
  { clave: "dashboard", label: "Dashboard", grupo: "Finanzas" },
  { clave: "resumen-ventas", label: "Resumen de ventas", grupo: "Finanzas" },
  { clave: "resultado-mes", label: "Estado de Resultados", grupo: "Finanzas" },
  { clave: "rentabilidad", label: "Rentabilidad", grupo: "Finanzas" },
  { clave: "iva-a-pagar", label: "IVA a pagar", grupo: "Contabilidad" },
  { clave: "locales", label: "Locales", grupo: "Local" },
  { clave: "pantallas", label: "Pantallas", grupo: "Local" },
  { clave: "organizacion", label: "Organización", grupo: "Equipo" },
];
