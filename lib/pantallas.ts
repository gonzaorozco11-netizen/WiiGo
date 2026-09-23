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
  { clave: "productos", label: "Productos", grupo: "Catálogo" },
  // La operativa necesita esta pantalla para recibir mercadería nueva sin tener
  // que entrar a editar cada producto, así que se puede dar sola.
  { clave: "codigos", label: "Códigos de barras", grupo: "Catálogo" },
  // Muestra precios de venta, no costos: la puede tener el local sin ver la
  // rentabilidad de nada.
  { clave: "carteles", label: "Carteles de góndola", grupo: "Catálogo" },
  { clave: "catalogo-asesor", label: "Catálogo asesor", grupo: "Catálogo" },
  // Compras está partido en tres a propósito: cada etapa la hace una persona
  // distinta (administración pide, el local recibe, administración costea).
  // Separarlas permite darle a cada una solo su pantalla — y que la operativa
  // del local no vea costos, que con las marcas es información sensible.
  { clave: "compras", label: "Órdenes de compra", grupo: "Compras" },
  { clave: "compras-recepcion", label: "Recepción de mercadería", grupo: "Compras" },
  { clave: "compras-costeo", label: "Costeo de recibidos", grupo: "Compras" },
  // La cuarta etapa. Aparte del costeo porque acá se mueve plata: cargar una
  // nota de crédito baja la cuenta corriente y el crédito fiscal.
  { clave: "compras-reclamos", label: "Reclamos", grupo: "Compras" },
  { clave: "stock", label: "Stock", grupo: "Stock" },
  // "reposicion" (Abastecimiento de marcas) se retiró: era la misma pantalla
  // que Compras por otra puerta — montaba los mismos modales y llamaba a las
  // mismas funciones. Quien la tenía asignada ahora necesita
  // "compras-recepcion", que es donde quedó lo suyo.
  //
  // La clave puede seguir guardada en áreas viejas de la base: ahí queda
  // inerte, no rompe nada y desaparece la próxima vez que se edite el área.
  { clave: "pos", label: "POS", grupo: "Operaciones" },
  { clave: "ficha-asistencia", label: "Ficha Asistencia", grupo: "Operaciones" },
  { clave: "ventas", label: "Ventas", grupo: "Operaciones" },
  { clave: "cobros-efectivo", label: "Cobros en efectivo", grupo: "Operaciones" },
  { clave: "turnos", label: "Turnos", grupo: "Operaciones" },
  { clave: "gastos-ingresos", label: "Gastos e Ingresos", grupo: "Tesorería" },
  { clave: "clientes", label: "Clientes", grupo: "Base de Datos" },
  { clave: "profesionales", label: "Profesionales", grupo: "Base de Datos" },
  // Suelta y adelante en el menú, no adentro de un grupo: es una bandeja de
  // entrada con contador, y además junta solicitudes de marca con etiquetas
  // vencidas — no es solo cosa de marcas.
  { clave: "aprobaciones", label: "Aprobaciones", grupo: "Aprobaciones" },
  // Primero del grupo: es la vista de arriba de las otras cuatro. Pantalla
  // propia y no un bloque adentro de Proveedores porque la mitad de lo que
  // muestra es de marcas.
  { clave: "panel-proveedores", label: "Panel", grupo: "Marcas y Proveedores" },
  { clave: "proveedores", label: "Proveedores", grupo: "Marcas y Proveedores" },
  // Vivía en Catálogo, que es para lo que vendés. Una marca no es un
  // producto: es con quién trabajás. La clave no cambia, así que nadie pierde
  // el acceso — solo cambia bajo qué título se lista.
  { clave: "marcas", label: "Marcas", grupo: "Marcas y Proveedores" },
  { clave: "situacion-marca", label: "Situación de marca", grupo: "Marcas y Proveedores" },
  { clave: "liquidaciones", label: "Liquidaciones", grupo: "Marcas y Proveedores" },
  { clave: "dashboard", label: "Dashboard", grupo: "Finanzas" },
  { clave: "resumen-ventas", label: "Resumen de ventas", grupo: "Finanzas" },
  { clave: "resultado-mes", label: "Estado de Resultados", grupo: "Finanzas" },
  { clave: "rentabilidad", label: "Rentabilidad", grupo: "Finanzas" },
  { clave: "iva-a-pagar", label: "IVA a pagar", grupo: "Contabilidad" },
  { clave: "locales", label: "Locales", grupo: "Local" },
  { clave: "pantallas", label: "Pantallas", grupo: "Local" },
  { clave: "organizacion", label: "Organización", grupo: "Equipo" },
];
