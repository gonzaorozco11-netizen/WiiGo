import type { SupabaseClient } from "@supabase/supabase-js";

// Los recibos de sueldo de cada empleado, para que los vea y los firme desde
// su usuario (Gonzalo, 2026-11-12: «el recibo firmado digital y que se le
// guarde en su usuario»). Solo los sueldos ya pagados: firmar es decir «lo
// recibí». La firma va en nomina_cierres.firma (sql/pagos-equipo.sql).

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export type MiRecibo = {
  idCierre: string;
  periodo: string;
  etiqueta: string;
  neto: number;
  fechaPago: string | null;
  firmado: boolean;
  firmadoEn: string | null;
};

export function etiquetaPeriodo(periodo: string) {
  const [a, m] = periodo.split("-").map(Number);
  const mes = MESES[m - 1] ?? "";
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${a}`;
}

export async function recibosDePersona(supabase: SupabaseClient, idPersona: string): Promise<{ recibos: MiRecibo[]; faltaSql: boolean }> {
  const traer = (columnas: string) =>
    supabase
      .from("nomina_cierres")
      .select(columnas)
      .eq("id_persona", idPersona)
      .eq("estado", "PAGADO")
      .eq("es_estimado", false)
      .order("periodo", { ascending: false });
  let faltaSql = false;
  let res = await traer("id_cierre, periodo, neto_a_pagar, fecha_pago, firma, firmado_en");
  if (res.error) {
    // Sin sql/pagos-equipo.sql no hay columna de firma: se listan igual.
    faltaSql = true;
    res = await traer("id_cierre, periodo, neto_a_pagar, fecha_pago");
  }
  const recibos = ((res.data ?? []) as unknown as Record<string, unknown>[]).map((c) => ({
    idCierre: c.id_cierre as string,
    periodo: c.periodo as string,
    etiqueta: etiquetaPeriodo(c.periodo as string),
    neto: Number(c.neto_a_pagar ?? 0),
    fechaPago: (c.fecha_pago as string | null) ?? null,
    firmado: Boolean(c.firma),
    firmadoEn: (c.firmado_en as string | null) ?? null,
  }));
  return { recibos, faltaSql };
}

/** Cuántos recibos pagados le falta firmar a este usuario (para Mis Tareas). */
export async function recibosSinFirmar(supabase: SupabaseClient, idUsuario: string): Promise<{ n: number; ultimo: string | null }> {
  const { data: usuario } = await supabase.from("usuarios").select("id_persona").eq("id_usuario", idUsuario).maybeSingle();
  const idPersona = (usuario?.id_persona as string | null) ?? null;
  if (!idPersona) return { n: 0, ultimo: null };
  const { recibos, faltaSql } = await recibosDePersona(supabase, idPersona);
  if (faltaSql) return { n: 0, ultimo: null };
  const pendientes = recibos.filter((r) => !r.firmado);
  return { n: pendientes.length, ultimo: pendientes[0]?.etiqueta ?? null };
}
