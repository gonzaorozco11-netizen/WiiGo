// Cobros digitales (17/11): cada noche lee los reportes de Mercado Pago que ya
// estén listos y pide el de los últimos 3 días, que llega en unos minutos y lo
// lee la corrida de las 6:40 (o «Actualizar ahora»). 6:00 de Argentina = 9:00 UTC: ver vercel.json.
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
    // La corrida de las 6:40 (?pedir=0) solo lee el reporte que pidió la de las 6:00.
    const pedir = new URL(req.url).searchParams.get("pedir") !== "0";
    const r = await sincronizarMp(getSupabaseServerClient(), { pedir, dias: 3 });
    console.log("Cron cobros digitales:", r);
    return responder({ ok: true, ...r });
  } catch (e) {
    console.error("Cron cobros digitales:", e);
    return responder({ ok: false, error: (e as Error).message });
  }
}
