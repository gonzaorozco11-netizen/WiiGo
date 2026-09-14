"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import {
  saldosPorProveedor,
  saldoCuentaProveedor,
  registrarMovimientoProveedor,
  historialCuentaProveedor,
} from "@/lib/cuentaProveedor";
import {
  calcularLiquidacionProveedor,
  generarLiquidacionProveedor,
  detalleLiquidacionProveedor,
} from "@/lib/liquidacionesProveedor";
import { consumirFifo } from "@/lib/fifoProveedor";
import { estaAbierta, estadoSegunRecibido } from "@/lib/estadosOrden";
import { turnoAbiertoDeLocal } from "@/app/(app)/turnos/actions";

function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

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
  /**
   * Solo LIQUIDACION_VENTA: lo que ya se vendió y todavía no se liquidó.
   *
   * Sin esto, Alifrut mostraba "$0 · al día" aunque le hubieras vendido medio
   * depósito: el saldo es la deuda formal, y con este modo no nace hasta que
   * se genera la liquidación. El número era correcto y a la vez mentía.
   *
   * Es aproximado — usa el costo de referencia del producto y no el lote FIFO
   * que le va a tocar a cada unidad. El exacto sale al abrir la liquidación.
   */
  vendidoSinLiquidar: number;
  unidadesSinLiquidar: number;
};

/**
 * Las marcas en consignación, para mostrarlas en la lista de proveedores.
 *
 * Son de solo lectura acá: se ven para tener la foto completa de quién te
 * provee, pero se manejan en su propia pantalla. Dos lugares para hacer lo
 * mismo terminan en que se hace mal en uno de los dos.
 *
 * Ojo con el signo: con una marca la relación es al revés que con un
 * proveedor — ella te debe a vos el royalty, no vos a ella.
 */
export type MarcaEnLista = {
  idMarca: string;
  nombre: string;
  royalty: number;
  plan: string;
  saldo: number;
  solicitudesPendientes: number;
};

export async function listarMarcasParaProveedores(): Promise<MarcaEnLista[]> {
  const supabase = getSupabaseServerClient();

  const { data: marcas } = await supabase
    .from("marcas")
    .select("id_marca, nombre, royalty_porcentaje, plan, tipo_comercializacion")
    .eq("estado", "ACTIVA")
    .order("nombre", { ascending: true });
  if (!marcas || marcas.length === 0) return [];

  // La marca propia (WiiGo Dietética) no es un proveedor: es el negocio.
  const terceras = marcas.filter((m) => m.tipo_comercializacion !== "PROPIA");
  if (terceras.length === 0) return [];
  const ids = terceras.map((m) => m.id_marca as string);

  // Una sola consulta para todos los saldos y se agrupa acá: pedir el saldo
  // marca por marca serían tantos viajes a la base como marcas haya.
  const [{ data: movimientos }, { data: solicitudes }] = await Promise.all([
    supabase.from("movimientos_cuenta_comercial_marca").select("id_marca, importe").in("id_marca", ids).eq("anulado", false),
    supabase.from("solicitudes_marca").select("id_marca").in("id_marca", ids).eq("estado", "PENDIENTE"),
  ]);

  const saldo = new Map<string, number>();
  (movimientos ?? []).forEach((m) => {
    const k = m.id_marca as string;
    saldo.set(k, (saldo.get(k) ?? 0) + ((m.importe as number) ?? 0));
  });

  const pendientes = new Map<string, number>();
  (solicitudes ?? []).forEach((s) => {
    const k = s.id_marca as string;
    pendientes.set(k, (pendientes.get(k) ?? 0) + 1);
  });

  return terceras.map((m) => ({
    idMarca: m.id_marca as string,
    nombre: m.nombre as string,
    royalty: (m.royalty_porcentaje as number | null) ?? 0,
    plan: (m.plan as string | null) ?? "BRONCE",
    saldo: Math.round((saldo.get(m.id_marca as string) ?? 0) * 100) / 100,
    solicitudesPendientes: pendientes.get(m.id_marca as string) ?? 0,
  }));
}

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

  const acumulado = await vendidoSinLiquidarPorProveedor(
    supabase,
    proveedores.filter((p) => p.modo_facturacion === "LIQUIDACION_VENTA").map((p) => p.id_proveedor)
  );

  return proveedores.map((p) => ({
    ...p,
    saldo: saldos.get(p.id_proveedor) ?? 0,
    pendientesFacturar: pendientesPorProveedor.get(p.id_proveedor) ?? 0,
    vendidoSinLiquidar: acumulado.get(p.id_proveedor)?.monto ?? 0,
    unidadesSinLiquidar: acumulado.get(p.id_proveedor)?.unidades ?? 0,
  }));
}

/**
 * Lo vendido y todavía no liquidado, por proveedor de liquidación por venta.
 *
 * Usa el costo de referencia del producto en vez de correr el FIFO lote por
 * lote: acá es una lista, y hacer la simulación completa por cada proveedor
 * haría lenta una pantalla que se abre todo el tiempo. La diferencia aparece
 * solo si el mismo producto entró a precios distintos, y el número exacto se
 * ve al abrir la liquidación.
 */
async function vendidoSinLiquidarPorProveedor(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  ids: string[]
): Promise<Map<string, { monto: number; unidades: number }>> {
  const resultado = new Map<string, { monto: number; unidades: number }>();
  if (ids.length === 0) return resultado;

  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, id_proveedor_liquidacion, costo_informado")
    .in("id_proveedor_liquidacion", ids);
  if (!productos || productos.length === 0) return resultado;

  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto")
    .in(
      "id_producto",
      productos.map((p) => p.id_producto as string)
    );
  if (!variantes || variantes.length === 0) return resultado;

  const productoPorId = new Map(productos.map((p) => [p.id_producto as string, p]));
  const datosPorVariante = new Map(
    variantes.map((v) => {
      const p = productoPorId.get(v.id_producto as string);
      return [
        v.id_variante as string,
        {
          idProveedor: (p?.id_proveedor_liquidacion as string) ?? "",
          costo: (p?.costo_informado as number | null) ?? 0,
        },
      ];
    })
  );

  // Solo lo no liquidado: al generar la liquidación estas líneas quedan
  // marcadas y dejan de contar acá, que es lo que hace que el número baje a
  // cero después de liquidar.
  const { data: lineas } = await supabase
    .from("detalle_ventas")
    .select("id_variante, cantidad")
    .in("id_variante", [...datosPorVariante.keys()])
    .is("id_liquidacion_proveedor", null);

  for (const l of lineas ?? []) {
    const d = datosPorVariante.get(l.id_variante as string);
    if (!d?.idProveedor) continue;
    const previo = resultado.get(d.idProveedor) ?? { monto: 0, unidades: 0 };
    const cantidad = (l.cantidad as number) ?? 0;
    resultado.set(d.idProveedor, {
      monto: previo.monto + cantidad * d.costo,
      unidades: previo.unidades + cantidad,
    });
  }

  return resultado;
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
/**
 * Cargar una entrega contra una orden de compra.
 *
 * Puede correr VARIAS VECES sobre la misma orden: si el proveedor manda 8 de
 * 12 el lunes y los 4 que faltan el jueves, son dos entregas del mismo
 * pedido. Por eso las cantidades se SUMAN a lo que ya había — antes se
 * pisaban, y la segunda entrega borraba la primera.
 *
 * `cantidadRecibida` es siempre lo que llegó AHORA, no el acumulado.
 */
export async function recepcionarOrdenCompra(
  idOrden: string,
  items: { idDetalle: string; idVariante: string; cantidadSolicitada: number; cantidadRecibida: number }[],
  observaciones: string
): Promise<{ error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();

    const { data: orden, error: errorOrdenGet } = await supabase
      .from("ordenes_compra_proveedor")
      .select("id_proveedor, id_local, estado")
      .eq("id_orden", idOrden)
      .maybeSingle();
    if (errorOrdenGet) return { error: friendlyDbError(errorOrdenGet) };
    if (!orden) return { error: "No se encontró la orden" };
    if (!estaAbierta(orden.estado as string)) {
      return { error: "Este pedido ya está cerrado. No se le puede cargar otra entrega." };
    }

    // Lo ya recibido en entregas anteriores. Se lee de la base y no del
    // navegador: si dos personas abren la misma orden a la vez, el que
    // guarda segundo tiene que sumar sobre lo que guardó el primero.
    const { data: previos, error: errorPrevios } = await supabase
      .from("detalle_orden_compra")
      .select("id_detalle, cantidad_solicitada, cantidad_recibida")
      .eq("id_orden", idOrden);
    if (errorPrevios) return { error: friendlyDbError(errorPrevios) };

    const yaRecibido = new Map(
      (previos ?? []).map((d) => [d.id_detalle as string, (d.cantidad_recibida as number) ?? 0])
    );

    if (items.every((i) => i.cantidadRecibida <= 0)) {
      return { error: "No cargaste ninguna unidad. Si no llegó nada, dejá el pedido como está." };
    }
    if (items.some((i) => i.cantidadRecibida < 0)) {
      return { error: "No se puede recibir una cantidad negativa." };
    }

    const usuario = await usuarioActual();
    // Para esta entrega puntual: ¿lo que llegó ahora coincide con lo que
    // faltaba? Es lo que decide si el remito de HOY tuvo diferencias.
    const tieneDiferencias = items.some(
      (i) => i.cantidadRecibida !== Math.max(0, i.cantidadSolicitada - (yaRecibido.get(i.idDetalle) ?? 0))
    );

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
      const previo = yaRecibido.get(item.idDetalle) ?? 0;
      const acumulado = previo + item.cantidadRecibida;
      // La diferencia se mide contra el pedido completo, no contra esta
      // entrega: es lo que le importa a quien después reclama.
      const diferencia = acumulado - item.cantidadSolicitada;
      const estadoControl = diferencia === 0 ? "COMPLETA" : diferencia < 0 ? "FALTANTE" : "SOBRANTE";

      const { error: errorUpdateDetalle } = await supabase
        .from("detalle_orden_compra")
        .update({ cantidad_recibida: acumulado })
        .eq("id_detalle", item.idDetalle);
      if (errorUpdateDetalle) return { error: friendlyDbError(errorUpdateDetalle) };

      // El lote FIFO es de ESTA entrega: solo lo que llegó ahora, con el
      // costo que traiga su propia factura. Por eso acá no va el acumulado.
      const { error: errorDetalleRecepcion } = await supabase.from("detalle_recepcion_proveedor").insert({
        id_recepcion: recepcion.id_recepcion,
        id_variante: item.idVariante,
        cantidad_solicitada: item.cantidadSolicitada,
        cantidad_recibida: item.cantidadRecibida,
        estado_control: estadoControl,
        diferencia,
        // Arranca con toda la cantidad recibida disponible — el costeo FIFO
        // (lib/fifoProveedor.ts) la va descontando a medida que se vende o
        // se devuelve, siempre del lote más viejo primero.
        cantidad_disponible_fifo: item.cantidadRecibida,
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

    // El estado sale de las cantidades, no de una decisión de quien recibe:
    // si después de esta entrega todavía falta algo, el pedido sigue abierto
    // y vuelve a aparecer en Recepción esperando el resto.
    const nuevoEstado = estadoSegunRecibido(
      items.map((i) => ({
        solicitada: i.cantidadSolicitada,
        recibidaAcumulada: (yaRecibido.get(i.idDetalle) ?? 0) + i.cantidadRecibida,
      }))
    );

    const { error: errorEstado } = await supabase
      .from("ordenes_compra_proveedor")
      .update({ estado: nuevoEstado })
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

    // Si este proveedor usa costeo FIFO (caso Alifrut), lo devuelto también
    // se descuenta del lote más viejo con saldo — mismo criterio que una
    // venta — para que no quede "disponible" para liquidar después. No
    // tiene ningún efecto si el proveedor no tiene lotes con costo cargado.
    await consumirFifo(supabase, idProveedor, idVariante, cantidad, null);

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

// ===================== COSTEAR UNA ENTREGA =====================
//
// El paso 3 de Compras, para las dos formas de comprar:
//
// - **Alifrut** (LIQUIDACION_VENTA): solo costo + IVA. No nace deuda: se le
//   paga lo que se venda, no lo que entregó.
// - **Coca-Cola** (REMITO): costo + la factura, que sí genera deuda.
//
// Va por ENTREGA y no por orden. Desde que un pedido puede llegar en varias
// veces, "el costo del pedido" no existe: cada entrega trae su propio precio
// y su propio lote FIFO. La versión anterior buscaba la recepción de la orden
// con .maybeSingle() y, con dos entregas, fallaba.

/**
 * Una factura puede cubrir varias entregas.
 *
 * El caso que obliga a esto: el proveedor factura el pedido completo el
 * viernes y entrega en dos veces, viernes y sábado. Hay una sola deuda.
 * Al revés también existe (dos entregas, dos facturas). El sistema no puede
 * adivinar cuál de los dos es — lo elige quien tiene la factura adelante.
 */
export type FacturaDeEntrega = {
  numero: string;
  tipoComprobante: string;
  /** Manda el período de IVA y desde acá corre el plazo de pago. */
  fechaEmision: string;
  fechaVencimiento: string | null;
  monto: number;
  /** Qué recepciones cubre. Siempre incluye la que se está costeando. */
  idsRecepcionCubiertas: string[];
  /** Unidades que dice la factura, para el control de que cuadre. */
  unidadesFacturadas: number | null;
  /**
   * Lo que el proveedor facturó de más.
   *
   * Suma al total de la factura y al IVA — la deuda y el libro tienen que
   * coincidir con lo que el proveedor ya declaró — pero NO entra al costo de
   * los productos: esa mercadería no llegó, así que no puede encarecer la que
   * sí llegó. De acá sale el reclamo de nota de crédito.
   */
  malFacturado: {
    neto: number;
    iva: number;
    impuestos: number;
    retenciones: number;
    motivo: string;
  } | null;
  /**
   * El pie de la factura: lo que está en el comprobante pero no en ningún
   * renglón. Los tres primeros entran al costo del producto (los descuentos
   * restando); el IVA no, porque vuelve como crédito fiscal.
   */
  impuestos: number;
  retenciones: number;
  descuentos: number;
  iva: number;
};

/**
 * El costo real de tener el producto en la góndola.
 *
 * No es lo que dice el renglón de la factura: una percepción de IIBB se paga
 * igual y encarece la mercadería. Se reparte proporcional al valor de cada
 * línea, que es lo que corresponde cuando el cargo es sobre el total.
 *
 * El IVA queda afuera a propósito — ese vuelve como crédito fiscal, así que
 * cargarlo al costo haría ver un margen peor que el real.
 */
function factorProrrateo(netoItems: number, impuestos: number, retenciones: number, descuentos: number) {
  if (netoItems <= 0) return 1;
  return (netoItems + impuestos + retenciones - descuentos) / netoItems;
}

/**
 * Lo que ya se cargó de una entrega, para reabrir el costeo sin perder nada.
 *
 * Devuelve el costo del PAPEL, no el real: el real tiene las percepciones
 * prorrateadas adentro y volver a usarlo se las sumaría por segunda vez.
 */
export type FacturaGuardada = {
  numero: string;
  tipoComprobante: string;
  fechaEmision: string;
  monto: number;
  impuestos: number;
  retenciones: number;
  descuentos: number;
  iva: number;
};

export async function costeoGuardadoDeEntrega(idRecepcion: string): Promise<{
  costos: { idVariante: string; costo: number }[];
  factura: FacturaGuardada | null;
  /**
   * La factura que ya cargó OTRA entrega del mismo pedido.
   *
   * El caso: el proveedor factura el pedido entero el viernes y entrega en
   * dos veces. Al costear la segunda, los datos de la factura tienen que
   * venir puestos y el costo de la primera tiene que sumar — si no, la suma
   * de los ítems nunca va a llegar al total y no se puede cerrar.
   */
  facturaHermana: (FacturaGuardada & { idsRecepcion: string[] }) | null;
}> {
  const permisoError = await requireAdmin();
  if (permisoError) return { costos: [], factura: null, facturaHermana: null };

  const supabase = getSupabaseServerClient();

  const { data: lotes } = await supabase
    .from("detalle_recepcion_proveedor")
    .select("id_variante, costo_neto_factura, costo_unitario")
    .eq("id_recepcion", idRecepcion);

  const costos = (lotes ?? [])
    .map((l) => ({
      idVariante: l.id_variante as string,
      // Si es un costeo viejo, de antes de guardar el neto, se cae al real.
      // No es exacto cuando había percepciones, pero es mucho mejor que
      // dejar el campo vacío y obligar a tipear todo de nuevo.
      costo: (l.costo_neto_factura as number | null) ?? (l.costo_unitario as number | null) ?? 0,
    }))
    .filter((c) => c.costo > 0);

  const { data: recepcion } = await supabase
    .from("recepciones_proveedor")
    .select("id_factura, id_orden")
    .eq("id_recepcion", idRecepcion)
    .maybeSingle();
  if (!recepcion) return { costos, factura: null, facturaHermana: null };

  async function leerFactura(idFactura: string): Promise<FacturaGuardada | null> {
    const { data: f } = await supabase
      .from("facturas_compra_proveedor")
      .select("numero_factura, tipo_comprobante, fecha_emision, monto, impuestos, retenciones, descuentos, iva")
      .eq("id_factura", idFactura)
      .maybeSingle();
    if (!f) return null;
    return {
      numero: (f.numero_factura as string) ?? "",
      tipoComprobante: (f.tipo_comprobante as string) ?? "A",
      fechaEmision: ((f.fecha_emision as string) ?? "").slice(0, 10),
      monto: (f.monto as number) ?? 0,
      impuestos: (f.impuestos as number | null) ?? 0,
      retenciones: (f.retenciones as number | null) ?? 0,
      descuentos: (f.descuentos as number | null) ?? 0,
      iva: (f.iva as number | null) ?? 0,
    };
  }

  // Esta entrega ya tiene su factura: es una corrección.
  if (recepcion.id_factura) {
    return { costos, factura: await leerFactura(recepcion.id_factura as string), facturaHermana: null };
  }

  // No la tiene, pero puede tenerla otra entrega del mismo pedido.
  const { data: hermanas } = await supabase
    .from("recepciones_proveedor")
    .select("id_recepcion, id_factura")
    .eq("id_orden", recepcion.id_orden as string)
    .neq("id_recepcion", idRecepcion)
    .not("id_factura", "is", null);

  const idFacturaHermana = (hermanas ?? [])[0]?.id_factura as string | undefined;
  if (!idFacturaHermana) return { costos, factura: null, facturaHermana: null };

  const f = await leerFactura(idFacturaHermana);
  if (!f) return { costos, factura: null, facturaHermana: null };

  return {
    costos,
    factura: null,
    facturaHermana: {
      ...f,
      // Solo las que cuelgan de ESA factura: un pedido podría tener dos
      // facturas distintas y mezclarlas daría un total inventado.
      idsRecepcion: (hermanas ?? [])
        .filter((h) => h.id_factura === idFacturaHermana)
        .map((h) => h.id_recepcion as string),
    },
  };
}

/**
 * Deshacer un costeo.
 *
 * Es para cuando el costeo no tendría que haber pasado — se costeó la entrega
 * equivocada, o se cargó una factura que no existía. Para un número mal
 * puesto está "Corregir", que es mucho menos ruidoso.
 *
 * La deuda NO se borra: se cancela con un movimiento contrario. Quedan los
 * dos renglones en la cuenta del proveedor, y por eso el saldo se puede
 * explicar. Borrar el original haría que la plata se moviera sin que nadie
 * pueda decir por qué.
 */
export async function anularCosteo(
  idRecepcion: string,
  motivo: string
): Promise<{ error: string | null; aviso?: string }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  if (!motivo.trim()) return { error: "Contá por qué lo anulás: queda en el historial." };

  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    const { data: recepcion } = await supabase
      .from("recepciones_proveedor")
      .select("id_recepcion, id_orden, id_proveedor, id_factura, facturada")
      .eq("id_recepcion", idRecepcion)
      .maybeSingle();
    if (!recepcion) return { error: "No se encontró esa entrega" };
    if (!recepcion.facturada) return { error: "Esta entrega todavía no está costeada." };

    // El candado de siempre: si esa mercadería ya se liquidó, la plata se
    // pagó y deshacerlo dejaría la liquidación y el costo contando historias
    // distintas.
    const { data: lotes } = await supabase
      .from("detalle_recepcion_proveedor")
      .select("id_detalle")
      .eq("id_recepcion", idRecepcion);
    const idsLote = (lotes ?? []).map((l) => l.id_detalle as string);
    if (idsLote.length > 0) {
      const { count } = await supabase
        .from("detalle_liquidacion_proveedor")
        .select("id_detalle", { count: "exact", head: true })
        .in("id_detalle_recepcion", idsLote);
      if ((count ?? 0) > 0) {
        return {
          error:
            "Esta entrega ya entró en una liquidación cerrada: esa plata se le pagó al proveedor y el costeo no se puede deshacer. Si el precio estaba mal, el ajuste va en la liquidación siguiente.",
        };
      }
    }

    // 1) Los lotes vuelven a quedar sin costo.
    await supabase
      .from("detalle_recepcion_proveedor")
      .update({ costo_unitario: null, costo_neto_factura: null })
      .eq("id_recepcion", idRecepcion);

    // 2) La entrega vuelve a "Por costear".
    await supabase
      .from("recepciones_proveedor")
      .update({
        facturada: false,
        id_factura: null,
        resolucion_observaciones: `Costeo anulado por ${usuario ?? "administración"}: ${motivo.trim()}`,
      })
      .eq("id_recepcion", idRecepcion);

    // 3) El reclamo que hubiera nacido de este costeo deja de esperar.
    await supabase
      .from("reclamos_proveedor")
      .update({
        estado: "DESCARTADO",
        resuelto_el: new Date().toISOString(),
        resuelto_por: usuario,
      })
      .eq("id_recepcion", idRecepcion)
      .eq("estado", "PENDIENTE");

    let aviso: string | undefined;

    // 4) La factura y la deuda.
    if (recepcion.id_factura) {
      const { data: hermanas } = await supabase
        .from("recepciones_proveedor")
        .select("id_recepcion")
        .eq("id_factura", recepcion.id_factura as string);

      if ((hermanas ?? []).length > 0) {
        // La factura cubre otras entregas: es un papel real que el proveedor
        // emitió por todas. Se desengancha solo esta y la deuda queda igual.
        aviso =
          "Esa factura también cubre otras entregas, así que sigue vigente y la deuda no cambió. Solo se desenganchó esta entrega.";
      } else {
        const { data: factura } = await supabase
          .from("facturas_compra_proveedor")
          .select("monto, numero_factura")
          .eq("id_factura", recepcion.id_factura as string)
          .maybeSingle();

        await supabase
          .from("facturas_compra_proveedor")
          .update({ estado: "ANULADA" })
          .eq("id_factura", recepcion.id_factura as string);

        if (factura && (factura.monto as number) > 0) {
          // La contrapartida. No se borra el asiento original: se le pone al
          // lado el que lo cancela, y el saldo queda explicado.
          await registrarMovimientoProveedor(supabase, {
            idProveedor: recepcion.id_proveedor as string,
            tipoMovimiento: "AJUSTE",
            importe: -(factura.monto as number),
            idFactura: recepcion.id_factura as string,
            usuario,
            observaciones: `Anulación de la factura ${factura.numero_factura ?? ""}: ${motivo.trim()}`,
          });
          const saldo = await saldoCuentaProveedor(supabase, recepcion.id_proveedor as string);
          if (saldo < 0) {
            aviso = `El saldo quedó a favor tuyo por $${Math.abs(saldo).toLocaleString(
              "es-AR"
            )} — le pagaste algo que ahora quedó anulado.`;
          }
        }
      }
    }

    revalidatePath("/compras/costeo");
    revalidatePath("/proveedores");
    return { error: null, aviso };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo anular el costeo" };
  }
}

export async function costearEntrega(params: {
  idRecepcion: string;
  // `iva` es la alícuota del producto (21 / 10,5 / 0). Se carga acá porque es
  // el momento en que se tiene el remito adelante — y sin ella el crédito
  // fiscal de este proveedor sale mal: en alimentos no todo va al 21%.
  costos: { idVariante: string; costo: number; iva?: number }[];
  /** null para los proveedores que no facturan por entrega. */
  factura?: FacturaDeEntrega | null;
  comprobante?: File | null;
}): Promise<{ error: string | null; aviso?: string }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  try {
    const supabase = getSupabaseServerClient();

    const { data: recepcion, error: errorRecepcion } = await supabase
      .from("recepciones_proveedor")
      .select("id_recepcion, id_orden, id_proveedor")
      .eq("id_recepcion", params.idRecepcion)
      .maybeSingle();
    if (errorRecepcion) return { error: friendlyDbError(errorRecepcion) };
    if (!recepcion) return { error: "No se encontró esa entrega" };

    // Un costo se puede corregir hasta que se liquide. Después no: esa plata
    // ya se le pagó al proveedor, y cambiarla acá haría que la liquidación
    // vieja y el costo del producto cuenten historias distintas. El ajuste va
    // en la liquidación siguiente.
    //
    // El control va acá y no solo en la pantalla porque un archivo
    // "use server" es un endpoint: quien esté logueado puede llamarlo con el
    // id que quiera.
    const { data: lotes } = await supabase
      .from("detalle_recepcion_proveedor")
      .select("id_detalle, id_variante, cantidad_recibida")
      .eq("id_recepcion", recepcion.id_recepcion);
    const idsLote = (lotes ?? []).map((l) => l.id_detalle as string);
    if (idsLote.length > 0) {
      const { count } = await supabase
        .from("detalle_liquidacion_proveedor")
        .select("id_detalle", { count: "exact", head: true })
        .in("id_detalle_recepcion", idsLote);
      if ((count ?? 0) > 0) {
        return {
          error:
            "Esta entrega ya entró en una liquidación cerrada, así que su costo no se puede cambiar. Si el precio estaba mal, se ajusta en la próxima liquidación.",
        };
      }
    }

    // ---------- Los costos ----------
    //
    // Se guardan DOS números distintos por línea, y son distintos a propósito:
    //
    // - `precio_unitario_real` en el detalle de la factura: lo que dice el
    //   papel. Es lo que se mira cuando alguien va a auditar.
    // - `costo_unitario` en el lote: el costo real con las percepciones
    //   prorrateadas. Es el que consume el FIFO y con el que se calcula el
    //   margen, porque esa plata se pagó igual.
    const cantidadPorVariante = new Map(
      (lotes ?? []).map((l) => [l.id_variante as string, (l.cantidad_recibida as number) ?? 0])
    );
    const netoItems = params.costos.reduce(
      (acc, c) => acc + (c.costo > 0 ? c.costo * (cantidadPorVariante.get(c.idVariante) ?? 0) : 0),
      0
    );
    const factor = params.factura
      ? factorProrrateo(
          netoItems,
          params.factura.impuestos || 0,
          params.factura.retenciones || 0,
          params.factura.descuentos || 0
        )
      : 1;

    const costoAnteriorPorVariante = new Map<string, number | null>();
    const costoFinalPorVariante = new Map<string, number>();
    for (const item of params.costos) {
      if (item.costo <= 0) continue;
      // Un renglón que no trajo nada no se costea. El lote está vacío, así
      // que el costo no cambiaría ningún FIFO — pero sí pisaría el costo de
      // referencia del producto con el precio de una entrega que no ocurrió.
      if ((cantidadPorVariante.get(item.idVariante) ?? 0) <= 0) continue;
      const { data: variante } = await supabase
        .from("variantes_producto")
        .select("id_producto")
        .eq("id_variante", item.idVariante)
        .maybeSingle();
      if (!variante) continue;

      const { data: producto } = await supabase
        .from("productos")
        .select("costo_informado")
        .eq("id_producto", variante.id_producto)
        .maybeSingle();
      costoAnteriorPorVariante.set(item.idVariante, producto?.costo_informado ?? null);

      const costoFinal = redondear2(item.costo * factor);
      costoFinalPorVariante.set(item.idVariante, costoFinal);

      const cambios: Record<string, unknown> = { costo_informado: costoFinal };
      // Solo se pisa la alícuota si vino en el formulario: no queremos que
      // un costeo hecho desde una pantalla vieja le ponga 21% a un producto
      // que estaba bien marcado al 10,5%.
      if (item.iva !== undefined && Number.isFinite(item.iva) && item.iva >= 0 && item.iva <= 100) {
        cambios.iva_porcentaje = item.iva;
      }

      const { error } = await supabase.from("productos").update(cambios).eq("id_producto", variante.id_producto);
      if (error) return { error: friendlyDbError(error) };

      // Los dos números: el real (con el pie prorrateado) que consume el
      // FIFO, y el del papel, que es el que hay que volver a mostrar cuando
      // alguien entra a corregir este costeo.
      await supabase
        .from("detalle_recepcion_proveedor")
        .update({ costo_unitario: costoFinal, costo_neto_factura: item.costo })
        .eq("id_recepcion", recepcion.id_recepcion)
        .eq("id_variante", item.idVariante);
    }

    // ---------- El comprobante ----------
    const marcaEntrega: Record<string, unknown> = { facturada: true };
    if (params.comprobante && params.comprobante.size > 0) {
      const extension = params.comprobante.name.split(".").pop() ?? "jpg";
      // Por recepción y no por orden: dos entregas del mismo pedido tienen
      // remitos distintos y antes el segundo pisaba al primero.
      const path = `recepcion-${recepcion.id_recepcion}.${extension}`;
      const { error: errorUpload } = await supabase.storage
        .from("comprobantes-proveedor")
        .upload(path, params.comprobante, { upsert: true, contentType: params.comprobante.type || undefined });
      // No bloquea el guardado si falla la subida — se puede reintentar después.
      if (!errorUpload) marcaEntrega.comprobante_path = path;
    }

    // ---------- Sin factura: termina acá (caso Alifrut) ----------
    if (!params.factura) {
      await supabase.from("recepciones_proveedor").update(marcaEntrega).eq("id_recepcion", recepcion.id_recepcion);
      revalidatePath("/compras/costeo");
      revalidatePath("/proveedores");
      revalidatePath("/productos");
      return { error: null };
    }

    // ---------- Con factura ----------
    const f = params.factura;
    if (!f.numero.trim()) return { error: "Falta el número de factura" };
    if (!f.fechaEmision) return { error: "Falta la fecha de la factura" };
    if (f.monto <= 0) return { error: "El total de la factura tiene que ser mayor a 0" };

    // Las entregas cubiertas tienen que ser de este mismo proveedor: si no,
    // una factura podría marcar como pagada la mercadería de otro.
    const cubiertas = Array.from(new Set([...f.idsRecepcionCubiertas, recepcion.id_recepcion]));
    const { data: validas } = await supabase
      .from("recepciones_proveedor")
      .select("id_recepcion")
      .in("id_recepcion", cubiertas)
      .eq("id_proveedor", recepcion.id_proveedor);
    const idsValidos = (validas ?? []).map((r) => r.id_recepcion as string);
    if (idsValidos.length !== cubiertas.length) {
      return { error: "Alguna de las entregas seleccionadas no es de este proveedor." };
    }

    // ¿Esta factura ya está cargada? Entonces esta entrega se suma a la que
    // ya existe: se vincula, no se vuelve a deber. Es el caso de "una sola
    // factura para dos entregas".
    const { data: yaCargada } = await supabase
      .from("facturas_compra_proveedor")
      .select("id_factura")
      .eq("id_proveedor", recepcion.id_proveedor)
      .eq("numero_factura", f.numero.trim())
      .neq("estado", "ANULADA")
      .maybeSingle();

    const mal = f.malFacturado;
    const totalReclamo = mal
      ? redondear2((mal.neto || 0) + (mal.iva || 0) + (mal.impuestos || 0) + (mal.retenciones || 0))
      : 0;
    if (mal && totalReclamo <= 0) {
      return { error: "Marcaste que facturó algo mal pero no pusiste ningún importe." };
    }
    if (mal && !mal.motivo.trim()) {
      return { error: "Contá qué facturó mal: sin eso el reclamo no le sirve a nadie." };
    }
    const notaDiscrepancia = mal
      ? `EL PROVEEDOR FACTURÓ ALGO MAL por $${totalReclamo.toLocaleString("es-AR")}: ${mal.motivo.trim()}`
      : null;

    let idFactura: string;
    let aviso: string | undefined;

    if (yaCargada) {
      idFactura = yaCargada.id_factura as string;
      aviso = `La factura ${f.numero.trim()} ya estaba cargada: esta entrega se sumó a ella y no se generó deuda nueva.`;
    } else {
      const iva = f.iva && f.iva > 0 ? redondear2(f.iva) : null;
      const { data: creada, error: errorFactura } = await supabase
        .from("facturas_compra_proveedor")
        .insert({
          id_proveedor: recepcion.id_proveedor,
          id_orden: recepcion.id_orden,
          numero_factura: f.numero.trim(),
          tipo_comprobante: f.tipoComprobante || null,
          fecha_emision: f.fechaEmision,
          fecha_vencimiento: f.fechaVencimiento || null,
          monto: f.monto,
          // El neto es el subtotal SIN IVA, que ya incluye lo del pie: es lo
          // que realmente costó la mercadería.
          neto: iva ? redondear2(f.monto - iva) : null,
          iva,
          impuestos: f.impuestos || null,
          retenciones: f.retenciones || null,
          descuentos: f.descuentos || null,
          estado: "PENDIENTE",
          observaciones: notaDiscrepancia,
        })
        .select("id_factura")
        .single();
      if (errorFactura) return { error: friendlyDbError(errorFactura) };
      idFactura = creada.id_factura as string;

      // La deuda nace acá, una sola vez por factura.
      await registrarMovimientoProveedor(supabase, {
        idProveedor: recepcion.id_proveedor,
        tipoMovimiento: "FACTURA_COMPRA",
        importe: f.monto,
        idFactura,
        usuario: await usuarioActual(),
        observaciones: `Factura ${f.numero.trim()}`,
      });
    }

    // El detalle de lo que aporta ESTA entrega a la factura. Sirve para el
    // control de que la suma de las entregas cuadre con el total facturado.
    for (const lote of lotes ?? []) {
      const costo = params.costos.find((c) => c.idVariante === lote.id_variante)?.costo ?? 0;
      if (costo <= 0) continue;
      await supabase.from("detalle_factura_compra").insert({
        id_factura: idFactura,
        id_variante: lote.id_variante,
        cantidad_facturada: lote.cantidad_recibida,
        // El del papel, sin prorrateo: es contra este número que se audita
        // la factura. El costo real con impuestos vive en el lote.
        precio_unitario_real: costo,
        costo_anterior: costoAnteriorPorVariante.get(lote.id_variante as string) ?? null,
      });
    }

    if (mal && notaDiscrepancia) {
      marcaEntrega.resolucion_observaciones = notaDiscrepancia;
      marcaEntrega.revisado_por_administracion = false;

      // El reclamo con su importe, para que aparezca en la lista de lo que
      // hay que ir a cobrar. Sin esto quedaba solo un texto adentro de una
      // factura, que nadie vuelve a mirar.
      const { error: errorReclamo } = await supabase.from("reclamos_proveedor").insert({
        id_proveedor: recepcion.id_proveedor,
        id_factura: idFactura,
        id_recepcion: recepcion.id_recepcion,
        neto: redondear2(mal.neto || 0),
        iva: redondear2(mal.iva || 0),
        impuestos: redondear2(mal.impuestos || 0),
        retenciones: redondear2(mal.retenciones || 0),
        total: totalReclamo,
        motivo: mal.motivo.trim(),
        estado: "PENDIENTE",
        usuario: await usuarioActual(),
      });
      if (errorReclamo) return { error: friendlyDbError(errorReclamo) };

      aviso = `${aviso ? aviso + " " : ""}Queda un reclamo de nota de crédito por $${totalReclamo.toLocaleString(
        "es-AR"
      )}.`;
    }

    // Recién ahora se marcan las entregas cubiertas. Solo estas: nunca todas
    // las del pedido, que es lo que hacía que facturar la primera entrega
    // tapara la segunda y esa mercadería quedara sin costo, en silencio.
    marcaEntrega.id_factura = idFactura;
    await supabase.from("recepciones_proveedor").update(marcaEntrega).eq("id_recepcion", recepcion.id_recepcion);
    const otras = idsValidos.filter((id) => id !== recepcion.id_recepcion);
    if (otras.length > 0) {
      await supabase
        .from("recepciones_proveedor")
        .update({ facturada: true, id_factura: idFactura })
        .in("id_recepcion", otras);
    }

    revalidatePath("/compras/costeo");
    revalidatePath("/proveedores");
    revalidatePath("/productos");
    return { error: null, aviso };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo guardar el costeo" };
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
  // IVA discriminado en la factura (opcional) — el monto total de la
  // factura NO cambia de significado (sigue siendo el total, igual que
  // siempre, para no romper la comparación contra "total calculado" ni el
  // costo por unidad que ya se usa para costo_informado). Esto es solo
  // para poder sumarlo después como Crédito Fiscal en IVA a pagar.
  iva?: number | null;
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

    const iva = params.iva && params.iva > 0 ? redondear2(params.iva) : null;
    const neto = iva ? redondear2(params.monto - iva) : null;

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
        neto,
        iva,
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
    //
    // El corte por fecha importa desde que un pedido puede llegar en varias
    // entregas: una factura no puede cubrir mercadería que entró después de
    // emitirla. Sin esto, facturar la primera entrega tapaba la segunda y esa
    // mercadería quedaba sin costo, en silencio.
    if (params.idOrden) {
      await supabase
        .from("recepciones_proveedor")
        .update({ facturada: true })
        .eq("id_orden", params.idOrden)
        .lte("fecha", `${params.fechaEmision}T23:59:59`);
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

/** El detalle para la pantalla: por medio de pago, por producto y por lote. */
export async function detalleLiquidacionProveedorAction(
  idProveedor: string,
  fechaDesde: string,
  fechaHasta: string
) {
  const supabase = getSupabaseServerClient();
  return detalleLiquidacionProveedor(supabase, idProveedor, fechaDesde, fechaHasta);
}

/**
 * Corrige el costo de un lote puntual y, si hace falta, la alícuota del
 * producto.
 *
 * Existe porque el error se descubre mirando la liquidación, no al costear:
 * ahí es donde se ve que un margen no cierra. Obligar a volver a la
 * recepción para corregirlo hace que nadie lo corrija.
 *
 * Solo se puede sobre lotes que todavía no se liquidaron — una vez que la
 * liquidación se cerró, ese costo ya se pagó y cambiarlo sería reescribir el
 * pasado.
 */
export async function corregirCostoLote(
  idDetalleRecepcion: string,
  costo: number,
  iva?: number
): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  if (!Number.isFinite(costo) || costo <= 0) return { error: "El costo tiene que ser mayor a cero." };

  try {
    const supabase = getSupabaseServerClient();

    const { data: lote } = await supabase
      .from("detalle_recepcion_proveedor")
      .select("id_detalle, id_variante")
      .eq("id_detalle", idDetalleRecepcion)
      .maybeSingle();
    if (!lote) return { error: "No se encontró ese lote." };

    const { count } = await supabase
      .from("detalle_liquidacion_proveedor")
      .select("id_detalle", { count: "exact", head: true })
      .eq("id_detalle_recepcion", idDetalleRecepcion);
    if ((count ?? 0) > 0) {
      return {
        error:
          "Ese lote ya entró en una liquidación cerrada, así que su costo no se puede cambiar. Si el precio estaba mal, se ajusta en la próxima liquidación.",
      };
    }

    // Los dos, para que no queden contando historias distintas: acá se está
    // fijando el costo real del lote a mano, así que el "número del papel"
    // deja de ser el de la factura y pasa a ser este.
    const { error } = await supabase
      .from("detalle_recepcion_proveedor")
      .update({ costo_unitario: costo, costo_neto_factura: costo })
      .eq("id_detalle", idDetalleRecepcion);
    if (error) return { error: friendlyDbError(error) };

    if (iva !== undefined && Number.isFinite(iva) && iva >= 0 && iva <= 100) {
      const { data: variante } = await supabase
        .from("variantes_producto")
        .select("id_producto")
        .eq("id_variante", lote.id_variante)
        .maybeSingle();
      if (variante) {
        await supabase.from("productos").update({ iva_porcentaje: iva }).eq("id_producto", variante.id_producto);
      }
    }

    revalidatePath("/proveedores");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo corregir el costo" };
  }
}

export type LiquidacionSinFactura = {
  idLiquidacion: string;
  fechaDesde: string;
  fechaHasta: string;
  montoFinal: number;
  fecha: string;
};

/**
 * Las liquidaciones que todavía no tienen cargada la factura del proveedor.
 *
 * Cada una es crédito fiscal esperando: hasta que no se carga, ese IVA no
 * entra en IVA a pagar.
 */
export async function liquidacionesSinFactura(idProveedor: string): Promise<LiquidacionSinFactura[]> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("liquidaciones_proveedor")
    .select("id_liquidacion, fecha_desde, fecha_hasta, monto_final, fecha")
    .eq("id_proveedor", idProveedor)
    .is("factura_numero", null)
    .order("fecha_hasta", { ascending: false })
    .limit(24);

  return (data ?? []).map((l) => ({
    idLiquidacion: l.id_liquidacion as string,
    fechaDesde: l.fecha_desde as string,
    fechaHasta: l.fecha_hasta as string,
    montoFinal: (l.monto_final as number) ?? 0,
    fecha: (l.fecha as string) ?? "",
  }));
}

/**
 * La factura que emitió el proveedor por la liquidación del período.
 *
 * Es lo que hace nacer el crédito fiscal: hasta que no se carga, el IVA de
 * todo lo vendido de este proveedor no aparece en IVA a pagar (ver
 * contabilidad/actions.ts). Se guarda lo que dice la factura de papel, que
 * puede no coincidir con lo calculado — si no coincide, se muestra la
 * diferencia en vez de taparla.
 */
export async function cargarFacturaLiquidacion(params: {
  idLiquidacion: string;
  numero: string;
  neto: number;
  iva: number;
  fecha: string;
}): Promise<{ error: string | null; aviso?: string }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const numero = params.numero.trim();
  if (!numero) return { error: "Poné el número de la factura." };
  if (!Number.isFinite(params.neto) || params.neto <= 0) return { error: "El neto tiene que ser mayor a cero." };
  if (!Number.isFinite(params.iva) || params.iva < 0) return { error: "El IVA no puede ser negativo." };
  if (!params.fecha) return { error: "Poné la fecha de la factura." };

  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    const { data: liq } = await supabase
      .from("liquidaciones_proveedor")
      .select("id_liquidacion, monto_final, factura_numero")
      .eq("id_liquidacion", params.idLiquidacion)
      .maybeSingle();
    if (!liq) return { error: "No se encontró la liquidación." };
    if (liq.factura_numero) return { error: "Esta liquidación ya tiene su factura cargada." };

    const total = redondear2(params.neto + params.iva);

    const { error } = await supabase
      .from("liquidaciones_proveedor")
      .update({
        factura_numero: numero,
        factura_neto: redondear2(params.neto),
        factura_iva: redondear2(params.iva),
        factura_total: total,
        factura_fecha: params.fecha,
        factura_cargada_el: new Date().toISOString(),
        factura_cargada_por: usuario,
      })
      .eq("id_liquidacion", params.idLiquidacion);
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/proveedores");
    revalidatePath("/iva-a-pagar");

    // La diferencia se avisa, no se corrige sola: puede ser una nota de
    // crédito, un redondeo o un error del proveedor, y cada caso se resuelve
    // distinto.
    const diferencia = redondear2(total - ((liq.monto_final as number) ?? 0));
    if (Math.abs(diferencia) >= 1) {
      return {
        error: null,
        aviso:
          `La factura dice $${total.toLocaleString("es-AR")} y la liquidación calculó $${((liq.monto_final as number) ?? 0).toLocaleString("es-AR")}. ` +
          `Hay ${diferencia > 0 ? "de más" : "de menos"} $${Math.abs(diferencia).toLocaleString("es-AR")} — revisalo con el proveedor.`,
      };
    }
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cargar la factura" };
  }
}

export async function generarLiquidacionProveedorAction(params: {
  idProveedor: string;
  fechaDesde: string;
  fechaHasta: string;
  montoFinal: number;
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
    revalidatePath("/gastos-ingresos");
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
