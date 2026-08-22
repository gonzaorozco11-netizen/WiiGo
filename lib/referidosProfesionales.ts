// Lógica compartida por POS y Self Checkout para códigos de profesionales.
// El código solo identifica al profesional — el % de beneficio al cliente y
// de recompensa al profesional los define cada MARCA (config_profesionales_marca),
// no el código, para que un mismo código sirva igual en todas las marcas.
// El cálculo es producto por producto según la marca de cada línea, nunca
// sobre el total de la venta — así una venta con productos de varias marcas
// reparte bien el beneficio.
import type { SupabaseClient } from "@supabase/supabase-js";

export type ItemParaReferido = {
  idVariante?: string | null;
  idDetalleVenta?: string | null;
  idProducto: string | null;
  idMarca: string | null;
  cantidad: number;
  precioUnitario: number;
  importe: number;
};

type ConfigMarca = {
  porcentaje_cliente: number;
  porcentaje_profesional: number;
  tipo_beneficio_cliente: string;
};

type LineaCalculada = {
  idMarca: string;
  idProducto: string | null;
  idVariante: string | null;
  idDetalleVenta: string | null;
  cantidad: number;
  precioUnitario: number;
  importe: number;
  porcentajeCliente: number;
  beneficioCliente: number;
  tipoBeneficioCliente: string;
  porcentajeProfesional: number;
  recompensaProfesional: number;
};

export type ResultadoCalculoReferido = {
  lineas: LineaCalculada[];
  descuentoTotal: number; // líneas con tipo_beneficio_cliente = DESCUENTO — se resta del total de la venta
  puntosExtraMonto: number; // líneas con tipo_beneficio_cliente = PUNTOS — se convierte a puntos extra después
  recompensaProfesionalTotal: number;
};

async function configVigente(supabase: SupabaseClient, idMarca: string, fecha: string): Promise<ConfigMarca | null> {
  const { data } = await supabase
    .from("config_profesionales_marca")
    .select("porcentaje_cliente, porcentaje_profesional, tipo_beneficio_cliente")
    .eq("id_marca", idMarca)
    .eq("estado", "ACTIVA")
    .eq("participa", true)
    .lte("fecha_desde", fecha)
    .or(`fecha_hasta.is.null,fecha_hasta.gte.${fecha}`)
    .order("fecha_desde", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

// Se llama ANTES de crear la venta, para saber si hay que restarle un
// descuento al total (tipo_beneficio_cliente = DESCUENTO).
export async function calcularBeneficioReferido(
  supabase: SupabaseClient,
  items: ItemParaReferido[]
): Promise<ResultadoCalculoReferido> {
  const hoy = new Date().toISOString().slice(0, 10);
  const lineas: LineaCalculada[] = [];
  let descuentoTotal = 0;
  let puntosExtraMonto = 0;
  let recompensaProfesionalTotal = 0;
  const cacheConfig = new Map<string, ConfigMarca | null>();

  for (const item of items) {
    if (!item.idMarca) continue;
    let config = cacheConfig.get(item.idMarca);
    if (config === undefined) {
      config = await configVigente(supabase, item.idMarca, hoy);
      cacheConfig.set(item.idMarca, config);
    }
    if (!config) continue; // la marca no participa del programa, o no tiene config vigente

    const beneficioCliente = Math.round(item.importe * (config.porcentaje_cliente / 100));
    const recompensaProfesional = Math.round(item.importe * (config.porcentaje_profesional / 100));

    lineas.push({
      idMarca: item.idMarca,
      idProducto: item.idProducto,
      idVariante: item.idVariante ?? null,
      idDetalleVenta: item.idDetalleVenta ?? null,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      importe: item.importe,
      porcentajeCliente: config.porcentaje_cliente,
      beneficioCliente,
      tipoBeneficioCliente: config.tipo_beneficio_cliente,
      porcentajeProfesional: config.porcentaje_profesional,
      recompensaProfesional,
    });

    if (config.tipo_beneficio_cliente === "DESCUENTO") descuentoTotal += beneficioCliente;
    else puntosExtraMonto += beneficioCliente;
    recompensaProfesionalTotal += recompensaProfesional;
  }

  return { lineas, descuentoTotal, puntosExtraMonto, recompensaProfesionalTotal };
}

// El cálculo del beneficio se hace ANTES de crear la venta (hace falta para
// saber el total a cobrar), pero detalle_ventas recién se inserta después —
// esto enlaza cada línea ya calculada con el id_detalle real, por variante.
export function enlazarDetalleVenta(
  resultado: ResultadoCalculoReferido,
  mapaVarianteADetalle: Map<string, string>
): ResultadoCalculoReferido {
  return {
    ...resultado,
    lineas: resultado.lineas.map((l) => ({
      ...l,
      idDetalleVenta: l.idVariante ? (mapaVarianteADetalle.get(l.idVariante) ?? l.idDetalleVenta) : l.idDetalleVenta,
    })),
  };
}

export async function resolverCodigoProfesional(
  supabase: SupabaseClient,
  codigoTexto: string
): Promise<{ error: string | null; idCodigo: string | null; idProfesional: string | null; usosActuales: number }> {
  const codigoLimpio = codigoTexto.trim().toUpperCase();
  if (!codigoLimpio) return { error: null, idCodigo: null, idProfesional: null, usosActuales: 0 };

  const { data: codigo } = await supabase
    .from("codigos_profesionales")
    .select("id_codigo, id_profesional, estado, fecha_desde, fecha_hasta, limite_usos, usos")
    .eq("codigo", codigoLimpio)
    .maybeSingle();
  if (!codigo) return { error: "El código de profesional no existe.", idCodigo: null, idProfesional: null, usosActuales: 0 };
  if (codigo.estado !== "ACTIVO") {
    return { error: "Este código de profesional no está activo.", idCodigo: null, idProfesional: null, usosActuales: 0 };
  }

  const hoy = new Date().toISOString().slice(0, 10);
  if (codigo.fecha_desde && codigo.fecha_desde > hoy) {
    return { error: "Este código todavía no está vigente.", idCodigo: null, idProfesional: null, usosActuales: 0 };
  }
  if (codigo.fecha_hasta && codigo.fecha_hasta < hoy) {
    return { error: "Este código ya venció.", idCodigo: null, idProfesional: null, usosActuales: 0 };
  }
  if (codigo.limite_usos != null && codigo.usos >= codigo.limite_usos) {
    return { error: "Este código llegó a su límite de usos.", idCodigo: null, idProfesional: null, usosActuales: 0 };
  }

  const { data: profesional } = await supabase
    .from("profesionales")
    .select("estado")
    .eq("id_profesional", codigo.id_profesional)
    .maybeSingle();
  if (!profesional || profesional.estado !== "ACTIVO") {
    return { error: "El profesional de este código no está activo.", idCodigo: null, idProfesional: null, usosActuales: 0 };
  }

  return { error: null, idCodigo: codigo.id_codigo, idProfesional: codigo.id_profesional, usosActuales: codigo.usos };
}

// Se llama DESPUÉS de crear la venta (recién ahí existe id_venta). No hace
// falta await del resultado desde quien la llama — si falla, no debe tirar
// abajo la venta, que ya está confirmada y cobrada.
export async function registrarReferido(
  supabase: SupabaseClient,
  params: {
    idVenta: string;
    idCliente: string | null;
    idCodigo: string;
    idProfesional: string;
    idLocal: string | null;
    usosActuales: number;
    totalVenta: number;
    resultado: ResultadoCalculoReferido;
  }
) {
  const { idVenta, idCliente, idCodigo, idProfesional, idLocal, usosActuales, totalVenta, resultado } = params;
  if (resultado.lineas.length === 0) return;

  const { data: referido, error } = await supabase
    .from("referidos_profesionales")
    .insert({
      id_venta: idVenta,
      id_cliente: idCliente,
      id_profesional: idProfesional,
      id_codigo: idCodigo,
      total_venta: totalVenta,
      beneficio_cliente: resultado.descuentoTotal + resultado.puntosExtraMonto,
      recompensa_profesional: resultado.recompensaProfesionalTotal,
      estado: "PENDIENTE",
      id_local: idLocal,
    })
    .select("id_referido")
    .single();
  if (error || !referido) return;

  const filas = resultado.lineas.map((l) => ({
    id_referido: referido.id_referido,
    id_detalle_venta: l.idDetalleVenta,
    id_producto: l.idProducto,
    id_marca: l.idMarca,
    cantidad: l.cantidad,
    precio_unitario: l.precioUnitario,
    importe: l.importe,
    porcentaje_cliente_aplicado: l.porcentajeCliente,
    beneficio_cliente: l.beneficioCliente,
    porcentaje_profesional_aplicado: l.porcentajeProfesional,
    recompensa_profesional: l.recompensaProfesional,
  }));
  await supabase.from("detalle_referidos_profesionales").insert(filas);
  await supabase.from("codigos_profesionales").update({ usos: usosActuales + 1 }).eq("id_codigo", idCodigo);
}

// Puntos extra financiados por las marcas, además de los puntos normales de
// WiiGo Club — misma tasa de conversión que la regla general (Configuración).
export async function puntosExtraPorMonto(supabase: SupabaseClient, monto: number) {
  if (monto <= 0) return 0;
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", ["PUNTOS_CADA_MONTO", "PUNTOS_OTORGADOS"]);
  const config = Object.fromEntries((data ?? []).map((r) => [r.parametro, Number(r.valor ?? 0)]));
  if (!config.PUNTOS_CADA_MONTO) return 0;
  return Math.floor((monto / config.PUNTOS_CADA_MONTO) * (config.PUNTOS_OTORGADOS ?? 0));
}
