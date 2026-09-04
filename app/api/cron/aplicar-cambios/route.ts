// Aplica los cambios de precio aprobados que ya llegaron a su hora.
//
// Corre una vez por día a las 23:30 de Argentina (ver vercel.json: la
// programación de Vercel es en UTC, y Argentina es UTC-3, así que va a las
// 02:30 UTC). Es el paso que hace que un precio aprobado a las 10 de la
// mañana recién cambie de noche, con el local cerrado — las etiquetas se
// cambian al cierre y el sistema entra después, así nunca hay una venta con
// el cartel diciendo una cosa y la caja cobrando otra.
//
// El horario del cron es lo que limita ETIQUETA_HORA_APLICACION: no se puede
// programar un cambio para una hora que este proceso no llega a cubrir (ver
// la validación en configuracion/actions.ts).
import { aplicarCambiosProgramados } from "@/app/(app)/aprobaciones/actions";

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

  console.log("Cron aplicar cambios:", { aplicadas, errores });
  return responder({ ok: true, aplicadas, errores });
}
