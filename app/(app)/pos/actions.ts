"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

type ItemCarrito = { idVariante: string; idMarca: string | null; cantidad: number; precioUnitario: number };

// Venta mostrador: a diferencia del Self Checkout, acá el mismo empleado
// arma el pedido y cobra en el momento — no queda pendiente esperando a
// nadie. Sirve tanto como venta asistida normal como respaldo si se cae
// la conexión de algún totem.
export async function venderPos(
  idLocal: string,
  items: ItemCarrito[],
  dni: string,
  codigoProfesional: string,
  montoRecibido: number
) {
  if (items.length === 0) throw new Error("El carrito está vacío");

  const supabase = getSupabaseServerClient();
  const usuario = await usuarioActual();

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
      if (error) throw new Error(friendlyDbError(error));
      idCliente = nuevo?.id_cliente ?? null;
    }
  }

  const subtotal = items.reduce((acc, i) => acc + i.precioUnitario * i.cantidad, 0);

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
  if (montoRecibido < total) throw new Error("El monto recibido es menor al total de la venta");
  const vuelto = montoRecibido - total;

  // La venta se crea primero: pagos.id_venta no admite null, así que no
  // se puede insertar el pago hasta tener el id de la venta.
  const { data: venta, error: errorVenta } = await supabase
    .from("ventas")
    .insert({
      canal: "POS",
      id_cliente: idCliente,
      id_local: idLocal,
      subtotal,
      descuento: descuentoBeneficio,
      total,
      estado: "PAGADA",
      medio_pago: "EFECTIVO",
      total_cobrado: montoRecibido,
      usuario,
      terminal: "POS",
    })
    .select("id_venta, numero")
    .single();
  if (errorVenta) throw new Error(friendlyDbError(errorVenta));

  const { data: pago, error: errorPago } = await supabase
    .from("pagos")
    .insert({
      id_venta: venta.id_venta,
      medio: "EFECTIVO",
      forma_pago_cliente: "EFECTIVO",
      importe_bruto: total,
      neto_acreditado: total,
      fecha_pago: new Date().toISOString(),
      fecha_acreditacion: new Date().toISOString(),
      estado: "ACREDITADO",
      estado_conciliacion: "CONCILIADO",
      observaciones: `Venta mostrador · ${usuario ?? "personal"} · Pagó con $${montoRecibido} · Vuelto $${vuelto}`,
    })
    .select("id_pago")
    .single();
  if (errorPago) throw new Error(friendlyDbError(errorPago));

  await supabase.from("ventas").update({ id_pago: pago.id_pago }).eq("id_venta", venta.id_venta);

  const filasDetalle = items.map((i) => ({
    id_venta: venta.id_venta,
    id_variante: i.idVariante,
    id_marca: i.idMarca,
    cantidad: i.cantidad,
    precio_unitario: i.precioUnitario,
    subtotal: i.precioUnitario * i.cantidad,
  }));
  const { error: errorDetalle } = await supabase.from("detalle_ventas").insert(filasDetalle);
  if (errorDetalle) throw new Error(friendlyDbError(errorDetalle));

  if (idCodigo && idProfesional) {
    await supabase.from("referidos_profesionales").insert({
      id_venta: venta.id_venta,
      id_cliente: idCliente,
      id_profesional: idProfesional,
      id_codigo: idCodigo,
      total_venta: total,
      beneficio_cliente: descuentoBeneficio,
      estado: "PENDIENTE",
    });
  }

  let puntosGenerados = 0;

  for (const item of items) {
    const { data: variante } = await supabase
      .from("variantes_producto")
      .select("id_producto")
      .eq("id_variante", item.idVariante)
      .maybeSingle();
    const { data: producto } = variante
      ? await supabase.from("productos").select("puntos").eq("id_producto", variante.id_producto).maybeSingle()
      : { data: null };
    const puntosLinea = (producto?.puntos ?? 0) * item.cantidad;
    puntosGenerados += puntosLinea;

    const { data: stockActual } = await supabase
      .from("stock")
      .select("cantidad")
      .eq("id_variante", item.idVariante)
      .eq("id_local", idLocal)
      .maybeSingle();
    const nuevaCantidad = Math.max((stockActual?.cantidad ?? 0) - item.cantidad, 0);

    const { error: errorStock } = await supabase
      .from("stock")
      .upsert(
        { id_variante: item.idVariante, id_local: idLocal, cantidad: nuevaCantidad, fecha_actualizacion: new Date().toISOString() },
        { onConflict: "id_variante,id_local" }
      );
    if (errorStock) throw new Error(friendlyDbError(errorStock));

    await supabase.from("movimientos_stock").insert({
      id_variante: item.idVariante,
      id_local: idLocal,
      tipo: "VENTA",
      cantidad: -item.cantidad,
      motivo: "Venta mostrador (POS)",
      id_referencia: venta.id_venta,
      usuario,
    });
  }

  if (idCliente && puntosGenerados > 0) {
    const { data: cliente } = await supabase.from("clientes").select("puntos").eq("id_cliente", idCliente).maybeSingle();
    await supabase
      .from("clientes")
      .update({ puntos: (cliente?.puntos ?? 0) + puntosGenerados })
      .eq("id_cliente", idCliente);
  }

  revalidatePath("/pos");
  revalidatePath("/stock");

  return { numero: venta.numero as number, total, vuelto };
}
