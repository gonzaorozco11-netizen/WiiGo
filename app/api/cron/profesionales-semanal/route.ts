// El resumen de los lunes para cada profesional con usuario.
//
// Corre los lunes a las 9 de la mañana de Argentina (12:00 UTC, ver
// vercel.json). Si ya se le mandó el de esta semana, no lo repite.
import { mandarResumenesSemanales } from "@/lib/avisosProfesional";

export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const resultado = await mandarResumenesSemanales();
  console.log("Cron resumen semanal de profesionales:", resultado);
  return new Response(JSON.stringify({ ok: true, ...resultado }), { headers: { "content-type": "application/json" } });
}
