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
import { registrarMovimientoComercial, yaTieneCargoDelPeriodo, type TipoCargoComercial } from "@/lib/cuentaComercialMarca";

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
  const hoy = new Date();
  const diaHoy = hoy.getDate();
  const mesHoy = hoy.getMonth() + 1;
  const periodoMensual = hoy.toISOString().slice(0, 7);
  const periodoAnual = String(hoy.getFullYear());
  const hoyISO = hoy.toISOString().slice(0, 10);

  const generados: string[] = [];
  const errores: string[] = [];

  const { data: cfgIva } = await supabase.from("configuracion").select("valor").eq("parametro", "IVA_GENERAL_PORCENTAJE").maybeSingle();
  const ivaGeneral = Number(cfgIva?.valor ?? 21);

  // ===== Cargos recurrentes a marca (mecanismo nuevo — Gastos e Ingresos) =====
  const { data: recurrentes } = await supabase.from("cargos_recurrentes_marca").select("*").eq("activo", true);
  for (const r of recurrentes ?? []) {
    const periodo = r.recurrencia === "ANUAL" ? periodoAnual : periodoMensual;
    if (r.ultimo_periodo_cargado === periodo) continue;
    const corresponde = r.recurrencia === "ANUAL" ? r.mes_anual === mesHoy && diaHoy >= r.dia_mes : diaHoy >= r.dia_mes;
    if (!corresponde) continue;

    try {
      const neto = r.monto_estimado as number;
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
        observaciones: r.descripcion as string,
      });
      await supabase.from("cargos_recurrentes_marca").update({ ultimo_periodo_cargado: periodo }).eq("id_recurrente", r.id_recurrente);
      generados.push(`Cargo recurrente: ${r.descripcion}`);
    } catch (err) {
      errores.push(`Cargo recurrente ${r.id_recurrente}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== Gasto fijo mensual (mecanismo viejo — Situación de marca, m² × valor) =====
  if (diaHoy === 1) {
    const { data: condiciones } = await supabase
      .from("condiciones_comerciales_marca")
      .select("*")
      .eq("estado", "ACTIVA")
      .lte("fecha_desde", hoyISO)
      .or(`fecha_hasta.is.null,fecha_hasta.gte.${hoyISO}`);

    for (const c of condiciones ?? []) {
      try {
        const yaExiste = await yaTieneCargoDelPeriodo(supabase, c.id_marca as string, "GASTO_FIJO_MENSUAL", periodoMensual);
        if (yaExiste) continue;
        await registrarMovimientoComercial(supabase, {
          idMarca: c.id_marca as string,
          idLocal: c.id_local as string | null,
          tipoCargo: "GASTO_FIJO_MENSUAL",
          importe: c.monto_mensual as number,
          periodo: periodoMensual,
          usuario: "Automático (cron mensual)",
          observaciones: `Gasto fijo mensual de ${periodoMensual}${c.metros_ocupados ? ` (${c.metros_ocupados} m² × $${c.valor_por_m2})` : ""}`,
        });
        generados.push(`Gasto fijo mensual: marca ${c.id_marca}`);
      } catch (err) {
        errores.push(`Gasto fijo mensual marca ${c.id_marca}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log("Cron cargos recurrentes:", { generados, errores });
  return responder({ ok: true, generados, errores });
}
