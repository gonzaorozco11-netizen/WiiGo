"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import type { SupabaseClient } from "@supabase/supabase-js";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

// Usado por POS y Cobros en Efectivo para saber a qué turno estampar una
// venta que se está cobrando ahora mismo. Si no hay ninguno abierto,
// devuelve null y esos módulos rechazan la venta — no se puede cobrar
// sin un turno de caja abierto en ese local.
export async function turnoAbiertoDeLocal(supabase: SupabaseClient, idLocal: string) {
  const { data } = await supabase
    .from("turnos")
    .select("id_turno")
    .eq("id_local", idLocal)
    .eq("estado", "ABIERTO")
    .maybeSingle();
  return data?.id_turno ?? null;
}

export async function abrirTurno(idLocal: string, montoInicial: number) {
  if (montoInicial < 0) throw new Error("El fondo inicial no puede ser negativo");

  const supabase = getSupabaseServerClient();
  const existente = await turnoAbiertoDeLocal(supabase, idLocal);
  if (existente) throw new Error("Ya hay un turno abierto en este local — cerralo antes de abrir uno nuevo.");

  const usuario = await usuarioActual();
  const { error } = await supabase.from("turnos").insert({
    id_local: idLocal,
    usuario_apertura: usuario,
    monto_inicial_efectivo: montoInicial,
    estado: "ABIERTO",
  });
  if (error) throw new Error(friendlyDbError(error));

  revalidatePath("/turnos");
}

// Solo cuenta ventas ya PAGADAS — una pendiente de Self Checkout que
// todavía no confirmó nadie no estampa turno ni entra en el arqueo.
async function resumenTurno(supabase: SupabaseClient, idTurno: string) {
  const { data: ventas, error } = await supabase
    .from("ventas")
    .select("total, medio_pago")
    .eq("id_turno", idTurno)
    .eq("estado", "PAGADA");
  if (error) throw new Error(friendlyDbError(error));

  let totalEfectivo = 0;
  let totalMercadoPago = 0;
  for (const v of ventas ?? []) {
    if (v.medio_pago === "EFECTIVO") totalEfectivo += v.total ?? 0;
    else totalMercadoPago += v.total ?? 0;
  }
  return { totalEfectivo, totalMercadoPago, cantidadVentas: (ventas ?? []).length };
}

export async function resumenTurnoAbierto(idTurno: string) {
  const supabase = getSupabaseServerClient();
  const { data: turno, error } = await supabase
    .from("turnos")
    .select("monto_inicial_efectivo")
    .eq("id_turno", idTurno)
    .maybeSingle();
  if (error) throw new Error(friendlyDbError(error));
  if (!turno) throw new Error("No se encontró el turno");

  const resumen = await resumenTurno(supabase, idTurno);
  return {
    ...resumen,
    montoInicial: turno.monto_inicial_efectivo,
    efectivoEsperado: turno.monto_inicial_efectivo + resumen.totalEfectivo,
  };
}

export async function cerrarTurno(idTurno: string, efectivoContado: number, observaciones: string) {
  if (efectivoContado < 0) throw new Error("El efectivo contado no puede ser negativo");

  const supabase = getSupabaseServerClient();
  const { data: turno, error: errorTurno } = await supabase
    .from("turnos")
    .select("estado, monto_inicial_efectivo")
    .eq("id_turno", idTurno)
    .maybeSingle();
  if (errorTurno) throw new Error(friendlyDbError(errorTurno));
  if (!turno) throw new Error("No se encontró el turno");
  if (turno.estado !== "ABIERTO") throw new Error("Este turno ya está cerrado");

  const resumen = await resumenTurno(supabase, idTurno);
  const efectivoEsperado = turno.monto_inicial_efectivo + resumen.totalEfectivo;
  const usuario = await usuarioActual();

  const { error } = await supabase
    .from("turnos")
    .update({
      estado: "CERRADO",
      usuario_cierre: usuario,
      fecha_cierre: new Date().toISOString(),
      efectivo_esperado: efectivoEsperado,
      efectivo_contado: efectivoContado,
      diferencia_efectivo: efectivoContado - efectivoEsperado,
      total_mercado_pago: resumen.totalMercadoPago,
      cantidad_ventas: resumen.cantidadVentas,
      observaciones: observaciones || null,
    })
    .eq("id_turno", idTurno);
  if (error) throw new Error(friendlyDbError(error));

  revalidatePath("/turnos");
}

export async function historialTurnos(idLocal: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("turnos")
    .select("*")
    .eq("id_local", idLocal)
    .eq("estado", "CERRADO")
    .order("fecha_cierre", { ascending: false })
    .limit(50);
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}
