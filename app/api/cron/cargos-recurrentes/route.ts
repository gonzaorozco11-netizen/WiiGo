// Corre una vez por día (ver vercel.json) y genera solo los cargos a
// marca recurrentes (canon, publicidad, etc.) cuyo día del mes ya llegó y
// todavía no se generaron este período.
//
// A propósito NO automatiza "Gasto mío" ni "Otro ingreso" — esos siguen
// semi-automáticos, alguien tiene que confirmar el monto real antes de
// que salga plata de una caja (ver gastos/actions.ts: cargarRecurrente).
// Un cargo a marca en cambio solo genera una deuda contable en su cuenta
// comercial — no hay plata física en juego, así que es seguro generarlo
// solo, sin que nadie lo mire primero.
import { getSupabaseServerClient } from "@/lib/supabase";
import { registrarMovimientoComercial, type TipoCargoComercial } from "@/lib/cuentaComercialMarca";
import { abonoDelPeriodo, avisarCanon } from "@/lib/abonoMarcas";
import { fechaHoraArgentina } from "@/lib/horarios";

function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

function responder(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return responder({ error: "No autorizado" }, 401);
  }

  const supabase = getSupabaseServerClient();
  // La fecha de Argentina (corre a las 9 UTC, las 6 de acá: el mismo día, pero así no depende de eso).
  const hoyISO = fechaHoraArgentina().fecha;
  const diaHoy = Number(hoyISO.slice(8, 10));
  const mesHoy = Number(hoyISO.slice(5, 7));
  const periodoMensual = hoyISO.slice(0, 7);
  const periodoAnual = hoyISO.slice(0, 4);

  const generados: string[] = [];
  const errores: string[] = [];

  const { data: cfgIva } = await supabase.from("configuracion").select("valor").eq("parametro", "IVA_GENERAL_PORCENTAJE").maybeSingle();
  const ivaGeneral = Number(cfgIva?.valor ?? 21);

  const { data: recurrentes } = await supabase.from("cargos_recurrentes_marca").select("*").eq("activo", true);
  for (const r of recurrentes ?? []) {
    const periodo = r.recurrencia === "ANUAL" ? periodoAnual : periodoMensual;
    if (r.ultimo_periodo_cargado === periodo) continue;
    const corresponde = r.recurrencia === "ANUAL" ? r.mes_anual === mesHoy && diaHoy >= r.dia_mes : diaHoy >= r.dia_mes;
    if (!corresponde) continue;

    try {
      // El canon (20/11): el primer mes es proporcional desde `desde` (sql/abono-marcas.sql);
      // antes de `desde`, nada. El concepto dice de qué mes es: «Canon de noviembre (del 15 al 30…)».
      const desde = (r.desde as string | null | undefined) ?? null;
      const canon = r.recurrencia === "MENSUAL" ? abonoDelPeriodo(Number(r.monto_estimado), periodo, desde) : null;
      if (r.recurrencia === "MENSUAL" && !canon) continue;
      const neto = canon ? canon.neto : (r.monto_estimado as number);
      const iva = r.lleva_iva ? redondear2(neto * (ivaGeneral / 100)) : 0;
      const importe = redondear2(neto + iva);
      await registrarMovimientoComercial(supabase, {
        idMarca: r.id_marca as string,
        tipoCargo: "CARGO_RECURRENTE" as TipoCargoComercial,
        importe,
        neto,
        iva,
        periodo,
        idCategoria: r.id_categoria as string,
        idSubcategoria: r.id_subcategoria as string | null,
        usuario: "Automático (cron mensual)",
        observaciones: canon && desde ? canon.concepto : (r.descripcion as string),
      });
      await supabase.from("cargos_recurrentes_marca").update({ ultimo_periodo_cargado: periodo }).eq("id_recurrente", r.id_recurrente);
      generados.push(`Cargo recurrente: ${r.descripcion}`);
    } catch (err) {
      errores.push(`Cargo recurrente ${r.id_recurrente}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Los mails del canon: el 1.º («ya se puede pagar») y el día antes de que venza.
  const mails = await avisarCanon(supabase, hoyISO);

  console.log("Cron cargos recurrentes:", { generados, errores, mails });
  return responder({ ok: true, generados, errores, mails });
}
