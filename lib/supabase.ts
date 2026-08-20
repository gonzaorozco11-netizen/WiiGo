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
