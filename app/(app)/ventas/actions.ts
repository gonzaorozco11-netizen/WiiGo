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

export async function anularVenta(
  idVenta: string,
  motivo: string,
  devolucion?: { medio: MedioDevolucion; monto?: number; claveAdmin?: string }
): Promise<{ error: string | null; aviso?: string }> {
  const motivoLimpio = motivo.trim();
  if (!motivoLimpio) return { error: "Contá el motivo de la anulación." };

  try {
    const supabase = getSupabaseServerClient();

    const { data: venta, error: errorVenta } = await supabase
      .from("ventas")
      .select(
        "id_venta, id_cliente, id_local, id_pago, estado, id_liquidacion, medio_pago, total, id_turno, cae, puntos_generados, puntos_canjeados, id_codigo_profesional, id_profesional_canje, marcas_canje"
      )
      .eq("id_venta", idVenta)
      .maybeSingle();
    if (errorVenta) return { error: friendlyDbError(errorVenta) };
    if (!venta) return { error: "No se encontró la venta" };
    if (venta.estado !== "PAGADA") return { error: "Solo se pueden anular ventas que ya están pagadas." };

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

    // Cómo volvió la plata.
    //
    // Al pasar a ANULADA, la venta sale sola del arqueo (resumenTurno solo
    // cuenta las PAGADAS). Eso alcanza en el caso simple: venta en efectivo
    // devuelta en efectivo, el mismo día, en el mismo turno — sale la plata
    // del cajón y sale el importe de lo esperado, y el arqueo cierra igual.
    //
    // Deja de alcanzar en dos casos, que son los que hay que registrar:
    //   · Se devuelve otro día. La venta salía del arqueo de un turno ya
    //     cerrado, y la plata sale del cajón de hoy: hoy falta plata sin
    //     explicación.
    //   · Se cobró por Mercado Pago y se devuelve en efectivo. La plata entró
    //     por un lado y sale por otro.
    // Por eso se guarda a qué turno se le descuenta la salida (ver
    // resumenTurno en turnos/actions.ts).
    // La plata vuelve por donde entró (ver medioDevolucionDe). Pedir otro
    // medio necesita la contraseña de un admin, y queda registrado quién lo
    // autorizó.
    const medioQueCorresponde = medioDevolucionDe(venta.medio_pago);
    const medioPedido: MedioDevolucion = devolucion?.medio ?? medioQueCorresponde;
    let autorizadoPor: string | null = null;

    // PENDIENTE y NO_CORRESPONDE no son "otro medio": son "todavía no salió
    // plata" y "no había plata". No hay mezcla que autorizar.
    const esMezcla =
      medioPedido !== medioQueCorresponde && medioPedido !== "PENDIENTE" && medioPedido !== "NO_CORRESPONDE";

    if (esMezcla) {
      const autorizador = await autorizarMedioDistinto(supabase, devolucion?.claveAdmin ?? "");
      if (!autorizador) {
        return {
          error:
            venta.medio_pago === "MERCADO_PAGO"
              ? "Esta venta se cobró por Mercado Pago, así que el reintegro va por Mercado Pago. Devolverla en efectivo necesita la contraseña de un administrador."
              : "Esta venta se cobró en efectivo, así que se devuelve en efectivo. Hacerlo de otra forma necesita la contraseña de un administrador.",
        };
      }
      autorizadoPor = autorizador.nombre;
    }

    const medioDevolucion = medioPedido;
    const montoDevuelto = devolucion?.monto ?? venta.total ?? 0;

    let turnoDevolucion: string | null = null;
    if (medioDevolucion === "EFECTIVO_TURNO" && venta.id_local) {
      // Se descuenta del turno ABIERTO ahora, no del turno de la venta: la
      // plata sale del cajón hoy, aunque la venta sea de la semana pasada.
      turnoDevolucion = await turnoAbiertoDeLocal(supabase, venta.id_local);
      if (!turnoDevolucion) {
        return {
          error:
            "Para devolver en efectivo tiene que haber un turno de caja abierto — si no, la plata sale del cajón y no queda registrada en ningún arqueo. Abrí el turno y anulá de nuevo.",
        };
      }
    }

    const { error: errorUpdate } = await supabase
      .from("ventas")
      .update({
        estado: "ANULADA",
        motivo_cancelacion: motivoLimpio,
        fecha_cancelacion: new Date().toISOString(),
        devolucion_medio: medioDevolucion,
        devolucion_monto: medioDevolucion === "NO_CORRESPONDE" ? 0 : montoDevuelto,
        devolucion_turno: turnoDevolucion,
        devolucion_fecha: new Date().toISOString(),
        devolucion_autorizada_por: autorizadoPor,
      })
      .eq("id_venta", idVenta)
      .eq("estado", "PAGADA");
    if (errorUpdate) return { error: friendlyDbError(errorUpdate) };

    // Recién ahora la nota de crédito: primero se completa la anulación
    // interna, que no depende de nadie, y después se intenta el comprobante
    // contra ARCA, que sí puede fallar. Si falla queda PENDIENTE y la
    // anulación no se deshace — ver emitirNotaCreditoDeVenta.
    const nota = venta.cae ? await emitirNotaCreditoDeVenta(idVenta) : null;

    // Si la venta ya se le había liquidado a la marca, la marca ya cobró su
    // parte de una venta que se deshizo. Antes esto frenaba la anulación
    // entera; ahora se anula igual y queda un contracargo en su cuenta, que
    // se descuenta solo de la próxima liquidación. Frenar era peor: dejaba al
    // cliente sin devolución y a la factura viva en ARCA.
    let contracargos: { nombre: string; importe: number }[] = [];
    if (venta.id_liquidacion) {
      const r = await contracargoPorAnulacion(idVenta, motivoLimpio, usuario);
      contracargos = r.marcas;
      revalidatePath("/liquidaciones");
      revalidatePath("/marcas");
    }

    revalidatePath("/ventas");
    revalidatePath("/dashboard");
    revalidatePath("/clientes");
    revalidatePath("/profesionales");
    revalidatePath("/stock");
    revalidatePath("/turnos");

    const avisos = [
      nota?.mensaje,
      contracargos.length > 0
        ? `Esta venta ya estaba liquidada, así que se le descontó a ${contracargos
            .map((c) => `${c.nombre} $${c.importe.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`)
            .join(" y ")} en su próxima liquidación.`
        : null,
      esMercadoPago && medioDevolucion !== "MERCADO_PAGO"
        ? "Esta venta se cobró por Mercado Pago: el reintegro al cliente hay que hacerlo aparte, desde Mercado Pago. El sistema no lo hace solo."
        : null,
    ].filter(Boolean);

    return { error: null, aviso: avisos.length > 0 ? avisos.join(" · ") : undefined };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo anular la venta" };
  }
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
