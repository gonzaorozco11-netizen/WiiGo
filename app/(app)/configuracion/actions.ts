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
  const impDebitos = Number(formData.get("imp_debitos_porcentaje") ?? 0);

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
    "IMP_DEBITOS_PORCENTAJE",
    String(impDebitos),
    "Liquidaciones: Impuesto a los Débitos (Ley 25.413) que cobra el banco al transferir — lo absorbe WiiGo, solo informativo/proyección"
  );

  revalidatePath("/configuracion");
}

// La comisión real de Mercado Pago no es una tasa única: varía según cómo
// pagó el cliente (dinero en cuenta, débito, crédito, cuotas, prepaga).
// Cada tasa se carga SIN IVA (la base tal cual la publica Mercado Pago) —
// el IVA se suma aparte en el cálculo, ver liquidaciones/rentabilidad.
export async function guardarConfigMercadoPago(formData: FormData) {
  const tasas: Record<string, string> = {
    MP_COMISION_DINERO_CUENTA: "Dinero en cuenta de Mercado Pago",
    MP_COMISION_DEBITO: "Tarjeta de débito",
    MP_COMISION_CUOTAS_SIN_INTERES: "Cuotas sin interés",
    MP_COMISION_PREPAGA: "Tarjeta prepaga",
    MP_COMISION_CREDITO: "Tarjeta de crédito",
  };

  const supabase = getSupabaseServerClient();

  for (const [clave, descripcion] of Object.entries(tasas)) {
    const valor = Number(formData.get(clave.toLowerCase()) ?? 0);
    await guardarParametro(supabase, clave, String(valor), `Comisión de Mercado Pago — ${descripcion} (base, sin IVA)`);
  }

  revalidatePath("/configuracion");
}

// Tasas para calcular la rentabilidad real de los productos de marca
// propia (WiiGo Dietética) — el IVA se saca de la facturación (débito
// fiscal se compensa con crédito fiscal, no es un costo) y se suma el
// costo impositivo directo de Ingresos Brutos.
export async function guardarConfigRentabilidad(formData: FormData) {
  const ivaGeneral = Number(formData.get("iva_general_porcentaje") ?? 21);
  const iibb = Number(formData.get("iibb_porcentaje") ?? 0);

  const supabase = getSupabaseServerClient();

  await guardarParametro(
    supabase,
    "IVA_GENERAL_PORCENTAJE",
    String(ivaGeneral),
    "Rentabilidad: IVA incluido en el precio de venta de los productos propios, para sacar la facturación neta"
  );
  await guardarParametro(
    supabase,
    "IIBB_PORCENTAJE",
    String(iibb),
    "Rentabilidad: alícuota de Ingresos Brutos sobre la facturación neta de productos propios"
  );

  revalidatePath("/configuracion");
}
