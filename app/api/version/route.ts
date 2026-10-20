import { versionActual } from "@/lib/version";

export const dynamic = "force-dynamic";

// El totem pregunta acá cada pocos minutos qué versión está publicada. Es una
// URL fija (no un Server Action) por la misma razón que estado-pedido: la
// página del totem queda abierta días enteros y tiene que poder preguntar
// aunque haya habido deploys en el medio. No devuelve nada sensible.
export async function GET() {
  return Response.json(
    { version: versionActual() },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
