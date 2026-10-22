import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina, minutosDeHora } from "@/lib/horarios";
import type { ItemTablero } from "@/lib/tablero";

// Avisos para el Dueño en el Inicio: la caja y los llamados de atención.
//
// - Caja sin abrir: hay un turno de trabajo en curso hace media hora o más
//   y el local no tiene la caja abierta (nadie puede cobrar).
// - Caja abierta de un día anterior: alguien se fue sin cerrar.
// - Caja abierta con otra cantidad en el sobre de cambio.
// - Sobres de recaudación sin contar.
// - Llamados del mes: quién se negó a firmar, quién no firmó, y los
//   apercibimientos.
//
// Todo tolera que todavía no se haya corrido sql/llamados-y-caja.sql: si una
// consulta falla, ese aviso no aparece.

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const MEDIA_HORA = 30;

export async function avisosCajaYLlamados(supabase: SupabaseClient): Promise<{ urgentes: ItemTablero[]; seguimiento: ItemTablero[] }> {
  const ahora = fechaHoraArgentina();
  const periodo = ahora.fecha.slice(0, 7);
  const [locales, abiertos, horarios, sinContar, sanciones, aprender] = await Promise.all([
    supabase.from("locales").select("id_local, nombre").eq("estado", "ACTIVO"),
    supabase.from("turnos").select("*").eq("estado", "ABIERTO"),
    supabase.from("horarios_trabajo").select("nombre, hora_entrada, hora_salida, dias_semana").eq("estado", "ACTIVO"),
    supabase.from("turnos").select("id_turno", { count: "exact", head: true }).eq("estado", "CERRADO").not("recaudacion", "is", null).is("recuento", null),
    supabase.from("sanciones").select("id_persona, tipo, se_nego, firmado_en, creado_en, estado").eq("periodo", periodo).eq("estado", "VIGENTE"),
    supabase.from("aprender_fichas").select("id_ficha", { count: "exact", head: true }).not("borrador", "is", null),
  ]);

  // Aprender: explicaciones que escribió la IA esperando tu aprobación.
  const paraRevisar = aprender.error ? 0 : aprender.count ?? 0;

  const urgentes: ItemTablero[] = [];
  const seguimiento: ItemTablero[] = [];
  const abiertosPorLocal = new Map((abiertos.data ?? []).map((t) => [t.id_local as string, t as Record<string, unknown>]));

  // Caja sin abrir con un turno de trabajo en curso.
  const enCurso = (horarios.data ?? []).find((h) => {
    const dias = (h.dias_semana as number[] | null) ?? [];
    if (!dias.includes(ahora.diaSemanaISO) || !h.hora_salida) return false;
    const entrada = minutosDeHora(h.hora_entrada as string);
    return ahora.minutosDelDia >= entrada + MEDIA_HORA && ahora.minutosDelDia < minutosDeHora(h.hora_salida as string);
  });
  for (const l of locales.data ?? []) {
    const abierto = abiertosPorLocal.get(l.id_local as string);
    if (!abierto && enCurso) {
      urgentes.push({
        color: "rojo",
        titulo: `Caja sin abrir en ${l.nombre}`,
        detalle: `El ${enCurso.nombre} empezó a las ${(enCurso.hora_entrada as string).slice(0, 5)} y nadie abrió la caja: no se puede cobrar`,
        valor: "→",
        href: "/turnos",
      });
    }
    if (abierto) {
      const fechaApertura = fechaHoraArgentina(abierto.fecha_apertura as string).fecha;
      if (fechaApertura < ahora.fecha) {
        urgentes.push({
          color: "rojo",
          titulo: `Caja abierta desde el ${fechaApertura.slice(8, 10)}/${fechaApertura.slice(5, 7)} en ${l.nombre}`,
          detalle: `La abrió ${(abierto.usuario_apertura as string) ?? "alguien"} y nadie la cerró`,
          valor: "→",
          href: "/turnos",
        });
      } else if (abierto.cambio_esperado != null && Number(abierto.cambio_esperado) !== Number(abierto.monto_inicial_efectivo)) {
        urgentes.push({
          color: "ambar",
          titulo: `El sobre de cambio no tenía lo que debía`,
          detalle: `${(abierto.usuario_apertura as string) ?? "Alguien"} abrió la caja de ${l.nombre} con ${pesos(Number(abierto.monto_inicial_efectivo))}: tenía que haber ${pesos(Number(abierto.cambio_esperado))}`,
          valor: "→",
          href: "/turnos",
        });
      }
    }
  }

  if (paraRevisar > 0) {
    seguimiento.push({
      color: "azul",
      titulo: `${paraRevisar} ${paraRevisar === 1 ? "explicación" : "explicaciones"} de Aprender para revisar`,
      detalle: "Leelas y aprobalas para que el equipo las estudie",
      valor: String(paraRevisar),
      href: "/aprender/revisar",
    });
  }

  // Sobres de recaudación sin contar.
  const sobres = sinContar.error ? 0 : sinContar.count ?? 0;
  if (sobres > 0) {
    seguimiento.push({
      color: "azul",
      titulo: `${sobres} ${sobres === 1 ? "sobre de recaudación" : "sobres de recaudación"} sin contar`,
      detalle: "Contalos y anotá cuánto había en Operaciones → Turnos",
      valor: String(sobres),
      href: "/turnos",
    });
  }

  // Llamados de atención del mes.
  if (!sanciones.error) {
    const lista = sanciones.data ?? [];
    const negados = lista.filter((s) => s.se_nego).length;
    const haceUnaHora = Date.now() - 3600 * 1000;
    const sinFirmar = lista.filter((s) => !s.firmado_en && !s.se_nego && Date.parse(s.creado_en as string) < haceUnaHora).length;
    const apercibimientos = lista.filter((s) => s.tipo === "APERCIBIMIENTO").length;
    if (negados > 0) {
      urgentes.push({
        color: "ambar",
        titulo: `${negados === 1 ? "Un llamado de atención sin firmar: se negó" : `${negados} llamados sin firmar: se negaron`}`,
        detalle: "Imprimilo desde el legajo y entregalo delante de un testigo",
        valor: String(negados),
        href: "/rrhh/legajos",
      });
    }
    if (sinFirmar > 0) {
      seguimiento.push({
        color: "ambar",
        titulo: `${sinFirmar === 1 ? "Un llamado de atención quedó" : `${sinFirmar} llamados quedaron`} sin firmar`,
        detalle: "Fichó tarde y salió de la pantalla sin firmar la nota",
        valor: String(sinFirmar),
        href: "/rrhh/legajos",
      });
    }
    if (apercibimientos > 0) {
      seguimiento.push({
        color: "ambar",
        titulo: `${apercibimientos} ${apercibimientos === 1 ? "apercibimiento" : "apercibimientos"} este mes`,
        detalle: "Por llegadas tarde repetidas. Mirá en el legajo si corresponde algo más",
        valor: String(apercibimientos),
        href: "/rrhh/legajos",
      });
    }
  }

  return { urgentes, seguimiento };
}
