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
  sku: string | null;
  codigo_barras: string | null;
  nombre: string;
  descripcion: string | null;
  costo_informado: number | null;
  precio_venta: number | null;
  stock_minimo: number;
  stock_objetivo: number;
  puntos: number;
  imagen: string | null;
  estado: string;
  fecha_alta: string;
  fecha_actualizacion: string;
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
