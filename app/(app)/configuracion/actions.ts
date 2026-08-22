"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";

async function requireEditarConfiguracion(): Promise<string | null> {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.EDITAR_CONFIGURACION)) {
    return "No tenés permiso para editar la Configuración.";
  }
  return null;
}

// Next.js redacta en producción el mensaje de un Error tirado desde una
// Server Action (queda solo un digest genérico en el navegador) — por eso
// este helper y las funciones que lo usan devuelven { error } en vez de
// throwear.
async function guardarParametro(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  parametro: string,
  valor: string,
  descripcion: string
): Promise<string | null> {
  const { error } = await supabase
    .from("configuracion")
    .upsert(
      { parametro, valor, descripcion, fecha_actualizacion: new Date().toISOString() },
      { onConflict: "parametro" }
    );
  return error ? error.message : null;
}

export async function guardarConfigPuntos(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireEditarConfiguracion();
  if (permisoError) return { error: permisoError };

  const activo = formData.get("puntos_activo") === "on";
  const cadaMonto = Number(formData.get("puntos_cada_monto") ?? 1000);
  const otorgados = Number(formData.get("puntos_otorgados") ?? 0);

  const supabase = getSupabaseServerClient();

  let error = await guardarParametro(supabase, "PUNTOS_ACTIVO", String(activo), "WiiGo Club: acumulación de puntos activada o no");
  if (!error) {
    error = await guardarParametro(
      supabase,
      "PUNTOS_CADA_MONTO",
      String(cadaMonto),
      "WiiGo Club: cada cuántos pesos de compra se otorgan puntos"
    );
  }
  if (!error) {
    error = await guardarParametro(
      supabase,
      "PUNTOS_OTORGADOS",
      String(otorgados),
      "WiiGo Club: cuántos puntos se otorgan por cada tramo de PUNTOS_CADA_MONTO"
    );
  }
  if (error) return { error };

  revalidatePath("/configuracion");
  return { error: null };
}

// Tasas generales para el motor de liquidaciones (rendición a marcas en
// consignación). El royalty y el IVA sobre royalty son por marca (ya
// están en la ficha de cada una) — esto es lo que es igual para todos.
export async function guardarConfigLiquidaciones(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireEditarConfiguracion();
  if (permisoError) return { error: permisoError };

  const impCreditos = Number(formData.get("imp_creditos_porcentaje") ?? 0);
  const sircreb = Number(formData.get("sircreb_porcentaje") ?? 0);
  const impDebitos = Number(formData.get("imp_debitos_porcentaje") ?? 0);

  const supabase = getSupabaseServerClient();

  let error = await guardarParametro(
    supabase,
    "IMP_CREDITOS_PORCENTAJE",
    String(impCreditos),
    "Liquidaciones: Impuesto a los Créditos (Ley 25.413) sobre la venta bruta"
  );
  if (!error) {
    error = await guardarParametro(
      supabase,
      "SIRCREB_PORCENTAJE",
      String(sircreb),
      "Liquidaciones: retención SIRCREB — la absorbe WiiGo, solo informativo (crédito a favor de IIBB)"
    );
  }
  if (!error) {
    error = await guardarParametro(
      supabase,
      "IMP_DEBITOS_PORCENTAJE",
      String(impDebitos),
      "Liquidaciones: Impuesto a los Débitos (Ley 25.413) que cobra el banco al transferir — lo absorbe WiiGo, solo informativo/proyección"
    );
  }
  if (error) return { error };

  revalidatePath("/configuracion");
  return { error: null };
}

// La comisión real de Mercado Pago no es una tasa única: varía según cómo
// pagó el cliente (dinero en cuenta, débito, crédito, cuotas, prepaga).
// Cada tasa se carga SIN IVA (la base tal cual la publica Mercado Pago) —
// el IVA se suma aparte en el cálculo, ver liquidaciones/rentabilidad.
export async function guardarConfigMercadoPago(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireEditarConfiguracion();
  if (permisoError) return { error: permisoError };

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
    const error = await guardarParametro(supabase, clave, String(valor), `Comisión de Mercado Pago — ${descripcion} (base, sin IVA)`);
    if (error) return { error };
  }

  revalidatePath("/configuracion");
  return { error: null };
}

// Tasas para calcular la rentabilidad real de los productos de marca
// propia (WiiGo Dietética) — el IVA se saca de la facturación (débito
// fiscal se compensa con crédito fiscal, no es un costo) y se suma el
// costo impositivo directo de Ingresos Brutos.
export async function guardarConfigRentabilidad(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireEditarConfiguracion();
  if (permisoError) return { error: permisoError };

  const ivaGeneral = Number(formData.get("iva_general_porcentaje") ?? 21);
  const iibb = Number(formData.get("iibb_porcentaje") ?? 0);
  const margenMinimo = Number(formData.get("margen_minimo_porcentaje") ?? 15);

  const supabase = getSupabaseServerClient();

  let error = await guardarParametro(
    supabase,
    "IVA_GENERAL_PORCENTAJE",
    String(ivaGeneral),
    "Rentabilidad: IVA incluido en el precio de venta de los productos propios, para sacar la facturación neta"
  );
  if (!error) {
    error = await guardarParametro(
      supabase,
      "IIBB_PORCENTAJE",
      String(iibb),
      "Rentabilidad: alícuota de Ingresos Brutos sobre la facturación neta de productos propios"
    );
  }
  if (!error) {
    error = await guardarParametro(
      supabase,
      "MARGEN_MINIMO_PORCENTAJE",
      String(margenMinimo),
      "Productos: margen sobre venta mínimo recomendado para no perder plata (cubre IIBB, costos financieros de cobro y un colchón operativo) — se usa para la alerta al cargar precios"
    );
  }
  if (error) return { error };

  revalidatePath("/configuracion");
  return { error: null };
}

// Tope a partir del cual un gasto necesita la contraseña de un
// administrador para confirmarse (ver crearGasto en app/(app)/gastos/actions.ts).
export async function guardarConfigGastos(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireEditarConfiguracion();
  if (permisoError) return { error: permisoError };

  const tope = Number(formData.get("gastos_tope_sin_autorizacion") ?? 10000);

  const supabase = getSupabaseServerClient();

  const error = await guardarParametro(
    supabase,
    "GASTOS_TOPE_SIN_AUTORIZACION",
    String(tope),
    "Gastos: por encima de este monto, un operativo necesita la contraseña de un administrador para confirmarlo"
  );
  if (error) return { error };

  revalidatePath("/configuracion");
  return { error: null };
}
