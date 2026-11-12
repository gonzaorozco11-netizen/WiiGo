import { NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerClimaActual } from "@/lib/clima";

export const dynamic = "force-dynamic";

// El cielo de la pantalla de reposo del tótem: el clima y el amanecer y el
// atardecer de hoy. URL fija y no un Server Action, por lo mismo que
// estado-pedido: el tótem queda abierto días, y después de un deploy su Server
// Action ya no existe y el cielo quedaba clavado (uno de día y el otro de
// noche, Gonzalo 2026-11-12). Público como el resto del self-checkout.
export async function GET(request: NextRequest) {
  const idLocal = request.nextUrl.searchParams.get("local");
  if (!idLocal) return Response.json(null, { status: 400 });
  const supabase = getSupabaseServerClient();
  const { data: local } = await supabase.from("locales").select("latitud, longitud").eq("id_local", idLocal).maybeSingle();
  if (!local) return Response.json(null, { status: 404 });
  const cielo = await obtenerClimaActual((local.latitud as number | null) ?? null, (local.longitud as number | null) ?? null);
  return Response.json(cielo, { headers: { "Cache-Control": "no-store" } });
}
