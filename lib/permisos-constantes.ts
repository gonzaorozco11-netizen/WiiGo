// Solo datos puros (sin next/headers ni Supabase) — este archivo lo puede
// importar tanto código de servidor como componentes de cliente. La lógica
// que sí necesita leer la sesión/base vive en lib/permisos.ts.

export const PERMISOS = {
  VER_CAJA_ADMIN: "ver_caja_administracion",
  GESTIONAR_NOMINA: "gestionar_nomina",
  AUTORIZAR_GASTOS_SIN_LIMITE: "autorizar_gastos_sin_limite",
  EDITAR_CONFIGURACION: "editar_configuracion",
  EMITIR_FACTURAS: "emitir_facturas",
} as const;

export type Permiso = (typeof PERMISOS)[keyof typeof PERMISOS];

export const PERMISOS_DISPONIBLES: { clave: Permiso; label: string; descripcion: string }[] = [
  {
    clave: PERMISOS.VER_CAJA_ADMIN,
    label: "Ver Caja Administración",
    descripcion: "El efectivo consolidado de todos los cierres de turno, de todos los locales.",
  },
  {
    clave: PERMISOS.GESTIONAR_NOMINA,
    label: "Gestionar Nómina",
    descripcion: "Ver y editar sueldos base y adelantos de todos los empleados.",
  },
  {
    clave: PERMISOS.AUTORIZAR_GASTOS_SIN_LIMITE,
    label: "Autorizar gastos sin límite",
    descripcion: "Puede confirmar un gasto por encima del tope sin pedirle la clave a un admin.",
  },
  {
    clave: PERMISOS.EDITAR_CONFIGURACION,
    label: "Editar Configuración",
    descripcion: "Tasas de IVA/IIBB, comisiones de Mercado Pago, reglas de puntos, tope de gastos.",
  },
  {
    clave: PERMISOS.EMITIR_FACTURAS,
    label: "Emitir facturas",
    descripcion:
      "Facturar ventas ante ARCA. Va aparte de Configuración para poder dárselo a quien factura sin darle acceso a todo lo demás.",
  },
];
