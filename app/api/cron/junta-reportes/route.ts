// Reportes de la Junta.
//
// Corre una vez por día a las 6 de la mañana de Argentina (09:00 UTC, ver
// vercel.json; en el plan gratis de Vercel puede salir en cualquier momento de
// esa hora). Todos los días arma el diario (cómo fue ayer); los lunes, además,
// el semanal (cómo fue la semana y qué harían). Si ya estaba hecho, no lo
// repite.
import { getSupabaseServerClient } from "@/lib/supabase";
import { fechaHoraArgentina } from "@/lib/horarios";
import { hayClaveIA } from "@/lib/ia";
import { datosDelNegocio } from "@/lib/junta";
import { generarReporte, type TipoReporte } from "@/lib/juntaReportes";

export const maxDuration = 120;

function responder(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return responder({ error: "No autorizado" }, 401);
  }
  if (!hayClaveIA()) return responder({ ok: false, error: "Falta ANTHROPIC_API_KEY." });

  const supabase = getSupabaseServerClient();
  const tipos: TipoReporte[] = fechaHoraArgentina().diaSemanaISO === 1 ? ["SEMANAL", "DIARIO"] : ["DIARIO"];
  const contexto = await datosDelNegocio();
  const base = process.env.APP_URL ?? "";
  const resultados: Record<string, string> = {};
  for (const tipo of tipos) {
    try {
      resultados[tipo] = (await generarReporte(supabase, tipo, { contexto, base })).mensaje;
    } catch (e) {
      resultados[tipo] = e instanceof Error ? e.message : String(e);
    }
  }
  console.log("Cron reportes de la Junta:", resultados);
  return responder({ ok: true, resultados });
}
