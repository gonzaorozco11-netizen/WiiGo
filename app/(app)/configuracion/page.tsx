import { getSupabaseServerClient } from "@/lib/supabase";
import ConfiguracionApp from "@/components/ConfiguracionApp";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const supabase = getSupabaseServerClient();

  const { data } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", [
      "PUNTOS_ACTIVO",
      "PUNTOS_CADA_MONTO",
      "PUNTOS_OTORGADOS",
      "IMP_CREDITOS_PORCENTAJE",
      "SIRCREB_PORCENTAJE",
      "IMP_DEBITOS_PORCENTAJE",
      "IVA_GENERAL_PORCENTAJE",
      "IIBB_PORCENTAJE",
      "MARGEN_MINIMO_PORCENTAJE",
      "MP_COMISION_DINERO_CUENTA",
      "MP_COMISION_DEBITO",
      "MP_COMISION_CUOTAS_SIN_INTERES",
      "MP_COMISION_PREPAGA",
      "MP_COMISION_CREDITO",
    ]);

  const valores = new Map((data ?? []).map((c) => [c.parametro, c.valor]));

  return (
    <ConfiguracionApp
      puntosActivo={valores.get("PUNTOS_ACTIVO") === "true"}
      puntosCadaMonto={Number(valores.get("PUNTOS_CADA_MONTO") ?? 1000)}
      puntosOtorgados={Number(valores.get("PUNTOS_OTORGADOS") ?? 10)}
      impCreditosPorcentaje={Number(valores.get("IMP_CREDITOS_PORCENTAJE") ?? 0.6)}
      sircrebPorcentaje={Number(valores.get("SIRCREB_PORCENTAJE") ?? 5)}
      impDebitosPorcentaje={Number(valores.get("IMP_DEBITOS_PORCENTAJE") ?? 0.6)}
      ivaGeneralPorcentaje={Number(valores.get("IVA_GENERAL_PORCENTAJE") ?? 21)}
      iibbPorcentaje={Number(valores.get("IIBB_PORCENTAJE") ?? 0)}
      margenMinimoPorcentaje={Number(valores.get("MARGEN_MINIMO_PORCENTAJE") ?? 15)}
      mpComisionDineroCuenta={Number(valores.get("MP_COMISION_DINERO_CUENTA") ?? 0.8)}
      mpComisionDebito={Number(valores.get("MP_COMISION_DEBITO") ?? 1.39)}
      mpComisionCuotasSinInteres={Number(valores.get("MP_COMISION_CUOTAS_SIN_INTERES") ?? 1.38)}
      mpComisionPrepaga={Number(valores.get("MP_COMISION_PREPAGA") ?? 3.85)}
      mpComisionCredito={Number(valores.get("MP_COMISION_CREDITO") ?? 6.15)}
    />
  );
}
