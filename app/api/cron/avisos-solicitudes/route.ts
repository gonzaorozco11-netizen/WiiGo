// Las respuestas a las solicitudes de las marcas, juntas en un solo mail por
// marca (17/11). Corre cada 10 minutos; si no hay nada nuevo no manda nada.
// Ver avisarSolicitudesAgrupadas en lib/avisosEnviar.ts.
import { avisarSolicitudesAgrupadas } from "@/lib/avisosEnviar";

export const maxDuration = 60;

function responder(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return responder({ error: "No autorizado" }, 401);
  try {
    const r = await avisarSolicitudesAgrupadas();
    return responder({ ok: true, ...r });
  } catch (e) {
    console.error("Cron avisos de solicitudes:", e);
    return responder({ ok: false, error: (e as Error).message });
  }
}
