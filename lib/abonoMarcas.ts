import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarMail, plantilla } from "@/lib/mail";
import { baseUrlPublica } from "@/lib/urlPublica";

// El canon (abono) mensual de las marcas (Gonzalo, 20/11/2026).
//
// Animalfit $750.000 + IVA y Alta $650.000 + IVA por mes. El de cada mes se
// carga solo el día 25 (cargos_recurrentes_marca.dia_mes, api/cron/cargos-recurrentes)
// y se paga del 1 al 5 del mes siguiente, aparte de la liquidación (no se descuenta).
// El primer mes es proporcional desde `desde`: arrancaron el 12/11 pero se cobra
// desde el 15, así que noviembre son 16 de 30 días (sql/abono-marcas.sql).
//
// Qué está pagado sale de la cuenta comercial: los pagos que Gonzalo registra en
// Situación de marca se aplican a los cargos más viejos primero.

/** Se paga del 1 al 5 del mes siguiente (Gonzalo, 20/11). */
export const DIA_VENCE_ABONO = 5;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const esPeriodoMensual = (p: string | null | undefined): p is string => Boolean(p && /^\d{4}-\d{2}$/.test(p));

export function nombreMes(periodo: string): string {
  return MESES[Number(periodo.slice(5, 7)) - 1] ?? periodo;
}

export function diasDelMes(periodo: string): number {
  const [a, m] = periodo.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** El último día para pagar: el 5 del mes siguiente al período, «YYYY-MM-DD». */
export function venceAbono(periodo: string): string {
  const [a, m] = periodo.split("-").map(Number);
  const sig = m === 12 ? { a: a + 1, m: 1 } : { a, m: m + 1 };
  return `${sig.a}-${String(sig.m).padStart(2, "0")}-${String(DIA_VENCE_ABONO).padStart(2, "0")}`;
}

/** «5 de diciembre». */
export function fechaLarga(iso: string): string {
  return `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1] ?? ""}`;
}

/**
 * Lo del período: el mes entero, o proporcional si arrancó ese mes.
 * Null si todavía no arrancó (no se cobra nada).
 */
export function abonoDelPeriodo(monto: number, periodo: string, desde: string | null): { neto: number; concepto: string } | null {
  const diasMes = diasDelMes(periodo);
  const mes = nombreMes(periodo);
  if (desde && desde.slice(0, 7) > periodo) return null;
  if (desde && desde.slice(0, 7) === periodo) {
    const dia = Number(desde.slice(8, 10));
    const dias = diasMes - dia + 1;
    if (dia > 1) {
      return {
        neto: Math.round(((monto * dias) / diasMes) * 100) / 100,
        concepto: `Canon de ${mes} (del ${dia} al ${diasMes}: ${dias} de ${diasMes} días)`,
      };
    }
  }
  return { neto: monto, concepto: `Canon de ${mes}` };
}

export type EstadoCargo = "PAGADO" | "A_VENCER" | "VENCIDO";

export type CargoDeMarca = {
  concepto: string;
  periodo: string | null;
  fecha: string;
  importe: number;
  neto: number | null;
  iva: number | null;
  vence: string;
  /** Lo que ya cubren los pagos. */
  pagado: number;
  estado: EstadoCargo;
  esAbono: boolean;
};

const ETIQUETA: Record<string, string> = {
  FEE_INGRESO: "Fee de ingreso",
  GASTO_FIJO_MENSUAL: "Gasto fijo mensual",
  CARGO_RECURRENTE: "Cargo mensual",
  OTRO_CARGO: "Otro cargo",
};

/** Los cargos de la marca con lo pagado de cada uno, y cuánto debe hoy. */
export async function cuentaDeMarca(
  supabase: SupabaseClient,
  idMarca: string,
  hoy: string
): Promise<{ cargos: CargoDeMarca[]; pendiente: number }> {
  const { data, error } = await supabase
    .from("movimientos_cuenta_comercial_marca")
    .select("tipo_cargo, importe, neto, iva, periodo, fecha, observaciones, anulado")
    .eq("id_marca", idMarca)
    .order("fecha", { ascending: true })
    .limit(500);
  if (error) return { cargos: [], pendiente: 0 };
  const filas = (data ?? []).filter((m) => !m.anulado);

  let aFavor = filas.filter((m) => Number(m.importe) < 0).reduce((a, m) => a - Number(m.importe), 0);
  const cargos: CargoDeMarca[] = [];
  for (const m of filas) {
    const importe = Number(m.importe) || 0;
    if (importe <= 0) continue;
    const periodo = (m.periodo as string | null) ?? null;
    const recurrente = m.tipo_cargo === "CARGO_RECURRENTE" && esPeriodoMensual(periodo);
    const vence = recurrente ? venceAbono(periodo!) : String(m.fecha ?? hoy).slice(0, 10);
    const pagado = Math.min(importe, aFavor);
    aFavor -= pagado;
    const estado: EstadoCargo = pagado >= importe - 0.01 ? "PAGADO" : hoy > vence ? "VENCIDO" : "A_VENCER";
    cargos.push({
      concepto: (m.observaciones as string) || ETIQUETA[m.tipo_cargo as string] || "Cargo",
      periodo,
      fecha: String(m.fecha ?? "").slice(0, 10),
      importe,
      neto: m.neto == null ? null : Number(m.neto),
      iva: m.iva == null ? null : Number(m.iva),
      vence,
      pagado,
      estado,
      esAbono: recurrente,
    });
  }
  const pendiente = cargos.reduce((a, c) => a + (c.importe - c.pagado), 0);
  return { cargos, pendiente: Math.round(pendiente * 100) / 100 };
}

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;

/**
 * Los mails del canon (los corre el cron diario de cargos recurrentes):
 *   - el 1.º del mes: «ya podés pagar el canon de noviembre, del 1 al 5»;
 *   - el 4: recordatorio, si todavía no está pagado.
 * Solo al que le queda algo por pagar de ese canon. Nunca tira.
 */
export async function avisarCanon(supabase: SupabaseClient, hoy: string): Promise<string[]> {
  const dia = Number(hoy.slice(8, 10));
  if (dia !== 1 && dia !== DIA_VENCE_ABONO - 1) return [];
  const [a, m] = hoy.slice(0, 7).split("-").map(Number);
  const periodo = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
  const recordatorio = dia !== 1;
  const enviados: string[] = [];
  try {
    const { data: marcas } = await supabase.from("marcas").select("id_marca, nombre, email, avisos_mails").eq("estado", "ACTIVA");
    for (const marca of marcas ?? []) {
      const { cargos } = await cuentaDeMarca(supabase, marca.id_marca as string, hoy);
      const canon = cargos.find((c) => c.esAbono && c.periodo === periodo && c.estado !== "PAGADO");
      if (!canon) continue;
      const mails = (((marca.avisos_mails as string[] | null) ?? []).filter(Boolean).length
        ? (marca.avisos_mails as string[])
        : [marca.email as string | null]
      ).filter((x): x is string => Boolean(x && x.includes("@")));
      if (!mails.length) continue;
      const debe = canon.importe - canon.pagado;
      const mes = nombreMes(periodo);
      const asunto = recordatorio ? `Mañana vence tu canon de ${mes}: ${pesos(debe)}` : `Tu canon de ${mes}: ${pesos(debe)}`;
      const detalle = [
        canon.concepto,
        ...(canon.neto != null && canon.iva != null ? [`${pesos(canon.neto)} + IVA ${pesos(canon.iva)}`] : []),
      ];
      const cuando = `Se paga del 1 al ${DIA_VENCE_ABONO} de ${nombreMes(canon.vence.slice(0, 7))}.`;
      const html = plantilla({
        titulo: recordatorio ? `Mañana vence tu canon de ${mes}` : `Tu canon de ${mes}`,
        tono: "ambar",
        destacado: pesos(debe),
        detalle,
        cuerpo: `${cuando} Pedile a Gonzalo los datos para transferir.`,
        boton: { texto: "Ver en mi portal", url: `${baseUrlPublica("https://app.wiigo.com.ar")}/portal` },
        base: baseUrlPublica("https://app.wiigo.com.ar"),
      });
      const r = await enviarMail({ para: mails, asunto, html, texto: `${asunto}. ${detalle.join(". ")}. ${cuando} Pedile a Gonzalo los datos para transferir.` });
      await supabase.from("avisos_enviados").insert({
        id_marca: marca.id_marca,
        tipo: "CANON",
        referencia: `canon-${periodo}-${dia}`,
        asunto,
        destinatarios: mails,
        ok: r.ok,
        error: r.error,
      });
      enviados.push(`${marca.nombre}: ${asunto}${r.ok ? "" : ` (no salió: ${r.error})`}`);
    }
  } catch (e) {
    console.error("[canon] mails", e);
  }
  return enviados;
}
