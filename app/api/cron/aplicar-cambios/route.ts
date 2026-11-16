// Aplica los cambios de precio aprobados que ya llegaron a su hora.
//
// Los precios entran al final de cada turno (ETIQUETA_HORA_APLICACION, hoy
// 13:00 y 21:00). Este proceso corre a las 23:30 de Argentina (02:30 UTC) y
// sus copias aplicar-cambios-13 y aplicar-cambios-21 después de cada turno.
// Son el respaldo: lo normal es que entren antes, cuando alguien ficha la
// salida o abre la caja o Carteles pasada la hora (lib/preciosAlDia.ts).
import { aplicarCambiosProgramados } from "@/app/(app)/aprobaciones/actions";
import { getSupabaseServerClient } from "@/lib/supabase";
import { vencerPedidosOnline } from "@/lib/pedidosOnline";

function responder(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return responder({ error: "No autorizado" }, 401);
  }

  const { aplicadas, errores } = await aplicarCambiosProgramados();

  // De paso (sin otro cron, por el plan de Vercel): los pedidos online que
  // vencieron sin pagar se cancelan y al cliente le llega el mail. La copia
  // de las 21:05 es la que los agarra justo a la hora (lib/pedidosOnline.ts).
  const pedidosVencidos = await vencerPedidosOnline(getSupabaseServerClient()).catch(() => 0);

  console.log("Cron aplicar cambios:", { aplicadas, errores, pedidosVencidos });
  return responder({ ok: true, aplicadas, errores, pedidosVencidos });
}
