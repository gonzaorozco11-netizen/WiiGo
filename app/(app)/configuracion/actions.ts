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
