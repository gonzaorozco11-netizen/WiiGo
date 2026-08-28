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
  sueldo_base: number | null;
  permisos: string[];
  id_persona: string | null;
  areas_acceso: string[];
};

export type Area = {
  id_area: string;
  nombre: string;
  descripcion: string | null;
  orden: number;
  pantallas: string[];
  estado: string;
  fecha_creacion: string;
};

export type Puesto = {
  id_puesto: string;
  id_area: string;
  nombre: string;
  tipo: string;
  nivel: number;
  estado: string;
  fecha_creacion: string;
};

export type Persona = {
  id_persona: string;
  nombre: string;
  apellido: string | null;
  email: string | null;
  telefono: string | null;
  tipo: string;
  id_local: string | null;
  reporta_a: string | null;
  foto_url: string | null;
  estado: string;
  fecha_alta: string;
};

export type PersonaPuesto = {
  id_persona_puesto: string;
  id_persona: string;
  id_puesto: string;
  es_principal: boolean;
};

export type Marca = {
  id_marca: string;
  nombre: string;
  // CONSIGNACION (marca externa: WiiGo retiene comisión y le rinde el
  // resto) o PROPIA (WiiGo Dietética: sin rendición, se calcula
  // rentabilidad real con el costo_informado de cada producto) — ver
  // módulo Liquidaciones. Es por marca, no por producto: todos los
  // productos de una marca comparten el mismo tipo.
  tipo_comercializacion: string;
  cuit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  fee_ingreso: number | null;
  royalty_porcentaje: number | null;
  fecha_ingreso: string | null;
  estado: string;
  visible_asesor: boolean;
  logo: string | null;
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
  nombre_en: string | null;
  nombre_pt: string | null;
  descripcion: string | null;
  costo_informado: number | null;
  precio_venta: number | null;
  descuento_porcentaje: number | null;
  puntos: number;
  imagen: string | null;
  estado: string;
  visible_asesor: boolean;
  // Solo para productos de marca propia con modo LIQUIDACION_VENTA: a qué
  // proveedor se le paga el costo de lo vendido (ver liquidacionesProveedor.ts).
  id_proveedor_liquidacion: string | null;
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
  latitud: number | null;
  longitud: number | null;
};

export type Stock = {
  id_stock: string;
  id_variante: string;
  id_local: string;
  cantidad: number;
  fecha_actualizacion: string;
};

export type CategoriaGasto = {
  id_categoria: string;
  nombre: string;
  tipo_default: string;
  estado: string;
  fecha_alta: string;
};

export type SubcategoriaGasto = {
  id_subcategoria: string;
  id_categoria: string;
  nombre: string;
  estado: string;
};

// Cada egreso queda categorizado y, si salió de la caja física de un
// turno abierto, vinculado a ese turno para que el arqueo lo descuente
// solo (ver resumenTurno en app/(app)/turnos/actions.ts).
export type Gasto = {
  id_gasto: string;
  id_local: string | null;
  id_turno: string | null;
  id_categoria: string;
  id_subcategoria: string | null;
  tipo: string;
  medio_pago: string;
  monto: number;
  descripcion: string | null;
  comprobante_path: string | null;
  pendiente_factura: boolean;
  requirio_autorizacion: boolean;
  autorizado_por: string | null;
  id_usuario_adelanto: string | null;
  usuario: string | null;
  fecha: string;
};

// Libro de solo efectivo físico que administración maneja a mano — se
// nutre solo de lo que se cuenta al cerrar cada turno (ver cerrarTurno).
// Mercado Pago/transferencia nunca entra acá, ya cae directo al banco.
export type MovimientoCajaAdmin = {
  id_movimiento: string;
  tipo: string;
  monto: number;
  id_turno: string | null;
  id_gasto: string | null;
  descripcion: string | null;
  usuario: string | null;
  fecha: string;
};

export type PresupuestoGasto = {
  id_presupuesto: string;
  id_categoria: string;
  monto_mensual: number;
  fecha_actualizacion: string;
};

export type GastoRecurrente = {
  id_recurrente: string;
  id_categoria: string;
  id_subcategoria: string | null;
  id_local: string | null;
  descripcion: string;
  monto_estimado: number;
  dia_mes: number;
  activo: boolean;
  ultimo_mes_cargado: string | null;
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

// Proveedores propios de insumos/mercadería para marca propia — distinto de
// `marcas` (consignación, ver situacion-marca). La deuda hacia un proveedor
// nace recién con la factura (movimientos_cuenta_proveedor), nunca con la
// orden de compra ni con la recepción — ver lib/cuentaProveedor.ts.
export type Proveedor = {
  id_proveedor: string;
  nombre: string;
  cuit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  condicion_pago_dias: number | null;
  estado: string;
  // REMITO = factura por orden puntual. PERIODO = factura consolidada de un
  // rango de fechas (con devoluciones netas). LIQUIDACION_VENTA = se le paga
  // el costo de lo vendido, nunca de lo entregado (caso Alifrut).
  modo_facturacion: string;
  observaciones: string | null;
  fecha_alta: string;
};

// Orden de compra a un proveedor propio — es un remito, nunca tiene precio
// (eso llega recién con la factura, ver DetalleFacturaCompra más abajo).
export type OrdenCompraProveedor = {
  id_orden: string;
  id_proveedor: string;
  id_local: string;
  estado: string; // PENDIENTE / RECIBIDA / RECIBIDA_CON_DIFERENCIAS / CANCELADA
  total_unidades: number;
  observaciones: string | null;
  usuario: string | null;
  fecha_alta: string;
};

export type DetalleOrdenCompra = {
  id_detalle: string;
  id_orden: string;
  id_variante: string;
  cantidad_solicitada: number;
  cantidad_recibida: number;
};

export type RecepcionProveedor = {
  id_recepcion: string;
  id_orden: string;
  id_proveedor: string;
  id_local: string;
  usuario: string | null;
  tiene_diferencias: boolean;
  // true una vez que se cargó la factura/costo correspondiente — es lo que
  // le permite a administración ver qué recepciones todavía le faltan
  // procesar, en cualquiera de los 3 modos de facturación.
  facturada: boolean;
  revisado_por_administracion: boolean;
  resolucion_observaciones: string | null;
  observaciones: string | null;
  fecha: string;
};

export type DetalleRecepcionProveedor = {
  id_detalle: string;
  id_recepcion: string;
  id_variante: string;
  cantidad_solicitada: number;
  cantidad_recibida: number;
  estado_control: string; // COMPLETA / FALTANTE / SOBRANTE
  diferencia: number;
};

// Simple a propósito: no se ata a una recepción puntual, para que cargarla
// sea rápido. Se neteá por fecha + proveedor + producto al facturar por
// período; no tiene costo propio, nunca genera un movimiento de plata sola.
export type DevolucionProveedor = {
  id_devolucion: string;
  id_proveedor: string;
  id_local: string;
  id_variante: string;
  cantidad: number;
  fecha: string;
  motivo: string | null;
  usuario: string | null;
  facturada: boolean;
};

// Acá recién aparece el precio real — nunca antes (ver DetalleOrdenCompra y
// DetalleRecepcionProveedor, que son puro control físico sin precio).
export type FacturaCompraProveedor = {
  id_factura: string;
  id_proveedor: string;
  id_orden: string | null; // modo REMITO: a qué orden puntual corresponde
  numero_factura: string | null;
  tipo_comprobante: string | null;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  fecha_periodo_desde: string | null; // modo PERIODO: rango que consolida
  fecha_periodo_hasta: string | null;
  monto: number;
  estado: string; // PENDIENTE / PARCIAL / PAGADA / ANULADA
  comprobante_path: string | null;
  observaciones: string | null;
  usuario: string | null;
  fecha_alta: string;
};

export type DetalleFacturaCompra = {
  id_detalle: string;
  id_factura: string;
  id_variante: string;
  cantidad_facturada: number;
  precio_unitario_real: number;
  costo_anterior: number | null;
};

// Modo LIQUIDACION_VENTA (caso Alifrut): se le paga el costo de lo vendido
// en el período, nunca de lo entregado — mucho más simple que Liquidacion
// (marcas), sin royalty ni impuestos trasladados.
export type LiquidacionProveedor = {
  id_liquidacion: string;
  id_proveedor: string;
  fecha_desde: string;
  fecha_hasta: string;
  monto_calculado: number;
  monto_final: number;
  estado: string; // GENERADA / PAGADA / ANULADA
  observaciones: string | null;
  usuario: string | null;
  fecha_generacion: string;
};

export type DetalleLiquidacionProveedor = {
  id_detalle: string;
  id_liquidacion: string;
  id_variante: string;
  cantidad_vendida: number;
  costo_unitario: number;
  subtotal: number;
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
  id_turno: string | null;
};

// Turno de caja: abre un empleado con un fondo inicial de efectivo, todas
// las ventas cobradas en ese local mientras está ABIERTO quedan
// estampadas con este id, y al cerrar se hace el arqueo (efectivo
// contado vs. esperado).
export type Turno = {
  id_turno: string;
  id_local: string;
  usuario_apertura: string | null;
  fecha_apertura: string;
  monto_inicial_efectivo: number;
  usuario_cierre: string | null;
  fecha_cierre: string | null;
  estado: string;
  efectivo_esperado: number | null;
  efectivo_contado: number | null;
  diferencia_efectivo: number | null;
  total_mercado_pago: number | null;
  total_vuelto_entregado: number | null;
  total_gastos_efectivo: number | null;
  total_pagos_proveedor_efectivo: number | null;
  cantidad_ventas: number | null;
  observaciones: string | null;
};

// Tabla original del esquema (ya pensada para el detalle completo de una
// liquidación: comisión de cobro asignada, IVA asignado, SIRCREB, imp. a
// los créditos, imp. a los débitos trasladado, costo financiero WiiGo,
// etc.) — no crear otra, reusar estos campos. Todavía no completamos
// todas las columnas (algunas requieren datos que no calculamos todavía,
// como el prorrateo de imp. a los débitos de la transferencia bancaria).
export type Liquidacion = {
  id_liquidacion: string;
  id_marca: string;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  venta_bruta: number | null;
  total_retenciones: number | null;
  total_comisiones: number | null;
  royalty: number | null;
  iva_royalty: number | null;
  ajustes: number | null;
  neto_a_transferir: number | null;
  estado: string;
  fecha_pago: string | null;
  referencia_pago: string | null;
  descuentos_comerciales: number | null;
  venta_neta_marca: number | null;
  comision_cobro_asignada: number | null;
  iva_comision_asignado: number | null;
  sircreb_asignado: number | null;
  imp_creditos_asignado: number | null;
  otras_retenciones_asignadas: number | null;
  otros_costos_cobro_asignados: number | null;
  total_costos_cobro_asignados: number | null;
  royalty_porcentaje: number | null;
  iva_royalty_porcentaje: number | null;
  base_antes_transferencia: number | null;
  imp_debitos_porcentaje: number | null;
  imp_debitos_liquidacion: number | null;
  imp_debitos_trasladado_marca: number | null;
  costo_financiero_wiigo: number | null;
  neto_economico_marca: number | null;
  fecha_generacion: string;
  observaciones: string | null;
  comprobante_path: string | null;
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
  // Se estampa por línea (no en toda la venta) para que un carrito mezclando
  // productos de distintos proveedores en modo LIQUIDACION_VENTA se pueda
  // liquidar a cada uno por separado, sin que uno tape al otro.
  id_liquidacion_proveedor: string | null;
};

// tipo_beneficio_cliente/valor_beneficio_cliente/tipo_recompensa_profesional/
// valor_recompensa_profesional quedaron sin uso — ahora esos porcentajes los
// define cada marca (ver ConfigProfesionalMarca), no el código, para que un
// mismo código sirva igual en todas las marcas.
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
  fecha_creacion: string;
  observaciones: string | null;
};

export type Profesional = {
  id_profesional: string;
  nombre: string;
  apellido: string | null;
  categoria: string | null;
  titulo: string | null;
  especialidad: string | null;
  bio: string | null;
  biografia_completa: string | null;
  foto: string | null;
  email: string | null;
  telefono: string | null;
  fecha_nacimiento: string | null;
  matricula: string | null;
  tipo_atencion: string | null;
  link_reserva: string | null;
  link_reserva_online: string | null;
  ciudad: string | null;
  precio_presencial: number | null;
  precio_online: number | null;
  dni: string | null;
  estado: string;
  publicado: boolean;
  orden: number | null;
  fecha_alta: string;
  observaciones: string | null;
};

export type FortalezaProfesional = {
  id_fortaleza: string;
  nombre: string;
  orden: number | null;
  estado: string;
};

export type FormacionProfesional = {
  id_formacion: string;
  id_profesional: string;
  titulo: string;
  institucion: string | null;
  anio: number | null;
  tipo: string | null;
  descripcion: string | null;
  certificado_url: string | null;
  publico: boolean;
  orden: number | null;
  fecha_creacion: string;
};

export type FotoGaleriaProfesional = {
  id_foto: string;
  id_profesional: string;
  url: string;
  titulo: string | null;
  descripcion: string | null;
  publico: boolean;
  orden: number;
  fecha_creacion: string;
};

export type VideoProfesional = {
  id_video: string;
  id_profesional: string;
  titulo: string;
  url: string;
  orden: number;
  fecha_creacion: string;
};

export type TrayectoriaProfesional = {
  id_trayectoria: string;
  id_profesional: string;
  titulo: string;
  lugar: string | null;
  anio_desde: number | null;
  anio_hasta: number | null;
  descripcion: string | null;
  publico: boolean;
  orden: number;
  fecha_creacion: string;
};

export type TipoFilmina =
  | "foto"
  | "video"
  | "texto_foto"
  | "historia"
  | "formacion"
  | "trayectoria"
  | "fortalezas"
  | "como_trabajo"
  | "logro";

export type FilminaProfesional = {
  id_filmina: string;
  id_profesional: string;
  tipo: TipoFilmina;
  titulo: string | null;
  texto: string | null;
  id_foto: string | null;
  id_video: string | null;
  visible: boolean;
  orden: number;
  fecha_creacion: string;
};

// Versión ya resuelta de una filmina para el kiosco: la foto/video ya vienen
// como URL directa, sin que el cliente tenga que ir a buscarlas a otra tabla.
export type ConocemeSlide = {
  id_filmina: string;
  tipo: TipoFilmina;
  titulo: string | null;
  texto: string | null;
  fotoUrl: string | null;
  videoUrl: string | null;
  videoTitulo: string | null;
};

// Programa de beneficios por marca, con historial: cada cambio cierra la
// vigencia anterior (fecha_hasta) e inserta una fila nueva — nunca se pisa
// una config vieja, para que una venta pasada conserve el % que usó de verdad.
export type ConfigProfesionalMarca = {
  id_config: string;
  id_marca: string;
  participa: boolean;
  porcentaje_aporte_total: number;
  porcentaje_cliente: number;
  porcentaje_profesional: number;
  tipo_beneficio_cliente: string; // 'PUNTOS' | 'DESCUENTO'
  tipo_recompensa_profesional: string; // 'DINERO' | 'PUNTOS'
  fecha_desde: string;
  fecha_hasta: string | null;
  estado: string;
  observaciones: string | null;
  fecha_creacion: string;
};

export type ReferidoProfesional = {
  id_referido: string;
  id_venta: string;
  id_cliente: string | null;
  id_profesional: string;
  id_codigo: string;
  fecha: string;
  total_venta: number;
  beneficio_cliente: number;
  recompensa_profesional: number;
  estado: string; // 'PENDIENTE' | 'PAGADA'
  id_local: string | null;
};

export type DetalleReferidoProfesional = {
  id_detalle_referido: string;
  id_referido: string;
  id_detalle_venta: string | null;
  id_producto: string | null;
  id_marca: string;
  cantidad: number;
  precio_unitario: number;
  importe: number;
  costo_unitario: number | null;
  margen_linea: number | null;
  porcentaje_cliente_aplicado: number;
  beneficio_cliente: number;
  porcentaje_profesional_aplicado: number;
  recompensa_profesional: number;
  fecha: string;
};

export type Objetivo = {
  id_objetivo: string;
  nombre: string;
  nombre_en: string | null;
  nombre_pt: string | null;
  descripcion: string | null;
  imagen: string | null;
  orden: number | null;
  estado: string;
};

export type FiltroProducto = {
  id_filtro: string;
  nombre: string;
  nombre_en: string | null;
  nombre_pt: string | null;
  tipo: string | null;
  orden: number | null;
  estado: string;
};

export type FichaProducto = {
  id_ficha: string;
  id_producto: string;
  origen: string | null;
  origen_en: string | null;
  origen_pt: string | null;
  ingredientes: string | null;
  ingredientes_en: string | null;
  ingredientes_pt: string | null;
  porcion: string | null;
  porcion_en: string | null;
  porcion_pt: string | null;
  kcal_100g: number | null;
  proteinas: number | null;
  carbohidratos: number | null;
  grasas: number | null;
  fibra: number | null;
  sodio: number | null;
  micronutrientes: string | null;
  micronutrientes_en: string | null;
  micronutrientes_pt: string | null;
  clasificacion: string | null;
  descripcion_publica: string | null;
  descripcion_publica_en: string | null;
  descripcion_publica_pt: string | null;
  imagen_principal: string | null;
  video: string | null;
  estado: string;
  foto_extra_1: string | null;
  foto_extra_2: string | null;
  foto_extra_3: string | null;
};
