import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina } from "@/lib/horarios";

// Un cliente armó su pedido en el tótem, eligió pagar en efectivo y está
// esperando en la caja (Gonzalo, 2026-11-12: «que le figure un (1), una
// notificación tipo alerta, así lo ven»). Son los mismos pedidos que lista
// Cobros en efectivo: del tótem, en efectivo, sin cobrar.
//
// Solo los de hoy: uno de ayer que quedó sin cobrar es un cliente que se fue
// (se cancela desde Cobros), no alguien esperando.

export type CobroEsperando = { numero: number; total: number; desde: string };

export type CobrosEsperando = {
  n: number;
  /** El que espera hace más tiempo. */
  numero: number | null;
  desde: string | null;
  /** Cada pedido esperando, del más viejo al más nuevo (el cartel grande muestra el último que llegó). */
  pedidos: CobroEsperando[];
};

export const NADIE_ESPERANDO: CobrosEsperando = { n: 0, numero: null, desde: null, pedidos: [] };

export async function cobrosEsperando(supabase: SupabaseClient): Promise<CobrosEsperando> {
  const { data, count, error } = await supabase
    .from("ventas")
    .select("numero, fecha, total", { count: "exact" })
    .eq("canal", "SELF_CHECKOUT")
    .eq("medio_pago", "EFECTIVO")
    .eq("estado", "PENDIENTE_PAGO")
    .gte("fecha", `${fechaHoraArgentina().fecha}T00:00:00-03:00`)
    .order("fecha", { ascending: true })
    .limit(20);
  if (error || !count) return NADIE_ESPERANDO;
  const pedidos = (data ?? []).map((v) => ({ numero: Number(v.numero), total: Number(v.total ?? 0), desde: v.fecha as string }));
  return { n: count, numero: pedidos[0]?.numero ?? null, desde: pedidos[0]?.desde ?? null, pedidos };
}

/**
 * Si la persona está trabajando en el local ahora: fichó la entrada hoy y no
 * la salida, o tiene la caja abierta a su nombre. Así el aviso no le suena a
 * quien tiene el sistema abierto en su casa.
 */
export async function estaTrabajando(supabase: SupabaseClient, idUsuario: string): Promise<boolean> {
  const [{ data: usuario }, { data: caja }] = await Promise.all([
    supabase.from("usuarios").select("id_persona").eq("id_usuario", idUsuario).maybeSingle(),
    supabase.from("turnos").select("id_turno").eq("estado", "ABIERTO").eq("id_usuario_apertura", idUsuario).limit(1),
  ]);
  if ((caja ?? []).length > 0) return true;
  const idPersona = (usuario?.id_persona as string | null) ?? null;
  if (!idPersona) return false;
  const { data: ultimo } = await supabase
    .from("fichajes")
    .select("tipo")
    .eq("id_persona", idPersona)
    .gte("fecha_hora", `${fechaHoraArgentina().fecha}T00:00:00-03:00`)
    .order("fecha_hora", { ascending: false })
    .limit(1);
  return ultimo?.[0]?.tipo === "ENTRADA";
}
