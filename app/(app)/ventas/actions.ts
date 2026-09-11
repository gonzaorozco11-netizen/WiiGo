"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient, type Venta, type DetalleVenta } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { verifyPassword } from "@/lib/auth";
import { emitirNotaCreditoDeVenta } from "@/lib/arca/notaCredito";
import { contracargoPorAnulacion } from "@/app/(app)/liquidaciones/actions";
import { turnoAbiertoDeLocal } from "@/app/(app)/turnos/actions";
import { reintegrarPagoMp } from "@/lib/mercadopago";
import {
  lineasDevolvibles,
  calcularDevolucion,
  puntosARevertir,
  type LineaDevolvible,
  type PedidoDevolucion,
  type DestinoMercaderia,
} from "@/lib/devoluciones";

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
/**
 * Cómo volvió la plata al cliente.
 *
 * No es un detalle administrativo: si no se registra, el arqueo de caja no
 * cierra. Ver la nota larga más abajo, en el bloque que lo guarda.
 */
export type MedioDevolucion = "EFECTIVO_TURNO" | "MERCADO_PAGO" | "PENDIENTE" | "NO_CORRESPONDE";

/**
 * La plata vuelve por donde entró.
 *
 * No es una preferencia administrativa. Devolver efectivo por una venta
 * cobrada con QR convierte plata electrónica en efectivo: es lo que se mira en
 * una inspección, y es la estafa clásica — comprar con una tarjeta ajena y
 * llevarse el efectivo. Además vacía la caja física por plata que nunca entró
 * en ella.
 *
 * Por eso el medio lo decide la venta, no quien anula.
 *
 * Sin export a propósito: en un archivo "use server" todo lo exportado tiene
 * que ser una función async, y además esto no es un endpoint — es una regla
 * interna. La pantalla tiene su propia copia para mostrar el texto.
 */
function medioDevolucionDe(medioPago: string | null): MedioDevolucion {
  return medioPago === "MERCADO_PAGO" ? "MERCADO_PAGO" : "EFECTIVO_TURNO";
}

/**
 * Quién puede salirse de esa regla.
 *
 * Existe una salida, y a propósito: si el sistema lo prohibiera sin excepción,
 * el día que Mercado Pago no deje hacer el reintegro alguien va a sacar la
 * plata del cajón igual y no lo va a registrar en ningún lado. Es mejor una
 * excepción pedida, firmada y visible que un agujero invisible.
 *
 * Usa el mismo mecanismo que los gastos por encima del tope: la contraseña de
 * un admin, que queda registrada en la venta.
 */
async function autorizarMedioDistinto(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  clave: string
): Promise<{ nombre: string } | null> {
  if (!clave) return null;
  const { data: candidatos } = await supabase
    .from("usuarios")
    .select("nombre, rol, password_hash")
    .eq("estado", "ACTIVO");
  for (const c of candidatos ?? []) {
    if (c.rol === "admin" && (await verifyPassword(clave, c.password_hash))) {
      return { nombre: c.nombre as string };
    }
  }
  return null;
}

/** Lo que se puede devolver de una venta, para armar la pantalla. */
export async function lineasParaDevolver(idVenta: string): Promise<LineaDevolvible[]> {
  const supabase = getSupabaseServerClient();
  return lineasDevolvibles(supabase, idVenta);
}

/**
 * Devolver parte de una venta (o toda).
 *
 * Es el único camino: `anularVenta` delega acá con todas las líneas. Un solo
 * mecanismo para que no haya forma de que la anulación total haga algo que la
 * parcial no — reponer el stock, emitir la nota, descontarle a la marca.
 *
 * El orden importa. Primero lo que no depende de nadie (registrar, stock,
 * puntos), después lo que puede fallar por un servicio de afuera (ARCA,
 * Mercado Pago). Si algo de lo último falla, la devolución igual quedó hecha
 * y lo que faltó queda marcado como pendiente: nunca se deja al cliente
 * esperando en el mostrador por una caída ajena.
 */
export async function registrarDevolucion(
  idVenta: string,
  pedido: PedidoDevolucion[],
  opciones: {
    motivo: string;
    destino: DestinoMercaderia;
    medio?: MedioDevolucion;
    claveAdmin?: string;
  }
): Promise<{ error: string | null; aviso?: string }> {
  const motivo = opciones.motivo.trim();
  if (!motivo) return { error: "Contá el motivo de la devolución." };

  try {
    const supabase = getSupabaseServerClient();
    const usuario = await usuarioActual();

    const { data: venta } = await supabase
      .from("ventas")
      .select(
        "id_venta, numero, id_cliente, id_local, id_pago, estado, id_liquidacion, medio_pago, total, cae, puntos_generados, puntos_canjeados"
      )
      .eq("id_venta", idVenta)
      .maybeSingle();
    if (!venta) return { error: "No se encontró la venta" };
    if (venta.estado !== "PAGADA") {
      return { error: "Solo se puede devolver sobre una venta pagada." };
    }

    const lineas = await lineasDevolvibles(supabase, idVenta);
    const calc = calcularDevolucion(lineas, pedido);
    if (calc.error) return { error: calc.error };

    // La plata vuelve por donde entró; salirse de eso lo firma un admin.
    const medioQueCorresponde = medioDevolucionDe(venta.medio_pago);
    const medio: MedioDevolucion = opciones.medio ?? medioQueCorresponde;
    let autorizadaPor: string | null = null;
    if (medio !== medioQueCorresponde && medio !== "PENDIENTE" && medio !== "NO_CORRESPONDE") {
      const autorizador = await autorizarMedioDistinto(supabase, opciones.claveAdmin ?? "");
      if (!autorizador) {
        return {
          error:
            venta.medio_pago === "MERCADO_PAGO"
              ? "Esta venta se cobró por Mercado Pago, así que el reintegro va por Mercado Pago. Devolverla en efectivo necesita la contraseña de un administrador."
              : "Esta venta se cobró en efectivo, así que se devuelve en efectivo. Hacerlo de otra forma necesita la contraseña de un administrador.",
        };
      }
      autorizadaPor = autorizador.nombre;
    }

    let idTurno: string | null = null;
    if (medio === "EFECTIVO_TURNO" && venta.id_local) {
      idTurno = await turnoAbiertoDeLocal(supabase, venta.id_local);
      if (!idTurno) {
        return {
          error:
            "Para devolver en efectivo tiene que haber un turno de caja abierto — si no, la plata sale del cajón y no queda en ningún arqueo. Abrí el turno y probá de nuevo.",
        };
      }
    }

    // ===== Registrar =====
    const { data: dev, error: errorDev } = await supabase
      .from("devoluciones")
      .insert({
        id_venta: idVenta,
        alcance: calc.esTotal ? "TOTAL" : "PARCIAL",
        usuario,
        motivo,
        total: calc.total,
        destino: opciones.destino,
        medio,
        monto_devuelto: medio === "NO_CORRESPONDE" ? 0 : calc.total,
        id_turno: idTurno,
        autorizada_por: autorizadaPor,
      })
      .select("id_devolucion")
      .single();
    if (errorDev) return { error: friendlyDbError(errorDev) };
    const idDevolucion = dev.id_devolucion as string;

    const { error: errorDetalle } = await supabase.from("detalle_devoluciones").insert(
      calc.renglones.map((r) => ({
        id_devolucion: idDevolucion,
        id_detalle: r.idDetalle,
        id_variante: r.idVariante,
        id_marca: r.idMarca,
        cantidad: r.cantidad,
        precio_unitario: r.precioUnitario,
        subtotal: r.subtotal,
      }))
    );
    if (errorDetalle) return { error: friendlyDbError(errorDetalle) };

    // ===== Stock =====
    // Si el producto no vuelve a la góndola, el stock vendible NO se toca: un
    // producto abierto, vencido o fallado que se repone se le termina
    // vendiendo al cliente siguiente. El movimiento se registra igual, con
    // cantidad 0, para que quede el rastro de que entró y por qué no suma.
    if (venta.id_local) {
      for (const r of calc.renglones) {
        if (opciones.destino === "VUELVE") {
          const { data: actual } = await supabase
            .from("stock")
            .select("cantidad")
            .eq("id_variante", r.idVariante)
            .eq("id_local", venta.id_local)
            .maybeSingle();
          await supabase.from("stock").upsert(
            {
              id_variante: r.idVariante,
              id_local: venta.id_local,
              cantidad: (actual?.cantidad ?? 0) + r.cantidad,
              fecha_actualizacion: new Date().toISOString(),
            },
            { onConflict: "id_variante,id_local" }
          );
        }

        await supabase.from("movimientos_stock").insert({
          id_variante: r.idVariante,
          id_local: venta.id_local,
          tipo: opciones.destino === "VUELVE" ? "DEVOLUCION" : "DEVOLUCION_NO_VENDIBLE",
          cantidad: opciones.destino === "VUELVE" ? r.cantidad : 0,
          motivo:
            opciones.destino === "VUELVE"
              ? `Devolución de venta #${venta.numero} — ${motivo}`
              : `Devolución NO vendible (${r.cantidad} u.) de venta #${venta.numero} — ${motivo}`,
          id_referencia: idVenta,
          usuario,
        });
      }
    }

    // ===== Puntos =====
    if (venta.id_cliente) {
      const { data: cliente } = await supabase
        .from("clientes")
        .select("puntos")
        .eq("id_cliente", venta.id_cliente)
        .maybeSingle();
      const nuevos = puntosARevertir({
        puntosGenerados: venta.puntos_generados ?? 0,
        puntosCanjeados: venta.puntos_canjeados ?? 0,
        totalVenta: venta.total ?? 0,
        totalDevuelto: calc.total,
        saldoActual: cliente?.puntos ?? 0,
      });
      await supabase.from("clientes").update({ puntos: nuevos }).eq("id_cliente", venta.id_cliente);
    }

    const avisos: string[] = [];

    // ===== Nota de crédito =====
    if (venta.cae) {
      const nota = await emitirNotaCreditoDeVenta(idVenta, { importe: calc.total, idDevolucion });
      if (nota.mensaje) avisos.push(nota.mensaje);
    }

    // ===== Reintegro por Mercado Pago =====
    if (medio === "MERCADO_PAGO") {
      avisos.push(await reintegrarPorMp(supabase, venta.id_pago as string | null, calc.total, idDevolucion));
    }

    // ===== Contracargo a la marca, si ya estaba liquidada =====
    if (venta.id_liquidacion) {
      const factor = new Map<string, number>();
      for (const l of lineas) {
        if (!l.idMarca) continue;
        const vendidoMarca = lineas
          .filter((x) => x.idMarca === l.idMarca)
          .reduce((a, x) => a + x.precioUnitario * x.cantidadVendida, 0);
        const devueltoMarca = calc.renglones
          .filter((x) => x.idMarca === l.idMarca)
          .reduce((a, x) => a + x.subtotal, 0);
        if (vendidoMarca > 0) factor.set(l.idMarca, Math.min(devueltoMarca / vendidoMarca, 1));
      }
      const r = await contracargoPorAnulacion(idVenta, motivo, usuario, factor);
      if (r.marcas.length > 0) {
        avisos.push(
          `Ya estaba liquidada: se le descuenta a ${r.marcas
            .map((c) => `${c.nombre} $${c.importe.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`)
            .join(" y ")} en la próxima liquidación.`
        );
      }
      revalidatePath("/liquidaciones");
      revalidatePath("/marcas");
    }

    // ===== Estado de la venta =====
    if (calc.esTotal) {
      await revertirExtrasDeVentaAnulada(supabase, venta, motivo, usuario);
      await supabase
        .from("ventas")
        .update({
          estado: "ANULADA",
          motivo_cancelacion: motivo,
          fecha_cancelacion: new Date().toISOString(),
          devolucion_medio: medio,
          devolucion_monto: medio === "NO_CORRESPONDE" ? 0 : calc.total,
          devolucion_turno: idTurno,
          devolucion_fecha: new Date().toISOString(),
          devolucion_autorizada_por: autorizadaPor,
        })
        .eq("id_venta", idVenta)
        .eq("estado", "PAGADA");

      // Si es la única devolución de la venta, se copia la nota de crédito a
      // la venta para que la pantalla de siempre la muestre donde la muestra
      // hoy. Con devoluciones previas no se copia: mostraría solo la última y
      // haría creer que la factura se anuló entera de una.
      const { count } = await supabase
        .from("devoluciones")
        .select("id_devolucion", { count: "exact", head: true })
        .eq("id_venta", idVenta);
      if ((count ?? 0) === 1) {
        const { data: nc } = await supabase
          .from("devoluciones")
          .select("nc_estado, nc_cae, nc_cae_vencimiento, nc_tipo, nc_punto_venta, nc_numero, nc_fecha, nc_neto, nc_iva, nc_total, nc_error")
          .eq("id_devolucion", idDevolucion)
          .maybeSingle();
        if (nc) await supabase.from("ventas").update(nc).eq("id_venta", idVenta);
      }
    } else {
      await supabase.from("ventas").update({ devuelta_parcial: true }).eq("id_venta", idVenta);
    }

    revalidatePath("/ventas");
    revalidatePath("/dashboard");
    revalidatePath("/clientes");
    revalidatePath("/stock");
    revalidatePath("/turnos");

    return { error: null, aviso: avisos.length > 0 ? avisos.join(" · ") : undefined };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar la devolución" };
  }
}

/** El reintegro por Mercado Pago. Nunca frena la devolución: devuelve el aviso. */
async function reintegrarPorMp(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  idPago: string | null,
  monto: number,
  idDevolucion: string
): Promise<string> {
  const { data: pago } = idPago
    ? await supabase.from("pagos").select("id_pago_externo").eq("id_pago", idPago).maybeSingle()
    : { data: null };
  const idPagoMp = pago?.id_pago_externo as string | null | undefined;

  if (!idPagoMp) {
    await supabase
      .from("devoluciones")
      .update({ mp_error: "La venta no tiene guardado el id del pago de Mercado Pago." })
      .eq("id_devolucion", idDevolucion);
    return "No se pudo pedir el reintegro solo: falta el id del pago de Mercado Pago. Hacelo a mano desde Mercado Pago.";
  }

  try {
    const r = await reintegrarPagoMp({ idPagoMp, monto, referencia: idDevolucion });
    await supabase.from("devoluciones").update({ mp_refund_id: r.id, mp_error: null }).eq("id_devolucion", idDevolucion);
    return "Reintegro pedido a Mercado Pago. Avisale al cliente que si pagó con tarjeta puede aparecerle recién en el resumen siguiente.";
  } catch (err) {
    const detalle = err instanceof Error ? err.message : "error desconocido";
    await supabase.from("devoluciones").update({ mp_error: detalle }).eq("id_devolucion", idDevolucion);
    return `Mercado Pago no aceptó el reintegro: ${detalle} · Hacelo a mano desde Mercado Pago.`;
  }
}

/**
 * Reintentar la nota de crédito de una venta ya anulada.
 *
 * Existe porque la anulación nunca se frena por una caída de ARCA: se completa
 * igual y el comprobante queda PENDIENTE. Este es el botón que lo cierra
 * después, cuando el servicio vuelve.
 */
export async function reintentarNotaCredito(idVenta: string): Promise<{ error: string | null; aviso?: string }> {
  try {
    const supabase = getSupabaseServerClient();
    const { data: venta } = await supabase
      .from("ventas")
      .select("estado, cae")
      .eq("id_venta", idVenta)
      .maybeSingle();

    if (!venta) return { error: "No se encontró la venta" };
    if (venta.estado !== "ANULADA") return { error: "La nota de crédito se emite sobre una venta anulada." };
    if (!venta.cae) return { error: "Esta venta no tenía factura, así que no lleva nota de crédito." };

    const nota = await emitirNotaCreditoDeVenta(idVenta);
    revalidatePath("/ventas");
    return nota.estado === "PENDIENTE" ? { error: nota.mensaje } : { error: null, aviso: nota.mensaje };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo emitir la nota de crédito" };
  }
}


/**
 * Anular una venta entera.
 *
 * Es una devolución de todo: delega en registrarDevolucion con todas las
 * líneas. Antes tenía su propia copia de la reposición de stock, los puntos,
 * la nota de crédito y el contracargo — dos copias de la misma cuenta que
 * tarde o temprano se iban a separar.
 *
 * `destino` viene en "VUELVE" porque la anulación clásica es la venta cargada
 * mal o el cliente que se arrepintió al toque. Cuando el producto no puede
 * volver a la góndola, se usa la pantalla de devolución.
 */
export async function anularVenta(
  idVenta: string,
  motivo: string,
  devolucion?: { medio: MedioDevolucion; monto?: number; claveAdmin?: string }
): Promise<{ error: string | null; aviso?: string }> {
  const supabase = getSupabaseServerClient();

  const lineas = await lineasDevolvibles(supabase, idVenta);
  if (lineas.length === 0) return { error: "No se encontró el detalle de esta venta." };

  return registrarDevolucion(
    idVenta,
    lineas.filter((l) => l.disponible > 0).map((l) => ({ idDetalle: l.idDetalle, cantidad: l.disponible })),
    {
      motivo,
      destino: "VUELVE",
      medio: devolucion?.medio,
      claveAdmin: devolucion?.claveAdmin,
    }
  );
}

/**
 * Lo que solo pasa cuando la venta queda anulada entera: el referido del
 * profesional, su canje de saldo y el estado del pago.
 *
 * No se hace en las parciales a propósito. Un referido o un canje son de la
 * compra completa: si devuelve un producto de tres, la compra existió y esos
 * beneficios se ganaron igual.
 */
async function revertirExtrasDeVentaAnulada(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  venta: { id_venta: string; id_pago: string | null },
  motivo: string,
  usuario: string | null
) {
  const idVenta = venta.id_venta;

  const { data: completa } = await supabase
    .from("ventas")
    .select("id_codigo_profesional, id_profesional_canje, marcas_canje")
    .eq("id_venta", idVenta)
    .maybeSingle();

  // Referido de una profesional: se anula sin borrarlo (para no perder el
  // historial) y se le devuelve el uso al código.
  if (completa?.id_codigo_profesional) {
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
      .eq("id_codigo", completa.id_codigo_profesional)
      .maybeSingle();
    if (codigo) {
      await supabase
        .from("codigos_profesionales")
        .update({ usos: Math.max((codigo.usos ?? 0) - 1, 0) })
        .eq("id_codigo", completa.id_codigo_profesional);
    }
  }

  // Si la profesional pagó parte con su propio saldo, se le devuelve con un
  // movimiento de reversión: el saldo se calcula sumando movimientos, así que
  // no hay ningún total guardado que corregir.
  if (completa?.id_profesional_canje && completa.marcas_canje && completa.marcas_canje.length > 0) {
    const { data: movimientosCanje } = await supabase
      .from("movimientos_profesional_marca")
      .select("id_marca, monto")
      .eq("id_venta", idVenta)
      .eq("tipo", "CANJE");
    if (movimientosCanje && movimientosCanje.length > 0) {
      await supabase.from("movimientos_profesional_marca").insert(
        movimientosCanje.map((m) => ({
          id_profesional: completa.id_profesional_canje,
          id_marca: m.id_marca,
          tipo: "REVERSION_CANJE",
          monto: -(m.monto as number),
          id_venta: idVenta,
          usuario,
          descripcion: `Devolución por anulación de venta — ${motivo}`,
        }))
      );
    }
  }

  // Sacarle al pago el estado "acreditado" para que esa plata deje de contar
  // en la caja del período (ver cajaPeriodo en dashboard/actions.ts).
  if (venta.id_pago) {
    await supabase.from("pagos").update({ estado: "ANULADO" }).eq("id_pago", venta.id_pago);
  }

  revalidatePath("/profesionales");
}

// ===================== LISTADO FILTRADO (optimización de carga) =====================
// Antes esta pantalla traía TODA la tabla ventas (y detalle_ventas) en cada
// carga, sin ningún límite — a medida que crece el negocio esto se pone cada
// vez más lento, y además Supabase podría empezar a cortar el resultado
// antes de tiempo, escondiendo ventas reales sin ningún aviso. Ahora se pide
// acotado por fecha/local cada vez que cambia el filtro en pantalla, con un
// límite explícito y generoso como red de seguridad (avisando si se llega a
// tocar, en vez de fallar en silencio).
const LIMITE_VENTAS = 5000;

export async function listarVentasFiltradas(params: {
  idLocal?: string | null;
  desde?: string | null;
  hasta?: string | null;
}): Promise<{ ventas: Venta[]; posibleTruncado: boolean; error: string | null }> {
  try {
    const supabase = getSupabaseServerClient();
    // Un carrito de Self Checkout que el cliente dejó a la mitad y nunca
    // pagó ni canceló queda en PENDIENTE_PAGO para siempre — no es una
    // venta real, así que no tiene sentido que aparezca acá.
    let query = supabase
      .from("ventas")
      .select("*")
      .neq("estado", "PENDIENTE_PAGO")
      .order("fecha", { ascending: false })
      .limit(LIMITE_VENTAS);
    if (params.idLocal) query = query.eq("id_local", params.idLocal);
    if (params.desde) query = query.gte("fecha", `${params.desde}T00:00:00`);
    if (params.hasta) query = query.lte("fecha", `${params.hasta}T23:59:59`);

    const { data, error } = await query;
    if (error) return { ventas: [], posibleTruncado: false, error: friendlyDbError(error) };

    return { ventas: (data ?? []) as Venta[], posibleTruncado: (data ?? []).length === LIMITE_VENTAS, error: null };
  } catch (err) {
    return { ventas: [], posibleTruncado: false, error: err instanceof Error ? err.message : "No se pudieron cargar las ventas" };
  }
}

// El detalle de línea solo hace falta para la venta que se está mirando en
// el panel de la derecha — antes se traía TODO detalle_ventas junto con el
// listado completo sin usarse para nada más que esto. Ahora se pide bajo
// demanda, una venta a la vez, por id_venta (ya indexado).
export async function obtenerDetalleVenta(idVenta: string): Promise<DetalleVenta[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("detalle_ventas").select("*").eq("id_venta", idVenta);
  if (error) throw new Error(friendlyDbError(error));
  return (data ?? []) as DetalleVenta[];
}
