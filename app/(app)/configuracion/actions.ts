"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";

async function guardarParametro(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  parametro: string,
  valor: string,
  descripcion: string
) {
  const { error } = await supabase
    .from("configuracion")
    .upsert(
      { parametro, valor, descripcion, fecha_actualizacion: new Date().toISOString() },
      { onConflict: "parametro" }
    );
  if (error) throw new Error(error.message);
}

export async function guardarConfigPuntos(formData: FormData) {
  const activo = formData.get("puntos_activo") === "on";
  const cadaMonto = Number(formData.get("puntos_cada_monto") ?? 1000);
  const otorgados = Number(formData.get("puntos_otorgados") ?? 0);

  const supabase = getSupabaseServerClient();

  await guardarParametro(supabase, "PUNTOS_ACTIVO", String(activo), "WiiGo Club: acumulación de puntos activada o no");
  await guardarParametro(
    supabase,
    "PUNTOS_CADA_MONTO",
    String(cadaMonto),
    "WiiGo Club: cada cuántos pesos de compra se otorgan puntos"
  );
  await guardarParametro(
    supabase,
    "PUNTOS_OTORGADOS",
    String(otorgados),
    "WiiGo Club: cuántos puntos se otorgan por cada tramo de PUNTOS_CADA_MONTO"
  );

  revalidatePath("/configuracion");
}

// Tasas generales para el motor de liquidaciones (rendición a marcas en
// consignación). El royalty y el IVA sobre royalty son por marca (ya
// están en la ficha de cada una) — esto es lo que es igual para todos.
export async function guardarConfigLiquidaciones(formData: FormData) {
  const impCreditos = Number(formData.get("imp_creditos_porcentaje") ?? 0);
  const sircreb = Number(formData.get("sircreb_porcentaje") ?? 0);
  const mpComision = Number(formData.get("mp_comision_porcentaje") ?? 0);

  const supabase = getSupabaseServerClient();

  await guardarParametro(
    supabase,
    "IMP_CREDITOS_PORCENTAJE",
    String(impCreditos),
    "Liquidaciones: Impuesto a los Créditos (Ley 25.413) sobre la venta bruta"
  );
  await guardarParametro(
    supabase,
    "SIRCREB_PORCENTAJE",
    String(sircreb),
    "Liquidaciones: retención SIRCREB — la absorbe WiiGo, solo informativo (crédito a favor de IIBB)"
  );
  await guardarParametro(
    supabase,
    "MP_COMISION_PORCENTAJE",
    String(mpComision),
    "Liquidaciones: comisión de Mercado Pago mientras no esté conectada la API real (estimada, a mano)"
  );

  revalidatePath("/configuracion");
}
