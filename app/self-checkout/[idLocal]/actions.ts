"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { calcularBeneficioReferido, resolverCodigoProfesional } from "@/lib/referidosProfesionales";
import { buscarProfesionalPorDni, verificarPinProfesional, calcularDescuentoCanje } from "@/lib/canjesProfesionales";

type ItemCarrito = { idVariante: string; idMarca: string | null; cantidad: number; precioUnitario: number };
type MedioPago = "EFECTIVO" | "MERCADO_PAGO";

type ResultadoPedido = { idVenta: string; numero: number; total: number; descuento: number };

// Next.js redacta en producción el mensaje de un Error tirado desde una
// Server Action (queda solo un digest genérico en el navegador) — por eso
// esta función no throwea para errores esperables: devuelve { error }.
export async function buscarProfesionalPorDniAction(dni: string) {
  const supabase = getSupabaseServerClient();
  return buscarProfesionalPorDni(supabase, dni);
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

export async function confirmarPedido(
  idLocal: string,
  items: ItemCarrito[],
  dni: string,
  codigoProfesional: string,
  medioPago: MedioPago,
  canje?: { idProfesional: string; pin: string; marcas: string[] }
): Promise<{ error: string | null; pedido?: ResultadoPedido }> {
  if (items.length === 0) return { error: "El carrito está vacío" };

  try {
    const supabase = getSupabaseServerClient();

    // Identificar (o crear) al cliente por DNI, si lo cargó.
    let idCliente: string | null = null;
    const dniLimpio = dni.trim();
    if (dniLimpio) {
      const { data: existente } = await supabase
        .from("clientes")
        .select("id_cliente")
        .eq("dni", dniLimpio)
        .maybeSingle();

      if (existente) {
        idCliente = existente.id_cliente;
      } else {
        const { data: nuevo, error } = await supabase
          .from("clientes")
          .insert({ nombre: "Cliente WiiGo", dni: dniLimpio, estado: "ACTIVO" })
          .select("id_cliente")
          .single();
        if (error) return { error: friendlyDbError(error) };
        idCliente = nuevo?.id_cliente ?? null;
      }
    }

  const subtotal = items.reduce((acc, i) => acc + i.precioUnitario * i.cantidad, 0);

  // El código solo se valida y se calcula el descuento acá (hace falta para
  // el total que ve el cliente) — el referido en sí (con su detalle y la
  // comisión del profesional) recién se registra cuando el personal
  // confirma el cobro, ver confirmarCobro en cobros-efectivo/actions.ts. Así
  // no queda un referido de un carrito que el cliente termina abandonando.
  const codigoResuelto = await resolverCodigoProfesional(supabase, codigoProfesional);
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

  const total = Math.max(subtotal - descuentoBeneficio - descuentoCanje, 0);

  const { data: venta, error: errorVenta } = await supabase
    .from("ventas")
    .insert({
      canal: "SELF_CHECKOUT",
      id_cliente: idCliente,
      id_local: idLocal,
      subtotal,
      descuento: descuentoBeneficio + descuentoCanje,
      total,
      estado: "PENDIENTE_PAGO",
      medio_pago: medioPago,
      usuario: "CLIENTE",
      terminal: `SELF-${idLocal.slice(0, 6).toUpperCase()}`,
      id_codigo_profesional: codigoResuelto.idCodigo,
      id_profesional_canje: canje && canje.marcas.length > 0 ? canje.idProfesional : null,
      marcas_canje: canje && canje.marcas.length > 0 ? canje.marcas : null,
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

    return {
      error: null,
      pedido: { idVenta: venta.id_venta, numero: venta.numero as number, total, descuento: descuentoBeneficio },
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
