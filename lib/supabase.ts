import { createClient } from "@supabase/supabase-js";

// Server-only client. Usa la service_role key, que bypassea Row Level
// Security. Este archivo nunca debe importarse desde un Client Component —
// la clave se filtraría al navegador. Todo el acceso a Supabase pasa por
// Server Actions / Server Components, protegidos por el login en proxy.ts.
export function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Faltan las variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

export type Usuario = {
  id_usuario: string;
  nombre: string;
  email: string;
  rol: string | null;
  estado: string;
  fecha_alta: string;
  password_hash: string;
};

export type Marca = {
  id_marca: string;
  nombre: string;
  cuit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  fee_ingreso: number | null;
  royalty_porcentaje: number | null;
  fecha_ingreso: string | null;
  estado: string;
  observaciones: string | null;
  iva_royalty_porcentaje: number | null;
  trasladar_comision_cobro: boolean;
  trasladar_iva_comision: boolean;
  trasladar_sircreb: boolean;
  trasladar_imp_creditos: boolean;
  trasladar_otras_retenciones: boolean;
  trasladar_otros_costos_cobro: boolean;
  imp_debitos_porcentaje: number | null;
  trasladar_imp_debitos: boolean;
  frecuencia_liquidacion: string | null;
};

export type Subcategoria = {
  id_subcategoria: string;
  id_marca: string;
  nombre: string;
  estado: string;
};

export type Producto = {
  id_producto: string;
  id_marca: string;
  id_subcategoria: string | null;
  nombre: string;
  descripcion: string | null;
  costo_informado: number | null;
  // CONSIGNACION (la mercadería es de la marca externa, WiiGo solo cobra
  // comisión) o PROPIA (mercadería de WiiGo Dietética, costo_informado es
  // el CMV sin IVA para calcular rentabilidad) — ver módulo Liquidaciones.
  tipo_comercializacion: string;
  precio_venta: number | null;
  descuento_porcentaje: number | null;
  puntos: number;
  imagen: string | null;
  estado: string;
  fecha_alta: string;
  fecha_actualizacion: string;
};

// El SKU, código de barras y stock viven en la variante (sabor, tamaño...),
// no en el producto. Todo producto tiene al menos una (aunque no tenga
// variaciones reales, en cuyo caso queda una sola llamada "Único").
export type VarianteProducto = {
  id_variante: string;
  id_producto: string;
  nombre: string;
  sku: string | null;
  codigo_barras: string | null;
  precio_venta: number | null;
  stock_minimo: number;
  stock_objetivo: number;
  orden: number | null;
  estado: string;
};

export type Local = {
  id_local: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  estado: string;
  fecha_alta: string;
  observaciones: string | null;
};

export type Stock = {
  id_stock: string;
  id_variante: string;
  id_local: string;
  cantidad: number;
  fecha_actualizacion: string;
};

export type MovimientoStock = {
  id_movimiento: string;
  id_variante: string;
  id_local: string;
  tipo: string;
  cantidad: number;
  motivo: string | null;
  id_referencia: string | null;
  fecha: string;
  usuario: string | null;
  observaciones: string | null;
};

export type OrdenReposicion = {
  id_orden: string;
  id_marca: string;
  id_local: string;
  fecha: string;
  estado: string;
  total_unidades: number;
  observaciones: string | null;
};

export type DetalleReposicion = {
  id_detalle: string;
  id_orden: string;
  id_variante: string;
  cantidad_solicitada: number;
  cantidad_recibida: number;
  observaciones: string | null;
};

export type Recepcion = {
  id_recepcion: string;
  id_orden: string;
  id_marca: string | null;
  id_local: string | null;
  fecha: string;
  usuario: string | null;
  observaciones: string | null;
};

export type DetalleRecepcion = {
  id_detalle_recepcion: string;
  id_recepcion: string;
  id_orden: string | null;
  id_variante: string;
  cantidad_solicitada: number | null;
  cantidad_recibida: number | null;
  estado_control: string | null;
  diferencia: number | null;
  observaciones: string | null;
};

export type Cliente = {
  id_cliente: string;
  nombre: string;
  apellido: string | null;
  dni: string | null;
  email: string | null;
  telefono: string | null;
  fecha_nacimiento: string | null;
  qr: string | null;
  puntos: number;
  estado: string;
  fecha_alta: string;
};

export type Venta = {
  id_venta: string;
  numero: number;
  fecha: string;
  canal: string | null;
  id_cliente: string | null;
  id_local: string | null;
  subtotal: number | null;
  descuento: number | null;
  total: number | null;
  estado: string;
  medio_pago: string | null;
  id_pago: string | null;
  id_liquidacion: string | null;
  usuario: string | null;
  terminal: string | null;
  descuento_puntos: number;
  puntos_canjeados: number;
  puntos_generados: number;
  total_cobrado: number | null;
  motivo_cancelacion: string | null;
  fecha_cancelacion: string | null;
};

// Tabla original del esquema (pensada para liquidaciones: comisión, IVA,
// SIRCREB, conciliación con Mercado Pago, etc.) — no crear otra, reusar
// estos campos. Para Efectivo no hay comisión ni conciliación externa, así
// que esos campos quedan en null y neto_acreditado = importe_bruto.
export type Pago = {
  id_pago: string;
  id_venta: string;
  medio: string | null;
  proveedor_pago: string | null;
  importe_bruto: number | null;
  comision_porcentaje: number | null;
  comision_importe: number | null;
  iva_comision: number | null;
  sircreb: number | null;
  imp_creditos: number | null;
  otras_retenciones: number | null;
  otros_costos: number | null;
  total_descuentos_cobro: number | null;
  neto_acreditado: number | null;
  forma_pago_cliente: string | null;
  id_pago_externo: string | null;
  id_operacion_externa: string | null;
  fecha_pago: string | null;
  fecha_acreditacion: string | null;
  estado: string;
  estado_conciliacion: string | null;
  observaciones: string | null;
};

export type DetalleVenta = {
  id_detalle: string;
  id_venta: string;
  id_variante: string;
  id_marca: string | null;
  cantidad: number;
  precio_unitario: number;
  descuento: number;
  subtotal: number | null;
  puntos_generados: number;
};

export type CodigoProfesional = {
  id_codigo: string;
  id_profesional: string;
  codigo: string;
  tipo_beneficio_cliente: string | null;
  valor_beneficio_cliente: number | null;
  tipo_recompensa_profesional: string | null;
  valor_recompensa_profesional: number | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  estado: string;
  limite_usos: number | null;
  usos: number;
};

export type Objetivo = {
  id_objetivo: string;
  nombre: string;
  descripcion: string | null;
  imagen: string | null;
  orden: number | null;
  estado: string;
};

export type FiltroProducto = {
  id_filtro: string;
  nombre: string;
  tipo: string | null;
  orden: number | null;
  estado: string;
};

export type FichaProducto = {
  id_ficha: string;
  id_producto: string;
  origen: string | null;
  ingredientes: string | null;
  porcion: string | null;
  kcal_100g: number | null;
  proteinas: number | null;
  carbohidratos: number | null;
  grasas: number | null;
  fibra: number | null;
  sodio: number | null;
  micronutrientes: string | null;
  clasificacion: string | null;
  descripcion_publica: string | null;
  imagen_principal: string | null;
  video: string | null;
  estado: string;
};
