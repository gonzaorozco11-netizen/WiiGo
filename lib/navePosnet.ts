import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cuentaPosnet,
  crearCobroPosnet,
  cancelarCobroPosnet,
  consultarPedidoNave,
  consultarPagoNave,
  motivoRechazoNave,
  detallePagoPosnet,
  type EntornoNave,
} from "@/lib/nave";
import { confirmarCobro } from "@/app/(app)/cobros-efectivo/actions";

// El posnet de Nave conectado a la caja (Gonzalo, 24/11; maqueta «Caja con posnet conectado»).
//
// 1. Al cobrar, la venta queda PENDIENTE_PAGO (como con el QR) y el monto se manda al posnet.
//    En ventas.id_orden_mp queda «nave:<n.º de posnet>:<id del cobro en Nave>».
// 2. El cliente paga en el aparato. Nave avisa a /api/nave/posnet/aviso y la caja, mientras
//    espera, pregunta cada pocos segundos. Los dos usan revisarCobroPosnet: se le pregunta a
//    Nave por el pago y, si salió aprobado, se cierra la venta con confirmarCobro (el mismo del
//    QR). confirmarCobro solo cierra una venta pendiente, así que nunca se cobra dos veces.
// 3. Rechazado: la venta sigue pendiente para probar otra tarjeta o cambiar de medio.
//
// Qué posnets están conectados: Configuración, parámetros NAVE_POSNET_1 y NAVE_POSNET_2 con el
// POS ID que da Nave (Integraciones → Sistema de gestión). «sandbox:<POS ID>» es uno de prueba.
// Sin ninguno cargado, la caja sigue como siempre: se marca el monto a mano en el posnet.

export const CLAVES_POSNET = ["NAVE_POSNET_1", "NAVE_POSNET_2"] as const;

export type PosnetConectado = { numero: number; posId: string; entorno: EntornoNave };

/** Los posnets conectados, de los valores de Configuración (y con credenciales para hablar con Nave). */
export function leerPosnets(config: Map<string, string | null | undefined>): PosnetConectado[] {
  const lista: PosnetConectado[] = [];
  CLAVES_POSNET.forEach((clave, i) => {
    const valor = (config.get(clave) ?? "").trim().replace(/^["']|["']$/g, "");
    const m = /^(sandbox:)?\s*([\w-]{8,64})$/i.exec(valor);
    if (!m) return;
    const entorno: EntornoNave = m[1] ? "sandbox" : "produccion";
    if (!cuentaPosnet(entorno)) return;
    lista.push({ numero: i + 1, posId: m[2], entorno });
  });
  return lista;
}

export async function traerPosnets(supabase: SupabaseClient): Promise<PosnetConectado[]> {
  const { data } = await supabase.from("configuracion").select("parametro, valor").in("parametro", [...CLAVES_POSNET]);
  return leerPosnets(new Map((data ?? []).map((c) => [c.parametro as string, c.valor as string | null])));
}

const PREFIJO = "nave:";
function leerRef(ref: string | null | undefined): { numero: number; idCobro: string } | null {
  const m = /^nave:(\d+):([\w-]+)$/.exec(ref ?? "");
  return m ? { numero: Number(m[1]), idCobro: m[2] } : null;
}

/** Cuánto espera el posnet a que el cliente pague antes de dar el cobro por vencido. */
const SEGUNDOS_COBRO = 180;

/** Manda (o vuelve a mandar) el cobro de una venta pendiente al posnet elegido. */
export async function mandarAlPosnet(
  supabase: SupabaseClient,
  idVenta: string,
  numeroPosnet: number
): Promise<{ error: string | null }> {
  const { data: venta } = await supabase.from("ventas").select("id_venta, numero, total, estado, medio_pago, id_orden_mp").eq("id_venta", idVenta).maybeSingle();
  if (!venta) return { error: "No se encontró la venta." };
  if (venta.estado !== "PENDIENTE_PAGO" || venta.medio_pago !== "POSNET") return { error: "Esta venta ya no está esperando el posnet." };
  const posnet = (await traerPosnets(supabase)).find((p) => p.numero === numeroPosnet);
  const cuenta = posnet ? cuentaPosnet(posnet.entorno) : null;
  if (!posnet || !cuenta) return { error: `El posnet ${numeroPosnet} no está conectado al sistema. Marcalo a mano.` };

  // Si ya había un cobro mandado (reintento), se saca del posnet antes de mandar el nuevo.
  const anterior = leerRef(venta.id_orden_mp as string | null);
  if (anterior) await sacarDelPosnet(supabase, anterior).catch(() => null);

  try {
    const idCobro = await crearCobroPosnet(cuenta, {
      posId: posnet.posId,
      // Hasta 36 letras (Nave). El número de venta sirve para encontrarla cuando llega el aviso.
      referencia: `WGP-${venta.numero}-${Date.now().toString(36)}`,
      total: Number(venta.total),
      descripcion: `Venta WiiGo #${venta.numero}`,
      segundos: SEGUNDOS_COBRO,
    });
    await supabase.from("ventas").update({ id_orden_mp: `${PREFIJO}${numeroPosnet}:${idCobro}` }).eq("id_venta", idVenta);
    return { error: null };
  } catch (e) {
    console.error("[navePosnet] no se pudo mandar el cobro", e);
    const texto = e instanceof Error ? e.message : "";
    if (/device_already_on_payment_flow/i.test(texto)) return { error: "El posnet está ocupado con otro cobro. Terminalo o cancelalo en el aparato y probá de nuevo." };
    if (/low_battery/i.test(texto)) return { error: "Al posnet le queda poca batería. Cargalo y probá de nuevo." };
    return { error: "No se pudo mandar el cobro al posnet. Probá de nuevo o marcalo a mano." };
  }
}

async function sacarDelPosnet(supabase: SupabaseClient, ref: { numero: number; idCobro: string }) {
  const posnet = (await traerPosnets(supabase)).find((p) => p.numero === ref.numero);
  const cuenta = posnet ? cuentaPosnet(posnet.entorno) : null;
  if (cuenta) await cancelarCobroPosnet(cuenta, ref.idCobro);
}

export type EstadoCobroPosnet =
  | { estado: "PAGADO"; detalle: string | null; confirmadoAhora: boolean }
  | { estado: "ESPERANDO" }
  | { estado: "RECHAZADO"; motivo: string }
  /** Venció, se canceló en el aparato o Nave lo bloqueó: se puede mandar de nuevo. */
  | { estado: "TERMINADO"; motivo: string }
  | { estado: "CANCELADO" }
  | { estado: "ERROR"; motivo: string };

/** Se fija en Nave cómo va el cobro y, si se aprobó, cierra la venta. */
export async function revisarCobroPosnet(supabase: SupabaseClient, idVenta: string): Promise<EstadoCobroPosnet> {
  const { data: venta } = await supabase
    .from("ventas")
    .select("id_venta, total, estado, medio_pago, id_orden_mp, usuario")
    .eq("id_venta", idVenta)
    .maybeSingle();
  if (!venta) return { estado: "ERROR", motivo: "No se encontró la venta." };
  if (venta.estado === "CANCELADA") return { estado: "CANCELADO" };

  const ref = leerRef(venta.id_orden_mp as string | null);
  const posnet = ref ? (await traerPosnets(supabase)).find((p) => p.numero === ref.numero) : null;
  const cuenta = posnet ? cuentaPosnet(posnet.entorno) : null;

  if (venta.estado === "PAGADA") {
    // Ya la cerró el aviso de Nave: solo falta el detalle para mostrarle al cajero.
    let detalle: string | null = null;
    if (ref && cuenta) {
      try {
        const intencion = await consultarPedidoNave(ref.idCobro, cuenta);
        if (intencion.idPago) detalle = detallePagoPosnet((await consultarPagoNave(intencion.idPago, cuenta)).datos).texto;
      } catch { /* sin detalle no pasa nada */ }
    }
    return { estado: "PAGADO", detalle, confirmadoAhora: false };
  }
  if (venta.estado !== "PENDIENTE_PAGO" || venta.medio_pago !== "POSNET") return { estado: "ERROR", motivo: "Esta venta no se está cobrando con el posnet." };
  if (!ref || !cuenta) return { estado: "ERROR", motivo: "No se sabe a qué posnet se mandó el cobro." };

  try {
    const intencion = await consultarPedidoNave(ref.idCobro, cuenta);
    const aprobado = intencion.estado === "SUCCESS_PROCESSED" || intencion.ultimoIntento === "APPROVED";
    const rechazado = intencion.estado === "FAILURE_PROCESSED" || intencion.ultimoIntento === "REJECTED";
    if ((aprobado || rechazado) && intencion.idPago) {
      const pago = await consultarPagoNave(intencion.idPago, cuenta);
      if (pago.estado === "APROBADO") {
        const { texto, cupon } = detallePagoPosnet(pago.datos);
        const r = await confirmarCobro(idVenta, Number(venta.total), pago.forma ?? "POSNET_CREDITO", (venta.usuario as string | null) ?? "Posnet (automático)", { cupon, detalle: texto });
        if (r.error) {
          // Lo cerró el aviso justo al mismo tiempo: está bien, ya quedó pagada.
          const { data: ahora } = await supabase.from("ventas").select("estado").eq("id_venta", idVenta).maybeSingle();
          if (ahora?.estado === "PAGADA") return { estado: "PAGADO", detalle: texto, confirmadoAhora: false };
          return { estado: "ERROR", motivo: `El posnet cobró pero no se pudo registrar la venta: ${r.error}` };
        }
        return { estado: "PAGADO", detalle: texto, confirmadoAhora: true };
      }
      if (pago.estado === "RECHAZADO") return { estado: "RECHAZADO", motivo: motivoRechazoNave(pago.datos) };
    }
    if (intencion.estado === "EXPIRED") return { estado: "TERMINADO", motivo: "Pasó el tiempo y el posnet no cobró." };
    if (intencion.estado === "DISABLED") return { estado: "TERMINADO", motivo: "El cobro se canceló en el posnet." };
    if (intencion.estado === "BLOCKED") return { estado: "TERMINADO", motivo: "Nave frenó el cobro por seguridad. Probá con otra tarjeta u otro medio de pago." };
    return { estado: "ESPERANDO" };
  } catch (e) {
    console.error("[navePosnet] no se pudo consultar el cobro", e);
    // Un corte de internet momentáneo: la caja vuelve a preguntar sola.
    return { estado: "ESPERANDO" };
  }
}

/**
 * El cajero cancela: se saca el cobro del posnet y se cancela la venta. Antes se fija una
 * última vez por si el cliente justo pagó (entonces no se cancela nada).
 */
export async function cancelarCobroPosnetDeVenta(
  supabase: SupabaseClient,
  idVenta: string,
  motivo: string
): Promise<EstadoCobroPosnet> {
  const { data: venta } = await supabase.from("ventas").select("id_orden_mp").eq("id_venta", idVenta).maybeSingle();
  const ref = leerRef(venta?.id_orden_mp as string | null);
  if (ref) await sacarDelPosnet(supabase, ref).catch(() => null);
  const estado = await revisarCobroPosnet(supabase, idVenta);
  // Ya pagó, o el posnet cobró y la venta no se pudo registrar: no se cancela nada.
  if (estado.estado === "PAGADO" || (estado.estado === "ERROR" && /cobró/.test(estado.motivo))) return estado;
  await supabase
    .from("ventas")
    .update({ estado: "CANCELADA", motivo_cancelacion: motivo, fecha_cancelacion: new Date().toISOString() })
    .eq("id_venta", idVenta)
    .eq("estado", "PENDIENTE_PAGO");
  return { estado: "CANCELADO" };
}

/** Para el aviso de Nave: a qué venta pertenece (por la referencia o por el id del cobro). */
export async function ventaDelAvisoPosnet(
  supabase: SupabaseClient,
  aviso: { external_payment_id?: unknown; payment_request_id?: unknown }
): Promise<{ idVenta: string; idLocal: string | null } | null> {
  const m = /^WGP-(\d+)-/.exec(String(aviso.external_payment_id ?? ""));
  if (m) {
    const { data } = await supabase
      .from("ventas")
      .select("id_venta, id_local")
      .eq("numero", Number(m[1]))
      .eq("medio_pago", "POSNET")
      .like("id_orden_mp", `${PREFIJO}%`)
      .maybeSingle();
    if (data) return { idVenta: data.id_venta as string, idLocal: (data.id_local as string | null) ?? null };
  }
  const idCobro = String(aviso.payment_request_id ?? "");
  if (/^[\w-]{8,64}$/.test(idCobro)) {
    const { data } = await supabase.from("ventas").select("id_venta, id_local").like("id_orden_mp", `${PREFIJO}%:${idCobro}`).maybeSingle();
    if (data) return { idVenta: data.id_venta as string, idLocal: (data.id_local as string | null) ?? null };
  }
  return null;
}
