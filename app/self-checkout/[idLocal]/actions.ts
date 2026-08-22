"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";

type ItemCarrito = { idVariante: string; idMarca: string | null; cantidad: number; precioUnitario: number };
type MedioPago = "EFECTIVO" | "MERCADO_PAGO";

type ResultadoPedido = { idVenta: string; numero: number; total: number; descuento: number };

// Next.js redacta en producción el mensaje de un Error tirado desde una
// Server Action (queda solo un digest genérico en el navegador) — por eso
// esta función no throwea para errores esperables: devuelve { error }.
export async function confirmarPedido(
  idLocal: string,
  items: ItemCarrito[],
  dni: string,
  codigoProfesional: string,
  medioPago: MedioPago
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

  // Código de descuento del profesional que refirió al cliente.
  let idCodigo: string | null = null;
  let idProfesional: string | null = null;
  let descuentoBeneficio = 0;
  const codigoLimpio = codigoProfesional.trim().toUpperCase();
  if (codigoLimpio) {
    const { data: codigo } = await supabase
      .from("codigos_profesionales")
      .select("id_codigo, id_profesional, tipo_beneficio_cliente, valor_beneficio_cliente")
      .eq("codigo", codigoLimpio)
      .eq("estado", "ACTIVO")
      .maybeSingle();

    if (codigo) {
      idCodigo = codigo.id_codigo;
      idProfesional = codigo.id_profesional;
      if (codigo.tipo_beneficio_cliente === "PORCENTAJE" && codigo.valor_beneficio_cliente) {
        descuentoBeneficio = Math.round(subtotal * (codigo.valor_beneficio_cliente / 100));
      } else if (codigo.tipo_beneficio_cliente === "MONTO" && codigo.valor_beneficio_cliente) {
        descuentoBeneficio = Math.min(codigo.valor_beneficio_cliente, subtotal);
      }
    }
  }

  const total = Math.max(subtotal - descuentoBeneficio, 0);

  const { data: venta, error: errorVenta } = await supabase
    .from("ventas")
    .insert({
      canal: "SELF_CHECKOUT",
      id_cliente: idCliente,
      id_local: idLocal,
      subtotal,
      descuento: descuentoBeneficio,
      total,
      estado: "PENDIENTE_PAGO",
      medio_pago: medioPago,
      usuario: "CLIENTE",
      terminal: `SELF-${idLocal.slice(0, 6).toUpperCase()}`,
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

  if (idCodigo && idProfesional) {
    const { error: errorReferido } = await supabase.from("referidos_profesionales").insert({
      id_venta: venta.id_venta,
      id_cliente: idCliente,
      id_profesional: idProfesional,
      id_codigo: idCodigo,
      total_venta: total,
      beneficio_cliente: descuentoBeneficio,
      estado: "PENDIENTE",
    });
    if (errorReferido) return { error: friendlyDbError(errorReferido) };
  }

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
