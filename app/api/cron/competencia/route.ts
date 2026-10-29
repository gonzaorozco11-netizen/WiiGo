// Lee los precios de la competencia de Mendoza cada lunes a las 8:00 de
// Argentina (11:00 UTC, ver vercel.json): Bela Vita, Regio, Mardegan y Jumbo
// Mendoza. Ver lib/competenciaLeer.ts.
import { getSupabaseServerClient } from "@/lib/supabase";
import { actualizarCompetencia } from "@/lib/competenciaLeer";

// Son 4 páginas y la de Jumbo es una búsqueda por producto: necesita más que los 10 s de siempre.
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const r = await actualizarCompetencia(getSupabaseServerClient());
  console.log("Cron competencia:", JSON.stringify(r));
  return new Response(JSON.stringify({ ok: true, ...r }), { headers: { "content-type": "application/json" } });
}
