// Aplica los cambios de precio aprobados que ya llegaron a su hora.
//
// Los precios entran al final de cada turno (ETIQUETA_HORA_APLICACION, hoy
// 13:00 y 21:00). Este proceso corre a las 23:30 de Argentina (02:30 UTC) y
// sus copias aplicar-cambios-13 y aplicar-cambios-21 después de cada turno.
// Son el respaldo: lo normal es que entren antes, cuando alguien ficha la
// salida o abre la caja o Carteles pasada la hora (lib/preciosAlDia.ts).
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
