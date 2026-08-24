"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { obtenerUsuarioMp, crearSucursalMp, crearCajaMp } from "@/lib/mercadopago";

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
  const topeCanje = Number(formData.get("puntos_tope_canje_porcentaje") ?? 0);
  if (topeCanje < 0 || topeCanje > 100) return { error: "El tope de canje tiene que estar entre 0% y 100%." };

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
  if (!error) {
    error = await guardarParametro(
      supabase,
      "PUNTOS_TOPE_CANJE_PORCENTAJE",
      String(topeCanje),
      "WiiGo Club: qué % máximo de una compra se puede pagar con puntos"
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
      "Liquidaciones: % de SIRCREB a retener preventivamente en marcas con 'trasladar SIRCREB' tildado en su ficha (queda en su cuenta de retenciones, no es ganancia de WiiGo); en el resto lo sigue absorbiendo WiiGo"
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

// Conexión de una única vez: crea (si no existe) una sucursal y una caja en
// Mercado Pago para el totem, y guarda los IDs en Configuración — de ahí en
// más el self-checkout ya puede pedir órdenes de QR dinámico. Si se toca de
// nuevo, no rompe nada: Mercado Pago devuelve la sucursal/caja existente si
// el external_id ya se había usado antes.
export async function conectarMercadoPagoQR(): Promise<{ error: string | null; posId?: string }> {
  const permisoError = await requireEditarConfiguracion();
  if (permisoError) return { error: permisoError };

  try {
    const usuario = await obtenerUsuarioMp();
    const supabase = getSupabaseServerClient();

    const externalStoreId = "WIIGOTOTEM";
    const externalPosId = "WIIGOTOTEMCAJA1";

    const sucursal = await crearSucursalMp(usuario.id, "WiiGo Totem", externalStoreId, {
      calle: "Aristides Villanueva",
      altura: "256",
      ciudad: "Mendoza",
      provincia: "Mendoza",
      latitud: -32.8967,
      longitud: -68.8548,
    });
    await crearCajaMp({
      storeId: sucursal.id,
      externalStoreId,
      externalPosId,
      nombre: "Totem self-checkout",
    });

    let error = await guardarParametro(supabase, "MP_USER_ID", String(usuario.id), "Mercado Pago: id de usuario/vendedor conectado");
    if (!error) {
      error = await guardarParametro(supabase, "MP_STORE_ID", sucursal.id, "Mercado Pago: id de la sucursal creada para el totem");
    }
    if (!error) {
      error = await guardarParametro(
        supabase,
        "MP_EXTERNAL_POS_ID",
        externalPosId,
        "Mercado Pago: id de la caja usada para generar el QR del totem"
      );
    }
    if (error) return { error };

    revalidatePath("/configuracion");
    return { error: null, posId: externalPosId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo conectar con Mercado Pago" };
  }
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
