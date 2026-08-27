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

// Next.js redacta en producción el mensaje de un Error tirado desde una
// Server Action (queda solo un digest genérico en el navegador) — por eso
// esta función no throwea para errores esperables: devuelve { error }.
//
// Anular una venta ya cobrada deshace, en orden inverso, todo lo que generó
// confirmarCobro (ver cobros-efectivo/actions.ts): repone el stock vendido,
// le devuelve al cliente los puntos que gastó y le saca los que ganó, y si
// el pedido tenía un profesional referente o un canje de saldo propio,
// también los revierte. Nunca borra nada — todo queda como movimientos de
// reversión, para no perder el rastro de qué pasó.
export async function anularVenta(
  idVenta: string,
  motivo: string
): Promise<{ error: string | null; aviso?: string }> {
  const motivoLimpio = motivo.trim();
  if (!motivoLimpio) return { error: "Contá el motivo de la anulación." };

  try {
    const supabase = getSupabaseServerClient();

    const { data: venta, error: errorVenta } = await supabase
      .from("ventas")
      .select(
        "id_venta, id_cliente, id_local, id_pago, estado, id_liquidacion, medio_pago, puntos_generados, puntos_canjeados, id_codigo_profesional, id_profesional_canje, marcas_canje"
      )
      .eq("id_venta", idVenta)
      .maybeSingle();
    if (errorVenta) return { error: friendlyDbError(errorVenta) };
    if (!venta) return { error: "No se encontró la venta" };
    if (venta.estado !== "PAGADA") return { error: "Solo se pueden anular ventas que ya están pagadas." };
    if (venta.id_liquidacion) {
      return {
        error:
          "Esta venta ya está incluida en una liquidación a la marca — no se puede anular directamente. Hay que ajustarla en la próxima liquidación.",
      };
    }

    const usuario = await usuarioActual();
    const esMercadoPago = venta.medio_pago === "MERCADO_PAGO";

    // Reponer el stock vendido.
    const { data: detalle, error: errorDetalle } = await supabase
      .from("detalle_ventas")
      .select("id_variante, cantidad")
      .eq("id_venta", idVenta);
    if (errorDetalle) return { error: friendlyDbError(errorDetalle) };

    if (venta.id_local) {
      for (const linea of detalle ?? []) {
        const { data: stockActual } = await supabase
          .from("stock")
          .select("cantidad")
          .eq("id_variante", linea.id_variante)
          .eq("id_local", venta.id_local)
          .maybeSingle();
        const nuevaCantidad = (stockActual?.cantidad ?? 0) + (linea.cantidad as number);

        const { error: errorStock } = await supabase
          .from("stock")
          .upsert(
            {
              id_variante: linea.id_variante,
              id_local: venta.id_local,
              cantidad: nuevaCantidad,
              fecha_actualizacion: new Date().toISOString(),
            },
            { onConflict: "id_variante,id_local" }
          );
        if (errorStock) return { error: friendlyDbError(errorStock) };

        await supabase.from("movimientos_stock").insert({
          id_variante: linea.id_variante,
          id_local: venta.id_local,
          tipo: "ANULACION_VENTA",
          cantidad: linea.cantidad,
          motivo: `Anulación de venta — ${motivoLimpio}`,
          id_referencia: idVenta,
          usuario,
        });
      }
    }

    // Devolverle al cliente los puntos que gastó y sacarle los que ganó con
    // esta venta — sin dejarlo en negativo si ya gastó esos puntos después
    // en otra compra.
    if (venta.id_cliente) {
      const { data: cliente } = await supabase
        .from("clientes")
        .select("puntos")
        .eq("id_cliente", venta.id_cliente)
        .maybeSingle();
      const puntosActuales = cliente?.puntos ?? 0;
      const puntosNuevos = Math.max(
        puntosActuales + (venta.puntos_canjeados ?? 0) - (venta.puntos_generados ?? 0),
        0
      );
      await supabase.from("clientes").update({ puntos: puntosNuevos }).eq("id_cliente", venta.id_cliente);
    }

    // Si el pedido vino con un código de profesional referente: anular el
    // referido (sin borrarlo, para no perder el historial) y devolverle el
    // uso al código.
    if (venta.id_codigo_profesional) {
      const { data: referido } = await supabase
        .from("referidos_profesionales")
        .select("id_referido, estado")
        .eq("id_venta", idVenta)
        .maybeSingle();
      if (referido && referido.estado !== "ANULADO") {
        await supabase.from("referidos_profesionales").update({ estado: "ANULADO" }).eq("id_referido", referido.id_referido);
      }

      const { data: codigo } = await supabase
        .from("codigos_profesionales")
        .select("usos")
        .eq("id_codigo", venta.id_codigo_profesional)
        .maybeSingle();
      if (codigo) {
        await supabase
          .from("codigos_profesionales")
          .update({ usos: Math.max((codigo.usos ?? 0) - 1, 0) })
          .eq("id_codigo", venta.id_codigo_profesional);
      }
    }

    // Si el profesional pagó parte de esta compra con su propio saldo
    // (canje), devolverle ese saldo con un movimiento de reversión — el
    // saldo se calcula sumando todos los movimientos, así que no hace falta
    // tocar ningún total guardado.
    if (venta.id_profesional_canje && venta.marcas_canje && venta.marcas_canje.length > 0) {
      const { data: movimientosCanje } = await supabase
        .from("movimientos_profesional_marca")
        .select("id_marca, monto")
        .eq("id_venta", idVenta)
        .eq("tipo", "CANJE");
      if (movimientosCanje && movimientosCanje.length > 0) {
        await supabase.from("movimientos_profesional_marca").insert(
          movimientosCanje.map((m) => ({
            id_profesional: venta.id_profesional_canje,
            id_marca: m.id_marca,
            tipo: "REVERSION_CANJE",
            monto: -(m.monto as number),
            id_venta: idVenta,
            usuario,
            descripcion: `Devolución por anulación de venta — ${motivoLimpio}`,
          }))
        );
      }
    }

    // Sacarle a la venta el estado "acreditado" del pago para que deje de
    // contar en la caja del período (ver cajaPeriodo en dashboard/actions.ts)
    // — si no se hace esto, el dashboard sigue mostrando esa plata como
    // cobrada aunque la venta ya esté anulada.
    if (venta.id_pago) {
      await supabase.from("pagos").update({ estado: "ANULADO" }).eq("id_pago", venta.id_pago);
    }

    const { error: errorUpdate } = await supabase
      .from("ventas")
      .update({
        estado: "ANULADA",
        motivo_cancelacion: motivoLimpio,
        fecha_cancelacion: new Date().toISOString(),
      })
      .eq("id_venta", idVenta)
      .eq("estado", "PAGADA");
    if (errorUpdate) return { error: friendlyDbError(errorUpdate) };

    revalidatePath("/ventas");
    revalidatePath("/dashboard");
    revalidatePath("/clientes");
    revalidatePath("/profesionales");
    revalidatePath("/stock");

    return {
      error: null,
      aviso: esMercadoPago
        ? "Esta venta se pagó por Mercado Pago — el sistema no le devuelve la plata al cliente solo, hay que hacer el reintegro aparte desde Mercado Pago."
        : undefined,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo anular la venta" };
  }
}
