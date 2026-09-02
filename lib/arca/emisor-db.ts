import { getSupabaseServerClient } from "@/lib/supabase";
import { EMISOR } from "@/lib/emisor";

// Datos fiscales editables desde Configuración.
//
// Antes estaban escritos en lib/emisor.ts y hubo que corregir el CUIT a mano
// y volver a deployar cuando resultó estar mal. Ahora se guardan en la tabla
// `configuracion` y `lib/emisor.ts` queda solo como valores por defecto para
// cuando todavía no se cargaron.

export const PARAMETROS_EMISOR = [
  "EMISOR_RAZON_SOCIAL",
  "EMISOR_CUIT",
  "EMISOR_NOMBRE_FANTASIA",
  "EMISOR_CONDICION_IVA",
  "EMISOR_DOMICILIO_COMERCIAL",
  "EMISOR_INGRESOS_BRUTOS",
  "EMISOR_INICIO_ACTIVIDADES",
] as const;

export type DatosEmisor = {
  razonSocial: string;
  cuit: string;
  nombreFantasia: string;
  condicionIva: string;
  domicilioComercial: string;
  ingresosBrutos: string;
  inicioActividades: string;
};

export async function obtenerEmisor(): Promise<DatosEmisor> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase.from("configuracion").select("parametro, valor").in("parametro", [...PARAMETROS_EMISOR]);
  const m = new Map((data ?? []).map((r) => [r.parametro as string, (r.valor as string) ?? ""]));

  const oNo = (clave: string, porDefecto: string) => {
    const v = m.get(clave);
    return v && v.trim() ? v : porDefecto;
  };

  return {
    razonSocial: oNo("EMISOR_RAZON_SOCIAL", EMISOR.razonSocial),
    cuit: oNo("EMISOR_CUIT", EMISOR.cuit),
    nombreFantasia: oNo("EMISOR_NOMBRE_FANTASIA", EMISOR.nombreFantasia),
    condicionIva: oNo("EMISOR_CONDICION_IVA", EMISOR.condicionIva),
    domicilioComercial: oNo("EMISOR_DOMICILIO_COMERCIAL", EMISOR.domicilioComercial),
    ingresosBrutos: oNo("EMISOR_INGRESOS_BRUTOS", EMISOR.ingresosBrutos),
    inicioActividades: oNo("EMISOR_INICIO_ACTIVIDADES", EMISOR.inicioActividades),
  };
}
