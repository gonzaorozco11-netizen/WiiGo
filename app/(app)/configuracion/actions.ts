"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { obtenerUsuarioMp, buscarSucursalMp, crearSucursalMp, buscarCajaMp, crearCajaMp } from "@/lib/mercadopago";

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

// Tasas compartidas por Liquidaciones (rendición a marcas en consignación)
// Y Rentabilidad (margen real de Marca Propia) — antes estaban repartidas
// entre dos secciones distintas de la pantalla sin dejar claro que las usan
// los dos módulos a la vez; ahora viven juntas acá. El royalty y el IVA
// sobre royalty siguen siendo por marca (ficha de cada una), eso no cambia.
export async function guardarConfigImpuestos(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireEditarConfiguracion();
  if (permisoError) return { error: permisoError };

  const impCreditos = Number(formData.get("imp_creditos_porcentaje") ?? 0);
  const sircreb = Number(formData.get("sircreb_porcentaje") ?? 0);
  const impDebitos = Number(formData.get("imp_debitos_porcentaje") ?? 0);
  const ivaGeneral = Number(formData.get("iva_general_porcentaje") ?? 21);

  const supabase = getSupabaseServerClient();

  let error = await guardarParametro(
    supabase,
    "IMP_CREDITOS_PORCENTAJE",
    String(impCreditos),
    "Liquidaciones y Rentabilidad: Impuesto a los Créditos (Ley 25.413) sobre toda venta no efectivo — se le cobra a todas las marcas por igual, no es configurable por marca"
  );
  if (!error) {
    error = await guardarParametro(
      supabase,
      "SIRCREB_PORCENTAJE",
      String(sircreb),
      "Liquidaciones y Rentabilidad: % de SIRCREB a retener preventivamente en marcas con 'trasladar SIRCREB' tildado en su ficha (queda en su cuenta de retenciones, no es ganancia de WiiGo); en el resto lo sigue absorbiendo WiiGo"
    );
  }
  if (!error) {
    error = await guardarParametro(
      supabase,
      "IMP_DEBITOS_PORCENTAJE",
      String(impDebitos),
      "Rentabilidad: Impuesto a los Débitos (Ley 25.413) que cobra el banco al transferir — lo absorbe WiiGo siempre, nunca se le traslada a ninguna marca, solo informativo/proyección"
    );
  }
  if (!error) {
    error = await guardarParametro(
      supabase,
      "IVA_GENERAL_PORCENTAJE",
      String(ivaGeneral),
      "Liquidaciones y Rentabilidad: IVA general — se usa tanto para el IVA que se le suma a la comisión de Mercado Pago como para sacar la facturación neta de productos propios"
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

// Tasas exclusivas de Rentabilidad (margen real de los productos de marca
// propia, WiiGo Dietética) — el IVA general y demás impuestos compartidos
// con Liquidaciones se cargan en guardarConfigImpuestos, no acá.
export async function guardarConfigRentabilidad(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireEditarConfiguracion();
  if (permisoError) return { error: permisoError };

  const iibb = Number(formData.get("iibb_porcentaje") ?? 0);
  const margenMinimo = Number(formData.get("margen_minimo_porcentaje") ?? 15);

  const supabase = getSupabaseServerClient();

  let error = await guardarParametro(
    supabase,
    "IIBB_PORCENTAJE",
    String(iibb),
    "Rentabilidad: alícuota de Ingresos Brutos sobre la facturación neta de productos propios"
  );
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

// Qué se descuenta en Rentabilidad según la forma de pago — antes era fijo
// en el código (IVA siempre, IIBB/Créditos/Comisión MP solo si no era
// efectivo); ahora cada casillero es una decisión explícita, separada por
// Efectivo y Mercado Pago (ver calcularRentabilidad en rentabilidad/actions.ts).
export async function guardarConfigRentabilidadDescuentos(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireEditarConfiguracion();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();

  const claves: { clave: string; campo: string; descripcion: string }[] = [
    { clave: "RENT_EFECTIVO_IVA", campo: "rent_efectivo_iva", descripcion: "Rentabilidad: descontar IVA en ventas en efectivo" },
    { clave: "RENT_EFECTIVO_IIBB", campo: "rent_efectivo_iibb", descripcion: "Rentabilidad: descontar IIBB en ventas en efectivo" },
    {
      clave: "RENT_EFECTIVO_IMP_CREDITOS",
      campo: "rent_efectivo_imp_creditos",
      descripcion: "Rentabilidad: descontar Impuesto a los Créditos en ventas en efectivo",
    },
    { clave: "RENT_MP_IVA", campo: "rent_mp_iva", descripcion: "Rentabilidad: descontar IVA en ventas por Mercado Pago" },
    { clave: "RENT_MP_IIBB", campo: "rent_mp_iibb", descripcion: "Rentabilidad: descontar IIBB en ventas por Mercado Pago" },
    {
      clave: "RENT_MP_IMP_CREDITOS",
      campo: "rent_mp_imp_creditos",
      descripcion: "Rentabilidad: descontar Impuesto a los Créditos en ventas por Mercado Pago",
    },
    { clave: "RENT_MP_COMISION", campo: "rent_mp_comision", descripcion: "Rentabilidad: descontar la comisión de Mercado Pago en ventas por esa vía" },
  ];

  for (const { clave, campo, descripcion } of claves) {
    const valor = formData.get(campo) === "on";
    const error = await guardarParametro(supabase, clave, String(valor), descripcion);
    if (error) return { error };
  }

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

    const sucursal =
      (await buscarSucursalMp(usuario.id, externalStoreId)) ??
      (await crearSucursalMp(usuario.id, "WiiGo Totem", externalStoreId, {
        calle: "Aristides Villanueva",
        altura: "256",
        ciudad: "Mendoza",
        provincia: "Mendoza",
        latitud: -32.8967,
        longitud: -68.8548,
      }));

    if (!(await buscarCajaMp(externalPosId, externalStoreId))) {
      await crearCajaMp({
        storeId: sucursal.id,
        externalStoreId,
        externalPosId,
        nombre: "Totem self-checkout",
      });
    }

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

// Datos fiscales del emisor. Están en la base y no en el código porque una
// vez se publicó un CUIT equivocado y hubo que corregirlo y volver a deployar.
export async function guardarDatosFiscales(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireEditarConfiguracion();
  if (permisoError) return { error: permisoError };

  const cuit = String(formData.get("emisor_cuit") ?? "").trim();
  if (cuit.replace(/\D/g, "").length !== 11) return { error: "El CUIT tiene que tener 11 dígitos." };
  const razonSocial = String(formData.get("emisor_razon_social") ?? "").trim();
  if (!razonSocial) return { error: "Falta la razón social." };

  const supabase = getSupabaseServerClient();
  const valores: [string, string, string][] = [
    ["EMISOR_RAZON_SOCIAL", razonSocial, "Datos fiscales: razón social que se imprime en la factura"],
    ["EMISOR_CUIT", cuit, "Datos fiscales: CUIT de la empresa que emite"],
    ["EMISOR_NOMBRE_FANTASIA", String(formData.get("emisor_nombre_fantasia") ?? "").trim(), "Datos fiscales: nombre comercial"],
    ["EMISOR_CONDICION_IVA", String(formData.get("emisor_condicion_iva") ?? "").trim(), "Datos fiscales: condición frente al IVA"],
    ["EMISOR_DOMICILIO_COMERCIAL", String(formData.get("emisor_domicilio") ?? "").trim(), "Datos fiscales: domicilio comercial"],
    ["EMISOR_INGRESOS_BRUTOS", String(formData.get("emisor_iibb") ?? "").trim(), "Datos fiscales: número de Ingresos Brutos"],
    ["EMISOR_INICIO_ACTIVIDADES", String(formData.get("emisor_inicio") ?? "").trim(), "Datos fiscales: inicio de actividades"],
  ];

  for (const [parametro, valor, descripcion] of valores) {
    const errorParam = await guardarParametro(supabase, parametro, valor, descripcion);
    if (errorParam) return { error: errorParam };
  }

  revalidatePath("/configuracion");
  return { error: null };
}

// Facturación electrónica (ARCA). Todo arranca apagado: nadie debería empezar
// a emitir facturas reales sin decidirlo a mano, y una factura mal emitida no
// se borra — hay que hacer nota de crédito.
export async function guardarConfigArca(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireEditarConfiguracion();
  if (permisoError) return { error: permisoError };

  const habilitado = formData.get("arca_habilitado") === "on";
  const autoEfectivo = formData.get("arca_auto_efectivo") === "on";
  const autoMercadoPago = formData.get("arca_auto_mercado_pago") === "on";
  const puntoVenta = Number(formData.get("arca_punto_venta") ?? 0);
  const iva = Number(formData.get("arca_iva_porcentaje") ?? 21);

  if (!puntoVenta || puntoVenta <= 0) return { error: "Poné el número de punto de venta habilitado en ARCA." };
  if (iva <= 0 || iva > 100) return { error: "El porcentaje de IVA no es válido." };

  const supabase = getSupabaseServerClient();

  const valores: [string, string, string][] = [
    ["ARCA_HABILITADO", habilitado ? "1" : "0", "ARCA: interruptor general de la facturación electrónica"],
    ["ARCA_AUTO_EFECTIVO", autoEfectivo ? "1" : "0", "ARCA: emitir factura sola en las ventas cobradas en efectivo"],
    ["ARCA_AUTO_MERCADO_PAGO", autoMercadoPago ? "1" : "0", "ARCA: emitir factura sola en las ventas cobradas con Mercado Pago"],
    ["ARCA_PUNTO_VENTA", String(puntoVenta), "ARCA: punto de venta habilitado como Web Services"],
    ["ARCA_IVA_PORCENTAJE", String(iva), "ARCA: alícuota de IVA aplicada a las facturas"],
  ];

  for (const [parametro, valor, descripcion] of valores) {
    const errorParam = await guardarParametro(supabase, parametro, valor, descripcion);
    if (errorParam) return { error: errorParam };
  }

  revalidatePath("/configuracion");
  return { error: null };
}
