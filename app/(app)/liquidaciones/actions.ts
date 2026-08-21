"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import type { SupabaseClient } from "@supabase/supabase-js";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

// Coincide con `pagos.forma_pago_cliente` (ver cobros-efectivo/actions.ts)
// y con las tasas cargadas en Configuración → Comisión de Mercado Pago —
// no hay una sola comisión de MP, varía según cómo pagó el cliente.
const CLAVE_COMISION_MP: Record<string, string> = {
  DINERO_CUENTA: "MP_COMISION_DINERO_CUENTA",
  DEBITO: "MP_COMISION_DEBITO",
  CUOTAS_SIN_INTERES: "MP_COMISION_CUOTAS_SIN_INTERES",
  PREPAGA: "MP_COMISION_PREPAGA",
  CREDITO: "MP_COMISION_CREDITO",
};

async function tasasGenerales(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", ["IMP_CREDITOS_PORCENTAJE", ...Object.values(CLAVE_COMISION_MP)]);
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.parametro, Number(r.valor ?? 0)]));
  return {
    impCreditos: cfg.IMP_CREDITOS_PORCENTAJE ?? 0,
    mpComisionPorFormaPago: Object.fromEntries(
      Object.entries(CLAVE_COMISION_MP).map(([forma, clave]) => [forma, cfg[clave] ?? 0])
    ) as Record<string, number>,
  };
}

export type LineaRendicion = {
  idDetalle: string;
  fecha: string;
  numeroVenta: number;
  producto: string;
  cantidad: number;
  medioPago: string | null;
  formaPagoMp: string | null;
  ventaBruta: number;
  comisionWiigo: number;
  ivaComision: number;
  impCreditos: number;
  feeMp: number;
  netoARendir: number;
};

function vacioResumen() {
  return {
    ventaBruta: 0,
    comisionWiigo: 0,
    ivaComision: 0,
    impCreditos: 0,
    feeMp: 0,
    netoARendir: 0,
    netoEfectivo: 0,
    netoTransferencia: 0,
  };
}

type VentaMinima = {
  id_venta: string;
  numero: number;
  fecha: string;
  medio_pago: string | null;
  id_pago: string | null;
};

// Motor de cálculo compartido: dada una marca y un conjunto ya filtrado de
// ventas (pendientes de rendir, o las de una liquidación ya cerrada),
// arma el detalle línea por línea con las deducciones. El royalty y el
// IVA sobre royalty salen de la ficha de la marca; las tasas generales
// (Imp. a los Créditos, comisión MP), de Configuración.
async function construirLineas(supabase: SupabaseClient, idMarca: string, ventasFiltradas: VentaMinima[]) {
  const { data: marca, error: errorMarca } = await supabase
    .from("marcas")
    .select("nombre, royalty_porcentaje, iva_royalty_porcentaje, trasladar_iva_comision, trasladar_comision_cobro")
    .eq("id_marca", idMarca)
    .maybeSingle();
  if (errorMarca) throw new Error(friendlyDbError(errorMarca));
  if (!marca) throw new Error("No se encontró la marca");

  if (ventasFiltradas.length === 0) return { marca: marca.nombre, lineas: [] as LineaRendicion[], resumen: vacioResumen() };

  const tasas = await tasasGenerales(supabase);
  const royalty = marca.royalty_porcentaje ?? 0;
  const ivaRoyalty = marca.trasladar_iva_comision ? marca.iva_royalty_porcentaje ?? 0 : 0;
  const ventaPorId = new Map(ventasFiltradas.map((v) => [v.id_venta, v]));

  const { data: detalle, error: errorDetalle } = await supabase
    .from("detalle_ventas")
    .select("id_detalle, id_venta, cantidad, subtotal, precio_unitario, id_variante")
    .eq("id_marca", idMarca)
    .in("id_venta", ventasFiltradas.map((v) => v.id_venta));
  if (errorDetalle) throw new Error(friendlyDbError(errorDetalle));

  const idsVariante = [...new Set((detalle ?? []).map((d) => d.id_variante))];
  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_variante", idsVariante.length > 0 ? idsVariante : ["00000000-0000-0000-0000-000000000000"]);
  const variantePorId = new Map((variantes ?? []).map((v) => [v.id_variante, v]));
  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto))];
  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre")
    .in("id_producto", idsProducto.length > 0 ? idsProducto : ["00000000-0000-0000-0000-000000000000"]);
  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto, p]));

  // La comisión real de Mercado Pago depende de con qué pagó el cliente
  // (débito, crédito, cuotas, etc.) — eso queda en pagos.forma_pago_cliente
  // al confirmar el cobro (ver cobros-efectivo/actions.ts), no es una tasa
  // única aplicable a toda venta por Mercado Pago.
  const idsPago = [...new Set((ventasFiltradas ?? []).map((v) => v.id_pago).filter((id): id is string => Boolean(id)))];
  const { data: pagos } = await supabase
    .from("pagos")
    .select("id_pago, forma_pago_cliente")
    .in("id_pago", idsPago.length > 0 ? idsPago : ["00000000-0000-0000-0000-000000000000"]);
  const formaPagoPorIdPago = new Map((pagos ?? []).map((p) => [p.id_pago, p.forma_pago_cliente]));

  const lineas: LineaRendicion[] = [];

  for (const linea of detalle ?? []) {
    const venta = ventaPorId.get(linea.id_venta);
    if (!venta) continue;

    const variante = variantePorId.get(linea.id_variante);
    const producto = variante ? productoPorId.get(variante.id_producto) : undefined;
    const nombreProducto = variante
      ? `${producto?.nombre ?? "Producto"}${variante.nombre !== "Único" ? ` — ${variante.nombre}` : ""}`
      : "Producto";

    const esEfectivo = venta.medio_pago === "EFECTIVO";
    const formaPagoMp = venta.id_pago ? formaPagoPorIdPago.get(venta.id_pago) ?? null : null;
    const ventaBruta = linea.subtotal ?? linea.precio_unitario * linea.cantidad;
    const comisionWiigo = Math.round(ventaBruta * (royalty / 100));
    const ivaComision = Math.round(comisionWiigo * (ivaRoyalty / 100));
    // El Impuesto a los Créditos es bancario: no corresponde si se le va a
    // entregar el efectivo en mano, sin pasar por una cuenta. Lo mismo la
    // comisión de Mercado Pago, que solo existe si cobró por esa vía — y
    // varía según la forma de pago real del cliente (ver arriba).
    const impCreditosLinea = esEfectivo ? 0 : Math.round(ventaBruta * (tasas.impCreditos / 100));
    const tasaMp = formaPagoMp ? tasas.mpComisionPorFormaPago[formaPagoMp] ?? 0 : 0;
    const feeMp =
      !esEfectivo && marca.trasladar_comision_cobro && venta.medio_pago === "MERCADO_PAGO"
        ? Math.round(ventaBruta * (tasaMp / 100))
        : 0;
    const netoARendir = ventaBruta - comisionWiigo - ivaComision - impCreditosLinea - feeMp;

    lineas.push({
      idDetalle: linea.id_detalle,
      fecha: venta.fecha,
      numeroVenta: venta.numero,
      producto: nombreProducto,
      cantidad: linea.cantidad,
      medioPago: venta.medio_pago,
      formaPagoMp,
      ventaBruta,
      comisionWiigo,
      ivaComision,
      impCreditos: impCreditosLinea,
      feeMp,
      netoARendir,
    });
  }

  lineas.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const resumen = lineas.reduce(
    (acc, l) => ({
      ventaBruta: acc.ventaBruta + l.ventaBruta,
      comisionWiigo: acc.comisionWiigo + l.comisionWiigo,
      ivaComision: acc.ivaComision + l.ivaComision,
      impCreditos: acc.impCreditos + l.impCreditos,
      feeMp: acc.feeMp + l.feeMp,
      netoARendir: acc.netoARendir + l.netoARendir,
      // Dos plata distintas: lo que se le entrega en mano (efectivo) y lo
      // que se le transfiere por banco — no se pueden mezclar en un solo
      // número porque son dos movimientos físicos distintos.
      netoEfectivo: acc.netoEfectivo + (l.medioPago === "EFECTIVO" ? l.netoARendir : 0),
      netoTransferencia: acc.netoTransferencia + (l.medioPago === "EFECTIVO" ? 0 : l.netoARendir),
    }),
    vacioResumen()
  );

  return { marca: marca.nombre, lineas, resumen };
}

// Calcula la rendición línea por línea de una marca en un rango de
// fechas, solo sobre ventas ya pagadas y todavía no incluidas en una
// liquidación cerrada (ventas.id_liquidacion IS NULL).
export async function calcularRendicion(idMarca: string, desde: string, hasta: string) {
  const supabase = getSupabaseServerClient();

  const { data: detalle, error: errorDetalle } = await supabase
    .from("detalle_ventas")
    .select("id_venta")
    .eq("id_marca", idMarca);
  if (errorDetalle) throw new Error(friendlyDbError(errorDetalle));
  const idsVenta = [...new Set((detalle ?? []).map((d) => d.id_venta))];
  if (idsVenta.length === 0) return construirLineas(supabase, idMarca, []);

  const { data: ventas, error: errorVentas } = await supabase
    .from("ventas")
    .select("id_venta, numero, fecha, medio_pago, id_pago")
    .in("id_venta", idsVenta)
    .eq("estado", "PAGADA")
    .is("id_liquidacion", null)
    .gte("fecha", `${desde}T00:00:00`)
    .lte("fecha", `${hasta}T23:59:59`);
  if (errorVentas) throw new Error(friendlyDbError(errorVentas));

  return construirLineas(supabase, idMarca, ventas ?? []);
}

// Reconstruye el detalle línea por línea de una liquidación YA CERRADA,
// para el comprobante — las ventas quedaron estampadas con ese
// id_liquidacion al cerrarla, así que el detalle nunca cambia después.
export async function detalleLiquidacion(idLiquidacion: string) {
  const supabase = getSupabaseServerClient();

  const { data: liquidacion, error: errorLiq } = await supabase
    .from("liquidaciones")
    .select("*")
    .eq("id_liquidacion", idLiquidacion)
    .maybeSingle();
  if (errorLiq) throw new Error(friendlyDbError(errorLiq));
  if (!liquidacion) throw new Error("No se encontró la liquidación");

  const { data: ventas, error: errorVentas } = await supabase
    .from("ventas")
    .select("id_venta, numero, fecha, medio_pago, id_pago")
    .eq("id_liquidacion", idLiquidacion);
  if (errorVentas) throw new Error(friendlyDbError(errorVentas));

  const { marca, lineas, resumen } = await construirLineas(supabase, liquidacion.id_marca, ventas ?? []);

  return { liquidacion, marca, lineas, resumen };
}

export async function marcarComoLiquidada(
  idMarca: string,
  desde: string,
  hasta: string,
  resumen: {
    ventaBruta: number;
    comisionWiigo: number;
    ivaComision: number;
    impCreditos: number;
    feeMp: number;
    netoARendir: number;
    netoEfectivo: number;
    netoTransferencia: number;
  }
) {
  const supabase = getSupabaseServerClient();
  const usuario = await usuarioActual();

  const totalComisiones = resumen.comisionWiigo + resumen.ivaComision + resumen.feeMp;
  const totalRetenciones = totalComisiones + resumen.impCreditos;

  const { data: liquidacion, error: errorLiquidacion } = await supabase
    .from("liquidaciones")
    .insert({
      id_marca: idMarca,
      fecha_desde: desde,
      fecha_hasta: hasta,
      fecha_generacion: new Date().toISOString(),
      venta_bruta: resumen.ventaBruta,
      royalty: resumen.comisionWiigo,
      iva_royalty: resumen.ivaComision,
      comision_cobro_asignada: resumen.feeMp,
      imp_creditos_asignado: resumen.impCreditos,
      total_comisiones: totalComisiones,
      total_retenciones: totalRetenciones,
      neto_a_transferir: resumen.netoARendir,
      estado: "LIQUIDADA",
      observaciones: `Confirmado por ${usuario ?? "—"} · Efectivo entregado: $${resumen.netoEfectivo} · Transferido por banco: $${resumen.netoTransferencia}`,
    })
    .select("id_liquidacion")
    .single();
  if (errorLiquidacion) throw new Error(friendlyDbError(errorLiquidacion));

  // Estampa todas las ventas del período que ya se rindieron, para que no
  // se vuelvan a contar en la próxima liquidación.
  const { data: detalle } = await supabase.from("detalle_ventas").select("id_venta").eq("id_marca", idMarca);
  const idsVenta = [...new Set((detalle ?? []).map((d) => d.id_venta))];
  if (idsVenta.length > 0) {
    const { error: errorUpdate } = await supabase
      .from("ventas")
      .update({ id_liquidacion: liquidacion.id_liquidacion })
      .in("id_venta", idsVenta)
      .eq("estado", "PAGADA")
      .is("id_liquidacion", null)
      .gte("fecha", `${desde}T00:00:00`)
      .lte("fecha", `${hasta}T23:59:59`);
    if (errorUpdate) throw new Error(friendlyDbError(errorUpdate));
  }

  revalidatePath("/liquidaciones");
}

export async function historialLiquidaciones(idMarca: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("liquidaciones")
    .select("*")
    .eq("id_marca", idMarca)
    .order("fecha_generacion", { ascending: false });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

// El comprobante firmado se guarda en un bucket privado de Supabase
// Storage — nunca queda público, se ve a través de un link firmado con
// vencimiento (ver obtenerUrlComprobante).
export async function subirComprobante(idLiquidacion: string, formData: FormData) {
  const archivo = formData.get("archivo") as File | null;
  if (!archivo || archivo.size === 0) throw new Error("Elegí un archivo primero");

  const supabase = getSupabaseServerClient();
  const extension = archivo.name.split(".").pop() ?? "pdf";
  const path = `${idLiquidacion}.${extension}`;

  const { error: errorUpload } = await supabase.storage
    .from("comprobantes-liquidacion")
    .upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
  if (errorUpload) throw new Error(errorUpload.message);

  const { error: errorUpdate } = await supabase
    .from("liquidaciones")
    .update({ comprobante_path: path })
    .eq("id_liquidacion", idLiquidacion);
  if (errorUpdate) throw new Error(friendlyDbError(errorUpdate));

  revalidatePath("/liquidaciones");
}

export async function obtenerUrlComprobante(path: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("comprobantes-liquidacion")
    .createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
