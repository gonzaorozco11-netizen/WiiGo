"use server";

import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { cobrosDelPeriodo, sincronizarMp, type Cobro } from "@/lib/cobrosDigitales";

// Cobros digitales (Gonzalo, 17/11). Ver lib/cobrosDigitales.ts.

async function puede(): Promise<boolean> {
  const sesion = await obtenerSesionConPantallas();
  return puedeVerPantalla(sesion, "cobros-digitales");
}

export async function cargarCobros(
  desde: string,
  hasta: string
): Promise<{ error: string | null; cobros: Cobro[]; ventasSinCobro: { idVenta: string; numero: number; total: number; fecha: string }[]; ultimoReporte: string | null }> {
  if (!(await puede())) return { error: "No tenés permiso para ver Cobros digitales.", cobros: [], ventasSinCobro: [], ultimoReporte: null };
  const supabase = getSupabaseServerClient();
  try {
    const [{ cobros, ventasSinCobro }, { data: ultimo }] = await Promise.all([
      cobrosDelPeriodo(supabase, desde, hasta),
      supabase.from("cobros_digitales_reportes").select("leido_el").order("leido_el", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return { error: null, cobros, ventasSinCobro, ultimoReporte: (ultimo?.leido_el as string | undefined) ?? null };
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/cobros_digitales/.test(msg) && /exist|relation|schema/i.test(msg)) {
      return { error: "Falta correr sql/cobros-digitales.sql en Supabase.", cobros: [], ventasSinCobro: [], ultimoReporte: null };
    }
    return { error: msg || "No se pudieron cargar los cobros.", cobros: [], ventasSinCobro: [], ultimoReporte: null };
  }
}

/** «Actualizar ahora»: lee lo que ya esté listo y pide un reporte nuevo de los últimos días. */
export async function actualizarCobros(dias: number): Promise<{ error: string | null; mensaje: string }> {
  if (!(await puede())) return { error: "No tenés permiso.", mensaje: "" };
  try {
    const r = await sincronizarMp(getSupabaseServerClient(), { pedir: true, dias: Math.min(Math.max(dias, 1), 60) });
    const partes = [
      r.leidos ? `Se leyeron ${r.leidos} reporte${r.leidos === 1 ? "" : "s"} (${r.filas} movimientos).` : "No había reportes nuevos para leer.",
      r.pedido ? "Le pedí a Mercado Pago el reporte de los últimos días: lo arma en unos minutos. Volvé a tocar «Actualizar ahora» en un rato para traerlo." : "",
      ...r.avisos,
    ].filter(Boolean);
    return { error: null, mensaje: partes.join(" ") };
  } catch (e) {
    return { error: `Mercado Pago respondió: ${(e as Error).message}`, mensaje: "" };
  }
}
