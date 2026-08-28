"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { saldosPorProveedor, registrarMovimientoProveedor, historialCuentaProveedor } from "@/lib/cuentaProveedor";
import { calcularLiquidacionProveedor, generarLiquidacionProveedor, type LineaLiquidacionProveedor } from "@/lib/liquidacionesProveedor";
import { turnoAbiertoDeLocal } from "@/app/(app)/turnos/actions";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

// Alta/edición de proveedores y todo lo que mueve plata (facturas, pagos,
// órdenes de compra) es solo admin — mismo criterio que Profesionales.
// Recepcionar mercadería (más abajo, recepcionarOrdenCompra) NO pasa por
// este chequeo — lo puede hacer cualquier operativo del local, igual que
// ya funciona hoy en Reposición.
async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (sesion?.rol !== "admin") return "No tenés permiso para hacer esto — hace falta ser administrador.";
  return null;
}

function text(formData: FormData, name: string) {
  const s = String(formData.get(name) ?? "").trim();
  return s.length ? s : null;
}

function number(formData: FormData, name: string) {
  const raw = formData.get(name);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export type ProveedorConSaldo = {
  id_proveedor: string;
  nombre: string;
  cuit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  condicion_pago_dias: number | null;
  estado: string;
  modo_facturacion: string; // REMITO / PERIODO / LIQUIDACION_VENTA
  observaciones: string | null;
  fecha_alta: string;
  saldo: number;
  // Recepciones que todavía no tienen su factura (o, en LIQUIDACION_VENTA,
  // su costo) cargada — es el aviso concreto de "esto está pendiente" que
  // le faltaba a administración.
  pendientesFacturar: number;
};

export async function listarProveedores(): Promise<ProveedorConSaldo[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("proveedores").select("*").order("nombre", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));
  const proveedores = data ?? [];
  const saldos = await saldosPorProveedor(supabase, proveedores.map((p) => p.id_proveedor));

  const { data: pendientes } = await supabase.from("recepciones_proveedor").select("id_proveedor").eq("facturada", false);
  const pendientesPorProveedor = new Map<string, number>();
  for (const r of pendientes ?? []) {
    pendientesPorProveedor.set(r.id_proveedor, (pendientesPorProveedor.get(r.id_proveedor) ?? 0) + 1);
  }

  return proveedores.map((p) => ({
    ...p,
    saldo: saldos.get(p.id_proveedor) ?? 0,
    pendientesFacturar: pendientesPorProveedor.get(p.id_proveedor) ?? 0,
  }));
}

export async function crearProveedor(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre es obligatorio" };

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("proveedores").insert({
      nombre,
      cuit: text(formData, "cuit"),
      contacto: text(formData, "contacto"),
      telefono: text(formData, "telefono"),
      email: text(formData, "email"),
      condicion_pago_dias: number(formData, "condicion_pago_dias"),
      modo_facturacion: text(formData, "modo_facturacion") ?? "REMITO",
      estado: "ACTIVO",
      observaciones: text(formData, "observaciones"),
    });
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/proveedores");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el proveedor" };
  }
}

export async function actualizarProveedor(idProveedor: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre es obligatorio" };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("proveedores")
    .update({
      nombre,
      cuit: text(formData, "cuit"),
      contacto: text(formData, "contacto"),
      telefono: text(formData, "telefono"),
      email: text(formData, "email"),
      condicion_pago_dias: number(formData, "condicion_pago_dias"),
      modo_facturacion: text(formData, "modo_facturacion") ?? "REMITO",
      observaciones: text(formData, "observaciones"),
    })
    .eq("id_proveedor", idProveedor);
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/proveedores");
  return { error: null };
}

export async function cambiarEstadoProveedor(idProveedor: string, estado: "ACTIVO" | "INACTIVO"): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("proveedores").update({ estado }).eq("id_proveedor", idProveedor);
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/proveedores");
  return { error: null };
}

// ===================== ÓRDENES DE COMPRA Y RECEPCIÓN =====================
// Es un remito: cantidad solicitada, sin precio — el precio recién aparece
// con la factura (ver cargarFacturaCompra, próximo paso). Mismo patrón que
// crearOrden/recepcionarOrden en app/(app)/reposicion/actions.ts. El listado
// se trae directo en page.tsx (junto con el resto de la data de la
// pantalla), no hace falta una función aparte acá.

export async function crearOrdenCompra(
  idProveedor: string,
  idLocal: string,
  items: { idVariante: string; cantidad: number }[],
  observaciones: string
): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const validos = items.filter((i) => i.cantidad > 0);
  if (validos.length === 0) return { error: "Agregá al menos un producto con cantidad mayor a 0" };

  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();
    const totalUnidades = validos.reduce((acc, i) => acc + i.cantidad, 0);

    const { data: orden, error: errorOrden } = await supabase
      .from("ordenes_compra_proveedor")
      .insert({
        id_proveedor: idProveedor,
        id_local: idLocal,
        estado: "PENDIENTE",
        total_unidades: totalUnidades,
        observaciones: observaciones || null,
        usuario,
      })
      .select("id_orden")
      .single();
    if (errorOrden) return { error: friendlyDbError(errorOrden) };

    const filas = validos.map((i) => ({
      id_orden: orden.id_orden,
      id_variante: i.idVariante,
      cantidad_solicitada: i.cantidad,
      cantidad_recibida: 0,
    }));
    const { error: errorDetalle } = await supabase.from("detalle_orden_compra").insert(filas);
    if (errorDetalle) return { error: friendlyDbError(errorDetalle) };

    revalidatePath("/proveedores");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la orden" };
  }
}

// A propósito SIN requireAdmin: cualquier operativo del local recepciona lo
// que llega, igual que ya pasa en Reposición. Actualiza el stock siempre con
// lo REALMENTE recibido (nunca con lo pedido) y marca diferencias línea por
// línea — no genera ningún movimiento de plata, eso nace recién con la
// factura.
export async function recepcionarOrdenCompra(
  idOrden: string,
  items: { idDetalle: string; idVariante: string; cantidadSolicitada: number; cantidadRecibida: number }[],
  observaciones: string
): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();

    const { data: orden, error: errorOrdenGet } = await supabase
      .from("ordenes_compra_proveedor")
      .select("id_proveedor, id_local")
      .eq("id_orden", idOrden)
      .maybeSingle();
    if (errorOrdenGet) return { error: friendlyDbError(errorOrdenGet) };
    if (!orden) return { error: "No se encontró la orden" };

    const usuario = await usuarioActual();
    const tieneDiferencias = items.some((i) => i.cantidadRecibida !== i.cantidadSolicitada);

    const { data: recepcion, error: errorRecepcion } = await supabase
      .from("recepciones_proveedor")
      .insert({
        id_orden: idOrden,
        id_proveedor: orden.id_proveedor,
        id_local: orden.id_local,
        usuario,
        tiene_diferencias: tieneDiferencias,
        observaciones: observaciones || null,
      })
      .select("id_recepcion")
      .single();
    if (errorRecepcion) return { error: friendlyDbError(errorRecepcion) };

    for (const item of items) {
      const diferencia = item.cantidadRecibida - item.cantidadSolicitada;
      const estadoControl = diferencia === 0 ? "COMPLETA" : diferencia < 0 ? "FALTANTE" : "SOBRANTE";

      const { error: errorUpdateDetalle } = await supabase
        .from("detalle_orden_compra")
        .update({ cantidad_recibida: item.cantidadRecibida })
        .eq("id_detalle", item.idDetalle);
      if (errorUpdateDetalle) return { error: friendlyDbError(errorUpdateDetalle) };

      const { error: errorDetalleRecepcion } = await supabase.from("detalle_recepcion_proveedor").insert({
        id_recepcion: recepcion.id_recepcion,
        id_variante: item.idVariante,
        cantidad_solicitada: item.cantidadSolicitada,
        cantidad_recibida: item.cantidadRecibida,
        estado_control: estadoControl,
        diferencia,
      });
      if (errorDetalleRecepcion) return { error: friendlyDbError(errorDetalleRecepcion) };

      if (item.cantidadRecibida > 0) {
        const { data: stockActual } = await supabase
          .from("stock")
          .select("cantidad")
          .eq("id_variante", item.idVariante)
          .eq("id_local", orden.id_local)
          .maybeSingle();
        const nuevaCantidad = (stockActual?.cantidad ?? 0) + item.cantidadRecibida;

        const { error: errorStock } = await supabase
          .from("stock")
          .upsert(
            {
              id_variante: item.idVariante,
              id_local: orden.id_local,
              cantidad: nuevaCantidad,
              fecha_actualizacion: new Date().toISOString(),
            },
            { onConflict: "id_variante,id_local" }
          );
        if (errorStock) return { error: friendlyDbError(errorStock) };

        const { error: errorMov } = await supabase.from("movimientos_stock").insert({
          id_variante: item.idVariante,
          id_local: orden.id_local,
          tipo: "COMPRA_PROVEEDOR",
          cantidad: item.cantidadRecibida,
          motivo: "Recepción de orden de compra a proveedor",
          id_referencia: idOrden,
          usuario,
        });
        if (errorMov) return { error: friendlyDbError(errorMov) };
      }
    }

    const { error: errorEstado } = await supabase
      .from("ordenes_compra_proveedor")
      .update({ estado: tieneDiferencias ? "RECIBIDA_CON_DIFERENCIAS" : "RECIBIDA" })
      .eq("id_orden", idOrden);
    if (errorEstado) return { error: friendlyDbError(errorEstado) };

    revalidatePath("/proveedores");
    revalidatePath("/stock");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar la recepción" };
  }
}

// ===================== DEVOLUCIONES =====================
// A propósito simple y sin atarla a una recepción puntual, para que cargarla
// sea rápido — resta del stock (inverso de recepcionar) y se neteá contra
// lo recibido al facturar por período. No tiene costo propio: nunca genera
// un movimiento de plata sola, eso nace recién con la factura o la
// liquidación. Sin requireAdmin: cualquier operativo puede registrarla,
// igual que recepcionar.
export async function registrarDevolucionProveedor(
  idProveedor: string,
  idLocal: string,
  idVariante: string,
  cantidad: number,
  motivo: string
): Promise<{ error: string | null }> {
  if (cantidad <= 0) return { error: "La cantidad tiene que ser mayor a 0" };

  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    const { data: stockActual } = await supabase
      .from("stock")
      .select("cantidad")
      .eq("id_variante", idVariante)
      .eq("id_local", idLocal)
      .maybeSingle();
    const disponible = stockActual?.cantidad ?? 0;
    if (cantidad > disponible) {
      return { error: `No hay esa cantidad en stock para devolver — quedan ${disponible} unidades.` };
    }
    const nuevaCantidad = disponible - cantidad;

    const { error: errorStock } = await supabase
      .from("stock")
      .upsert(
        { id_variante: idVariante, id_local: idLocal, cantidad: nuevaCantidad, fecha_actualizacion: new Date().toISOString() },
        { onConflict: "id_variante,id_local" }
      );
    if (errorStock) return { error: friendlyDbError(errorStock) };

    await supabase.from("movimientos_stock").insert({
      id_variante: idVariante,
      id_local: idLocal,
      tipo: "DEVOLUCION_PROVEEDOR",
      cantidad: -cantidad,
      motivo: motivo || "Devolución a proveedor",
      usuario,
    });

    const { error: errorDevolucion } = await supabase.from("devoluciones_proveedor").insert({
      id_proveedor: idProveedor,
      id_local: idLocal,
      id_variante: idVariante,
      cantidad,
      motivo: motivo || null,
      usuario,
    });
    if (errorDevolucion) return { error: friendlyDbError(errorDevolucion) };

    revalidatePath("/proveedores");
    revalidatePath("/stock");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar la devolución" };
  }
}

export async function listarDevolucionesProveedor(idProveedor: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("devoluciones_proveedor")
    .select("*")
    .eq("id_proveedor", idProveedor)
    .order("fecha", { ascending: false })
    .limit(100);
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

// ===================== COSTOS (modo LIQUIDACION_VENTA) =====================
// Alifrut no factura por entrega — pero el costo de cada pedido sí puede
// variar, así que después de recepcionar hay que poder cargarlo igual. A
// diferencia de cargarFacturaCompra, esto NUNCA genera factura ni movimiento
// de cuenta corriente — solo actualiza productos.costo_informado, que es lo
// que después usa la liquidación por venta para calcular cuánto se le debe.
export async function actualizarCostosRecepcion(
  idOrden: string,
  costos: { idVariante: string; costo: number }[],
  comprobante?: File | null
): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  try {
    const supabase = getSupabaseServerClient();
    for (const item of costos) {
      if (item.costo <= 0) continue;
      const { data: variante } = await supabase
        .from("variantes_producto")
        .select("id_producto")
        .eq("id_variante", item.idVariante)
        .maybeSingle();
      if (!variante) continue;
      const { error } = await supabase.from("productos").update({ costo_informado: item.costo }).eq("id_producto", variante.id_producto);
      if (error) return { error: friendlyDbError(error) };
    }

    // Marca la recepción como procesada — es lo que hace que deje de
    // aparecer en "pendientes de facturar" para administración. El
    // comprobante se guarda acá mismo (y no en facturas_compra_proveedor)
    // porque en este modo nunca nace una factura financiera real.
    const updateRecepcion: Record<string, unknown> = { facturada: true };

    const extension = comprobante?.name.split(".").pop();
    if (comprobante && comprobante.size > 0) {
      const path = `recepcion-${idOrden}.${extension ?? "jpg"}`;
      const { error: errorUpload } = await supabase.storage
        .from("comprobantes-proveedor")
        .upload(path, comprobante, { upsert: true, contentType: comprobante.type || undefined });
      // No bloquea el guardado si falla la subida — se puede reintentar después.
      if (!errorUpload) updateRecepcion.comprobante_path = path;
    }

    await supabase.from("recepciones_proveedor").update(updateRecepcion).eq("id_orden", idOrden);

    revalidatePath("/proveedores");
    revalidatePath("/productos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudieron actualizar los costos" };
  }
}

// ===================== FACTURA (modos REMITO y PERIODO) =====================
// El precio recién aparece acá — nunca en la orden ni en la recepción. Sirve
// para los dos modos: REMITO manda idOrden, PERIODO manda fechaDesde/Hasta.
// Nace la deuda real en la cuenta corriente del proveedor.

// Junta lo recibido y lo devuelto de un proveedor en un rango de fechas —
// para prellenar el formulario del modo PERIODO antes de cargar la factura.
export async function calcularResumenPeriodoProveedor(idProveedor: string, fechaDesde: string, fechaHasta: string) {
  const supabase = getSupabaseServerClient();

  // facturada=false es lo que evita cobrar dos veces lo mismo si alguna vez
  // se eligen rangos de fechas que se pisan entre sí — el filtro real de
  // "ya está cubierto" es este flag, la fecha es solo para juntar el lote.
  const { data: recepciones } = await supabase
    .from("recepciones_proveedor")
    .select("id_recepcion")
    .eq("id_proveedor", idProveedor)
    .eq("facturada", false)
    .gte("fecha", `${fechaDesde}T00:00:00`)
    .lte("fecha", `${fechaHasta}T23:59:59`);
  const idsRecepcion = (recepciones ?? []).map((r) => r.id_recepcion as string);

  const { data: detalleRecibido } =
    idsRecepcion.length > 0
      ? await supabase.from("detalle_recepcion_proveedor").select("id_variante, cantidad_recibida").in("id_recepcion", idsRecepcion)
      : { data: [] as { id_variante: string; cantidad_recibida: number }[] };

  const { data: devoluciones } = await supabase
    .from("devoluciones_proveedor")
    .select("id_variante, cantidad")
    .eq("id_proveedor", idProveedor)
    .eq("facturada", false)
    .gte("fecha", `${fechaDesde}T00:00:00`)
    .lte("fecha", `${fechaHasta}T23:59:59`);

  const netoPorVariante = new Map<string, number>();
  for (const d of detalleRecibido ?? []) {
    netoPorVariante.set(d.id_variante, (netoPorVariante.get(d.id_variante) ?? 0) + (d.cantidad_recibida ?? 0));
  }
  for (const d of devoluciones ?? []) {
    netoPorVariante.set(d.id_variante, (netoPorVariante.get(d.id_variante) ?? 0) - (d.cantidad ?? 0));
  }

  return [...netoPorVariante.entries()]
    .filter(([, cantidad]) => cantidad !== 0)
    .map(([idVariante, cantidadNeta]) => ({ idVariante, cantidadNeta }));
}

export async function cargarFacturaCompra(params: {
  idProveedor: string;
  idOrden?: string | null;
  fechaPeriodoDesde?: string | null;
  fechaPeriodoHasta?: string | null;
  numeroFactura: string;
  tipoComprobante: string;
  fechaEmision: string;
  fechaVencimiento: string;
  monto: number;
  observaciones: string;
  lineas: { idVariante: string; cantidadFacturada: number; precioUnitarioReal: number; actualizarCosto: boolean }[];
  comprobante?: File | null;
}): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  if (params.monto <= 0) return { error: "El monto de la factura tiene que ser mayor a 0" };

  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    const { data: factura, error: errorFactura } = await supabase
      .from("facturas_compra_proveedor")
      .insert({
        id_proveedor: params.idProveedor,
        id_orden: params.idOrden ?? null,
        fecha_periodo_desde: params.fechaPeriodoDesde ?? null,
        fecha_periodo_hasta: params.fechaPeriodoHasta ?? null,
        numero_factura: params.numeroFactura || null,
        tipo_comprobante: params.tipoComprobante || null,
        fecha_emision: params.fechaEmision,
        fecha_vencimiento: params.fechaVencimiento || null,
        monto: params.monto,
        estado: "PENDIENTE",
        observaciones: params.observaciones || null,
        usuario,
      })
      .select("id_factura")
      .single();
    if (errorFactura) return { error: friendlyDbError(errorFactura) };

    if (params.comprobante && params.comprobante.size > 0) {
      const extension = params.comprobante.name.split(".").pop() ?? "jpg";
      const path = `factura-${factura.id_factura}.${extension}`;
      const { error: errorUpload } = await supabase.storage
        .from("comprobantes-proveedor")
        .upload(path, params.comprobante, { upsert: true, contentType: params.comprobante.type || undefined });
      // No bloquea la factura si falla la subida — se puede reintentar después.
      if (!errorUpload) {
        await supabase.from("facturas_compra_proveedor").update({ comprobante_path: path }).eq("id_factura", factura.id_factura);
      }
    }

    for (const linea of params.lineas) {
      const { data: variante } = await supabase
        .from("variantes_producto")
        .select("id_producto")
        .eq("id_variante", linea.idVariante)
        .maybeSingle();
      let costoAnterior: number | null = null;
      if (variante) {
        const { data: producto } = await supabase
          .from("productos")
          .select("costo_informado")
          .eq("id_producto", variante.id_producto)
          .maybeSingle();
        costoAnterior = producto?.costo_informado ?? null;
        if (linea.actualizarCosto) {
          await supabase.from("productos").update({ costo_informado: linea.precioUnitarioReal }).eq("id_producto", variante.id_producto);
        }
      }

      const { error: errorDetalle } = await supabase.from("detalle_factura_compra").insert({
        id_factura: factura.id_factura,
        id_variante: linea.idVariante,
        cantidad_facturada: linea.cantidadFacturada,
        precio_unitario_real: linea.precioUnitarioReal,
        costo_anterior: costoAnterior,
      });
      if (errorDetalle) return { error: friendlyDbError(errorDetalle) };
    }

    // Marca lo cubierto como ya facturado, para que deje de aparecer como
    // pendiente — por orden puntual (REMITO) o por rango de fechas (PERIODO).
    if (params.idOrden) {
      await supabase.from("recepciones_proveedor").update({ facturada: true }).eq("id_orden", params.idOrden);
    }
    if (params.fechaPeriodoDesde && params.fechaPeriodoHasta) {
      await supabase
        .from("recepciones_proveedor")
        .update({ facturada: true })
        .eq("id_proveedor", params.idProveedor)
        .eq("facturada", false)
        .gte("fecha", `${params.fechaPeriodoDesde}T00:00:00`)
        .lte("fecha", `${params.fechaPeriodoHasta}T23:59:59`);
      await supabase
        .from("devoluciones_proveedor")
        .update({ facturada: true })
        .eq("id_proveedor", params.idProveedor)
        .eq("facturada", false)
        .gte("fecha", `${params.fechaPeriodoDesde}T00:00:00`)
        .lte("fecha", `${params.fechaPeriodoHasta}T23:59:59`);
    }

    await registrarMovimientoProveedor(supabase, {
      idProveedor: params.idProveedor,
      tipoMovimiento: "FACTURA_COMPRA",
      importe: params.monto,
      idFactura: factura.id_factura,
      usuario,
      observaciones: params.numeroFactura ? `Factura ${params.numeroFactura}` : "Factura de compra",
    });

    revalidatePath("/proveedores");
    revalidatePath("/productos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cargar la factura" };
  }
}

// ===================== LIQUIDACIÓN POR VENTA (modo LIQUIDACION_VENTA) =====================
// Caso Alifrut: se le paga el costo de lo vendido, nunca de lo entregado.
// Ver lib/liquidacionesProveedor.ts para el cálculo real.

export async function calcularLiquidacionProveedorAction(idProveedor: string, fechaDesde: string, fechaHasta: string) {
  const supabase = getSupabaseServerClient();
  return calcularLiquidacionProveedor(supabase, idProveedor, fechaDesde, fechaHasta);
}

export async function generarLiquidacionProveedorAction(params: {
  idProveedor: string;
  fechaDesde: string;
  fechaHasta: string;
  montoFinal: number;
  lineas: LineaLiquidacionProveedor[];
  observaciones: string;
}): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  if (params.montoFinal <= 0) return { error: "El monto tiene que ser mayor a 0" };

  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    await generarLiquidacionProveedor(supabase, {
      idProveedor: params.idProveedor,
      fechaDesde: params.fechaDesde,
      fechaHasta: params.fechaHasta,
      montoFinal: params.montoFinal,
      lineas: params.lineas,
      usuario,
      observaciones: params.observaciones || null,
    });

    await registrarMovimientoProveedor(supabase, {
      idProveedor: params.idProveedor,
      tipoMovimiento: "LIQUIDACION",
      importe: params.montoFinal,
      usuario,
      observaciones: `Liquidación por venta ${params.fechaDesde} a ${params.fechaHasta}`,
    });

    revalidatePath("/proveedores");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo generar la liquidación" };
  }
}

// ===================== PAGO A PROVEEDOR =====================
// A diferencia de una marca (que puede tener saldo a favor de WiiGo), acá la
// relación es de un solo sentido: siempre le debemos a él, nunca al revés —
// por eso alcanza con un único tipo "PAGO" que resta del saldo. Cuando la
// forma de pago es efectivo (turno o Caja Administración), la plata sale de
// verdad de esa caja física — mismo criterio que ya usamos en Gastos.

export async function registrarPagoProveedor(idProveedor: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const monto = number(formData, "monto");
  if (!monto || monto <= 0) return { error: "El monto tiene que ser mayor a 0" };

  const medioPago = text(formData, "medio_pago") ?? "TRANSFERENCIA";
  const idLocal = text(formData, "id_local");
  const descripcion = text(formData, "descripcion");

  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    let idTurno: string | null = null;
    if (medioPago === "EFECTIVO_TURNO") {
      if (!idLocal) return { error: "Elegí el local para descontar del turno abierto" };
      idTurno = await turnoAbiertoDeLocal(supabase, idLocal);
      if (!idTurno) return { error: "No hay un turno de caja abierto en ese local — no se puede descontar de ahí." };
    }

    const { idMovimiento } = await registrarMovimientoProveedor(supabase, {
      idProveedor,
      tipoMovimiento: "PAGO",
      importe: -monto,
      usuario,
      observaciones: descripcion ?? "Pago manual",
      medioPago,
      idLocal: medioPago === "EFECTIVO_TURNO" ? idLocal : null,
      idTurno,
    });

    const comprobante = formData.get("comprobante") as File | null;
    if (comprobante && comprobante.size > 0) {
      const extension = comprobante.name.split(".").pop() ?? "jpg";
      const path = `pago-${idMovimiento}.${extension}`;
      const { error: errorUpload } = await supabase.storage
        .from("comprobantes-proveedor")
        .upload(path, comprobante, { upsert: true, contentType: comprobante.type || undefined });
      // No bloquea el pago si falla la subida — la plata ya se movió, el
      // comprobante se puede volver a intentar después.
      if (!errorUpload) {
        await supabase.from("movimientos_cuenta_proveedor").update({ comprobante_path: path }).eq("id_movimiento", idMovimiento);
      }
    }

    if (medioPago === "EFECTIVO_ADMIN") {
      await supabase.from("movimientos_caja_admin").insert({
        tipo: "EGRESO_PAGO_PROVEEDOR",
        monto: -monto,
        id_movimiento_proveedor: idMovimiento,
        descripcion: descripcion ?? "Pago a proveedor desde Caja Administración",
        usuario,
      });
    }

    revalidatePath("/proveedores");
    revalidatePath("/turnos");
    revalidatePath("/gastos");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar el pago" };
  }
}

export async function obtenerUrlComprobanteProveedor(path: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.storage.from("comprobantes-proveedor").createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function historialProveedorAction(idProveedor: string) {
  const supabase = getSupabaseServerClient();
  const movimientos = await historialCuentaProveedor(supabase, idProveedor);
  return movimientos.map((m) => ({
    idMovimiento: m.id_movimiento as string,
    tipoMovimiento: m.tipo_movimiento as string,
    importe: m.importe as number,
    saldoNuevo: m.saldo_nuevo as number,
    medioPago: m.medio_pago as string | null,
    comprobantePath: m.comprobante_path as string | null,
    usuario: m.usuario as string | null,
    observaciones: m.observaciones as string | null,
    fecha: m.fecha as string,
  }));
}
