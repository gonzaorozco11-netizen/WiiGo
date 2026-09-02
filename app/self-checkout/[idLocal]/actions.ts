"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { calcularBeneficioReferido, resolverCodigoProfesional } from "@/lib/referidosProfesionales";
import { buscarProfesionalPorDni, verificarPinProfesional, calcularDescuentoCanje, esProfesionalActivo } from "@/lib/canjesProfesionales";
import { calcularCanjePuntos } from "@/lib/puntosWiigo";
import { crearOrdenQrMp } from "@/lib/mercadopago";
import { turnoAbiertoDeLocal } from "@/app/(app)/turnos/actions";
import { montoQuePideDni } from "@/lib/arca/config";
import QRCode from "qrcode";

type ItemCarrito = { idVariante: string; idMarca: string | null; cantidad: number; precioUnitario: number };
type MedioPago = "EFECTIVO" | "MERCADO_PAGO";

type ResultadoPedido = { idVenta: string; numero: number; total: number; descuento: number; qrImagen?: string };

// El totem queda prendido todo el día sin recargarse — sin esto, el stock
// que trajo el servidor al abrirse la pestaña se iría desactualizando con
// cada entrega, ajuste o venta que pase mientras tanto en cualquier otro
// lado (POS, otro totem, Stock). Se consulta cada pocos segundos para que
// el stock disponible esté siempre al día, sin depender de un refresh.
export async function obtenerStockLocal(idLocal: string): Promise<{ idVariante: string; cantidad: number }[]> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase.from("stock").select("id_variante, cantidad").eq("id_local", idLocal);
  return (data ?? []).map((s) => ({ idVariante: s.id_variante as string, cantidad: s.cantidad as number }));
}

// Next.js redacta en producción el mensaje de un Error tirado desde una
// Server Action (queda solo un digest genérico en el navegador) — por eso
// esta función no throwea para errores esperables: devuelve { error }.
export async function buscarProfesionalPorDniAction(dni: string) {
  const supabase = getSupabaseServerClient();
  return buscarProfesionalPorDni(supabase, dni);
}

// Confirmación en vivo mientras se escribe el DNI del cliente (no del
// profesional) — sin esto el campo quedaba mudo, sin ningún aviso de que
// se está reconociendo (o va a crear) al cliente.
export async function buscarClientePorDniAction(
  dni: string
): Promise<{ existe: boolean; puntos: number; nombre: string | null } | null> {
  const dniLimpio = dni.trim();
  if (dniLimpio.length < 6) return null;
  const supabase = getSupabaseServerClient();
  const { data } = await supabase.from("clientes").select("nombre, puntos").eq("dni", dniLimpio).maybeSingle();
  return data ? { existe: true, puntos: data.puntos ?? 0, nombre: data.nombre ?? null } : { existe: false, puntos: 0, nombre: null };
}

// Confirmación en vivo mientras se escribe el código, igual que el DNI —
// sin esto el campo quedaba mudo hasta terminar de armar el pedido.
export async function buscarCodigoProfesionalAction(codigo: string): Promise<{ nombre: string | null; error: string | null }> {
  if (!codigo.trim()) return { nombre: null, error: null };
  const supabase = getSupabaseServerClient();
  const resuelto = await resolverCodigoProfesional(supabase, codigo);
  if (resuelto.error) return { nombre: null, error: resuelto.error };
  if (!resuelto.idProfesional) return { nombre: null, error: null };
  const { data } = await supabase
    .from("profesionales")
    .select("nombre, apellido")
    .eq("id_profesional", resuelto.idProfesional)
    .maybeSingle();
  return { nombre: data ? `${data.nombre}${data.apellido ? ` ${data.apellido}` : ""}` : null, error: null };
}

// Vista previa en vivo de cuánto descuento le da al cliente el código de
// profesional (si la marca de esos productos eligió "Descuento en el
// momento" en vez de "Puntos extra") — separado de buscarCodigoProfesionalAction,
// que solo confirma el nombre. Sin esto el total no cambiaba en pantalla
// aunque confirmarPedido ya calculaba el descuento bien.
// `dni` es el del comprador: una profesional no puede aplicarse a sí misma
// el código de descuento (ni el suyo ni el de otra) — ver confirmarPedido.
export async function previsualizarDescuentoReferidoAction(
  codigo: string,
  items: { idMarca: string | null; cantidad: number; precioUnitario: number }[],
  dni?: string
): Promise<number> {
  if (!codigo.trim() || items.length === 0) return 0;
  const supabase = getSupabaseServerClient();
  const compradorEsProfesional = await esProfesionalActivo(supabase, dni?.trim() || null);
  if (compradorEsProfesional) return 0;
  const resuelto = await resolverCodigoProfesional(supabase, codigo);
  if (resuelto.error || !resuelto.idCodigo) return 0;
  const resultado = await calcularBeneficioReferido(
    supabase,
    items.map((i) => ({
      idProducto: null,
      idMarca: i.idMarca,
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario,
      importe: i.precioUnitario * i.cantidad,
    }))
  );
  return resultado.descuentoTotal;
}

// Para mostrarle al cliente, en vivo, cuánto puede cubrir con sus puntos
// WiiGo antes de confirmar el pedido.
export async function infoCanjePuntosAction(dni: string, montoAPagar: number) {
  const supabase = getSupabaseServerClient();
  const dniLimpio = dni.trim();
  if (!dniLimpio) return null;
  const { data: cliente } = await supabase.from("clientes").select("id_cliente").eq("dni", dniLimpio).maybeSingle();
  if (!cliente) return null;
  return calcularCanjePuntos(supabase, cliente.id_cliente, montoAPagar);
}

export async function confirmarPedido(
  idLocal: string,
  itemsPedido: ItemCarrito[],
  dni: string,
  codigoProfesional: string,
  medioPago: MedioPago,
  canje?: { idProfesional: string; pin: string; marcas: string[] },
  usarPuntosWiigo?: boolean,
  // DNI que el cliente carga solo cuando la compra supera el monto a partir
  // del cual ARCA exige identificar al comprador. No tiene nada que ver con
  // el `dni` de arriba, que es el de los puntos WiiGo — puede venir uno, el
  // otro, o ninguno.
  dniFacturacion?: string
): Promise<{ error: string | null; pedido?: ResultadoPedido }> {
  if (itemsPedido.length === 0) return { error: "El carrito está vacío" };

  try {
    const supabase = getSupabaseServerClient();

    // El totem es una pantalla pública sin login — nunca hay que confiar en
    // el precio, la marca ni el stock disponible que manda el navegador,
    // porque se puede armar ese pedido a mano contra esta Server Action con
    // cualquier valor. Acá se vuelve a mirar todo contra la base real antes
    // de crear la venta.
    const idsVariante = [...new Set(itemsPedido.map((i) => i.idVariante))];
    const { data: variantesDb, error: errorVariantes } = await supabase
      .from("variantes_producto")
      .select("id_variante, id_producto, precio_venta, estado")
      .in("id_variante", idsVariante);
    if (errorVariantes) return { error: friendlyDbError(errorVariantes) };

    const idsProducto = [...new Set((variantesDb ?? []).map((v) => v.id_producto as string))];
    const { data: productosDb, error: errorProductos } = await supabase
      .from("productos")
      .select("id_producto, id_marca, precio_venta, descuento_porcentaje, estado")
      .in("id_producto", idsProducto);
    if (errorProductos) return { error: friendlyDbError(errorProductos) };

    const { data: stockDb, error: errorStockCheck } = await supabase
      .from("stock")
      .select("id_variante, cantidad")
      .eq("id_local", idLocal)
      .in("id_variante", idsVariante);
    if (errorStockCheck) return { error: friendlyDbError(errorStockCheck) };

    const varianteMap = new Map((variantesDb ?? []).map((v) => [v.id_variante as string, v]));
    const productoMap = new Map((productosDb ?? []).map((p) => [p.id_producto as string, p]));
    const stockMap = new Map((stockDb ?? []).map((s) => [s.id_variante as string, s.cantidad as number]));

    const items: ItemCarrito[] = [];
    for (const itemPedido of itemsPedido) {
      if (itemPedido.cantidad <= 0) return { error: "Cantidad inválida en el carrito." };

      const variante = varianteMap.get(itemPedido.idVariante);
      const producto = variante ? productoMap.get(variante.id_producto as string) : undefined;
      if (!variante || variante.estado !== "ACTIVO" || !producto || producto.estado !== "ACTIVO") {
        return { error: "Uno de los productos del carrito ya no está disponible — volvé a armar el pedido." };
      }

      const disponible = stockMap.get(itemPedido.idVariante) ?? 0;
      if (itemPedido.cantidad > disponible) {
        return {
          error:
            disponible > 0
              ? `Ya no queda esa cantidad disponible — quedan ${disponible} unidades. Ajustá el carrito.`
              : "Ese producto se acaba de quedar sin stock. Sacalo del carrito para continuar.",
        };
      }

      const base = (variante.precio_venta as number | null) ?? (producto.precio_venta as number | null) ?? 0;
      const descuento = (producto.descuento_porcentaje as number | null) ?? 0;
      const precioReal = descuento > 0 ? Math.round(base * (1 - descuento / 100)) : base;

      items.push({
        idVariante: itemPedido.idVariante,
        idMarca: producto.id_marca as string,
        cantidad: itemPedido.cantidad,
        precioUnitario: precioReal,
      });
    }

    // Identificar al cliente por DNI, si lo cargó — pero solo si ya está
    // registrado. El totem no crea clientes nuevos solo: no hay nadie del
    // local ahí para cargarlo con sus datos reales, así que un DNI que no
    // está en el sistema simplemente no suma puntos en esta compra (recién
    // va a sumar cuando alguien del local lo registre en Clientes).
    let idCliente: string | null = null;
    const dniLimpio = dni.trim();
    if (dniLimpio) {
      const { data: existente } = await supabase
        .from("clientes")
        .select("id_cliente")
        .eq("dni", dniLimpio)
        .maybeSingle();
      idCliente = existente?.id_cliente ?? null;
    }

  const subtotal = items.reduce((acc, i) => acc + i.precioUnitario * i.cantidad, 0);

  // Una profesional no puede usar el código de descuento de otra (ni el
  // suyo propio) para su propia compra — el beneficio de referido es para
  // sus pacientes/clientes, no tiene sentido que se lo aplique ella misma.
  const compradorEsProfesional = await esProfesionalActivo(supabase, dniLimpio || null);

  // El código solo se valida y se calcula el descuento acá (hace falta para
  // el total que ve el cliente) — el referido en sí (con su detalle y la
  // comisión del profesional) recién se registra cuando el personal
  // confirma el cobro, ver confirmarCobro en cobros-efectivo/actions.ts. Así
  // no queda un referido de un carrito que el cliente termina abandonando.
  const codigoResuelto = compradorEsProfesional
    ? { error: null, idCodigo: null, idProfesional: null, usosActuales: 0 }
    : await resolverCodigoProfesional(supabase, codigoProfesional);
  if (codigoResuelto.error) return { error: codigoResuelto.error };

  let descuentoBeneficio = 0;
  if (codigoResuelto.idCodigo) {
    const resultado = await calcularBeneficioReferido(
      supabase,
      items.map((i) => ({ idProducto: null, idMarca: i.idMarca, cantidad: i.cantidad, precioUnitario: i.precioUnitario, importe: i.precioUnitario * i.cantidad }))
    );
    descuentoBeneficio = resultado.descuentoTotal;
  }

  // El profesional puede pagar su propia compra con el saldo que acumuló
  // vendiendo cada marca — el DNI solo no alcanza, hace falta su PIN. El
  // canje en sí (descontarle el saldo de verdad) recién se confirma cuando
  // el personal cobra, ver confirmarCobro en cobros-efectivo/actions.ts —
  // por eso acá solo se guarda la intención (qué marcas eligió).
  let descuentoCanje = 0;
  if (canje && canje.marcas.length > 0) {
    const pinOk = await verificarPinProfesional(supabase, canje.idProfesional, canje.pin);
    if (!pinOk) return { error: "PIN incorrecto." };
    const resultadoCanje = await calcularDescuentoCanje(
      supabase,
      canje.idProfesional,
      canje.marcas,
      items.map((i) => ({ idMarca: i.idMarca, importe: i.precioUnitario * i.cantidad }))
    );
    if (resultadoCanje.error) return { error: resultadoCanje.error };
    descuentoCanje = resultadoCanje.descuentoTotal;
  }

  // El cliente puede cubrir parte de lo que le queda por pagar con sus
  // propios puntos WiiGo — solo se calcula acá (para el total que ve en la
  // pantalla), el descuento real de clientes.puntos recién se aplica cuando
  // el personal confirma el cobro (mismo criterio que el resto de esta
  // función: nada se descuenta hasta que la venta esté efectivamente paga).
  let descuentoPuntos = 0;
  let puntosACanjear = 0;
  if (usarPuntosWiigo && idCliente) {
    const montoAntesDePuntos = Math.max(subtotal - descuentoBeneficio - descuentoCanje, 0);
    const infoPuntos = await calcularCanjePuntos(supabase, idCliente, montoAntesDePuntos);
    descuentoPuntos = infoPuntos.maxDescuento;
    puntosACanjear = infoPuntos.puntosNecesarios;
  }

  const total = Math.max(subtotal - descuentoBeneficio - descuentoCanje - descuentoPuntos, 0);

  // El documento que va a la factura. No se confía en que la pantalla haya
  // mandado algo: se valida acá, igual que el resto de los datos del totem,
  // que es una pantalla pública. Sirve el DNI que el cliente cargó para
  // facturar o, si no, el que ya usó para sus puntos WiiGo.
  const documentoFacturacion =
    (dniFacturacion ?? "").replace(/\D/g, "") || (dni ?? "").replace(/\D/g, "") || null;

  // El monto lo vuelve a chequear el servidor: si la compra lo supera y no
  // llegó ningún documento, la factura la va a rechazar ARCA. Mejor frenar
  // acá, antes de cobrar, que quedar con una venta cobrada sin poder
  // facturarla.
  const montoLimite = await montoQuePideDni();
  if (montoLimite > 0 && total >= montoLimite && !documentoFacturacion) {
    return { error: "Por el monto de la compra necesitamos tu DNI. Volvé atrás y cargalo, por favor." };
  }

  // Con Mercado Pago la plata del cliente se mueve apenas escanea el QR —
  // si en ese momento no hay turno abierto, la confirmación automática del
  // webhook se rechaza (confirmarCobro la exige) y el pedido queda
  // PENDIENTE_PAGO para siempre con el cliente ya habiendo pagado, sin que
  // nadie se entere solo. Mejor no generar el QR directamente si no hay
  // turno — con Efectivo no hace falta este chequeo acá porque no se mueve
  // nada hasta que el personal confirma el cobro a mano.
  if (medioPago === "MERCADO_PAGO" && total > 0) {
    const idTurno = await turnoAbiertoDeLocal(supabase, idLocal);
    if (!idTurno) {
      return { error: "Este local todavía no abrió caja — pedile a alguien del local que te ayude." };
    }
  }

  const { data: venta, error: errorVenta } = await supabase
    .from("ventas")
    .insert({
      canal: "SELF_CHECKOUT",
      id_cliente: idCliente,
      id_local: idLocal,
      subtotal,
      descuento: descuentoBeneficio + descuentoCanje + descuentoPuntos,
      descuento_puntos: descuentoPuntos,
      puntos_canjeados: puntosACanjear,
      total,
      estado: "PENDIENTE_PAGO",
      medio_pago: medioPago,
      usuario: "CLIENTE",
      terminal: `SELF-${idLocal.slice(0, 6).toUpperCase()}`,
      id_codigo_profesional: codigoResuelto.idCodigo,
      id_profesional_canje: canje && canje.marcas.length > 0 ? canje.idProfesional : null,
      marcas_canje: canje && canje.marcas.length > 0 ? canje.marcas : null,
      // Queda estampado en la venta para que la facturación lo encuentre
      // después: el cobro lo puede confirmar el webhook de Mercado Pago, que
      // no sabe nada de lo que se cargó en la pantalla. 96 = DNI.
      // El totem factura siempre a consumidor final, nunca Factura A.
      factura_doc_tipo: documentoFacturacion ? 96 : null,
      factura_doc_nro: documentoFacturacion,
    })
    .select("id_venta, numero")
    .single();
  if (errorVenta) return { error: friendlyDbError(errorVenta) };

  const filasDetalle = items.map((i) => ({
    id_venta: venta.id_venta,
    id_variante: i.idVariante,
    id_marca: i.idMarca,
    cantidad: i.cantidad,
    precio_unitario: i.precioUnitario,
    subtotal: i.precioUnitario * i.cantidad,
  }));
  const { error: errorDetalle } = await supabase.from("detalle_ventas").insert(filasDetalle);
  if (errorDetalle) return { error: friendlyDbError(errorDetalle) };

    let qrImagen: string | undefined;
    if (medioPago === "MERCADO_PAGO" && total > 0) {
      const { data: cfg } = await supabase
        .from("configuracion")
        .select("valor")
        .eq("parametro", "MP_EXTERNAL_POS_ID")
        .maybeSingle();
      const externalPosId = cfg?.valor;
      if (!externalPosId) {
        return { error: "Mercado Pago todavía no está conectado — pedile a un administrador que lo conecte en Configuración." };
      }
      try {
        const orden = await crearOrdenQrMp({
          idVenta: venta.id_venta,
          total,
          externalPosId,
          descripcion: `Pedido WiiGo #${venta.numero}`,
        });
        qrImagen = await QRCode.toDataURL(orden.qrData, { margin: 1, width: 400 });
        await supabase.from("ventas").update({ id_orden_mp: orden.idOrden }).eq("id_venta", venta.id_venta);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "No se pudo generar el QR de Mercado Pago" };
      }
    }

    return {
      error: null,
      pedido: {
        idVenta: venta.id_venta,
        numero: venta.numero as number,
        total,
        descuento: descuentoBeneficio + descuentoPuntos,
        qrImagen,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo confirmar el pedido" };
  }
}

// El totem consulta esto cada pocos segundos mientras espera que el
// personal confirme el cobro en efectivo (o, a futuro, que Mercado Pago
// avise el pago vía webhook) — así la pantalla pasa sola al ticket final
// sin que el cliente tenga que tocar nada.
export async function estadoPedido(idVenta: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("ventas")
    .select("estado, numero, total")
    .eq("id_venta", idVenta)
    .maybeSingle();
  if (error) throw new Error(friendlyDbError(error));
  if (!data) throw new Error("No se encontró el pedido");
  return { estado: data.estado as string, numero: data.numero as number, total: data.total as number };
}

// El cliente puede arrepentirse mientras espera el pago (Efectivo o
// Mercado Pago) y cancelar desde la propia pantalla del totem.
export async function cancelarPedidoCliente(idVenta: string): Promise<{ error: string | null }> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("ventas")
    .update({ estado: "CANCELADA", motivo_cancelacion: "Cancelado por el cliente", fecha_cancelacion: new Date().toISOString() })
    .eq("id_venta", idVenta)
    .eq("estado", "PENDIENTE_PAGO");
  if (error) return { error: friendlyDbError(error) };
  return { error: null };
}
