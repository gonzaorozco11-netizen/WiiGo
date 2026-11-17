// Cobros digitales, segunda corrida de la mañana (6:40 de Argentina, 9:40 UTC):
// solo lee el reporte que pidió la de las 6:00 (app/api/cron/cobros-digitales),
// sin pedir otro.
import { getSupabaseServerClient } from "@/lib/supabase";
import { sincronizarMp } from "@/lib/cobrosDigitales";

export const maxDuration = 60;

function responder(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return responder({ error: "No autorizado" }, 401);
  try {
    const r = await sincronizarMp(getSupabaseServerClient(), { pedir: false });
    console.log("Cron cobros digitales (leer):", r);
    return responder({ ok: true, ...r });
  } catch (e) {
    console.error("Cron cobros digitales (leer):", e);
    return responder({ ok: false, error: (e as Error).message });
  }
}
