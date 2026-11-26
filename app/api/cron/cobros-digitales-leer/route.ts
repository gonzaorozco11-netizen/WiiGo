// Cobros digitales, segunda corrida de la mañana (6:40 de Argentina, 9:40 UTC):
// solo lee el reporte que pidió la de las 6:00 (app/api/cron/cobros-digitales),
// sin pedir otro.
import { getSupabaseServerClient } from "@/lib/supabase";
import { sincronizarMp } from "@/lib/cobrosDigitales";
import { sincronizarNave } from "@/lib/naveCobros";

export const maxDuration = 60;

function responder(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return responder({ error: "No autorizado" }, 401);
  try {
    const supabase = getSupabaseServerClient();
    const r = await sincronizarMp(supabase, { pedir: false });
    // Lo que descontó Nave en los cobros de la tienda online y del posnet conectado (26/11).
    const nave = await sincronizarNave(supabase).catch((e) => ({ guardados: 0, esperando: 0, errores: [(e as Error).message] }));
    console.log("Cron cobros digitales (leer):", r, "Nave:", nave);
    return responder({ ok: true, ...r, nave });
  } catch (e) {
    console.error("Cron cobros digitales (leer):", e);
    return responder({ ok: false, error: (e as Error).message });
  }
}
