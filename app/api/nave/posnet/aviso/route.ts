/**
 * Aviso de Nave para los cobros del posnet (Nave Point) — la «Notification URL»
 * que se cargó en el alta de la integración presencial (Gonzalo, 19/11).
 *
 * Desde el 24/11 cierra la venta de la caja: el aviso solo dice «andá a fijarte»;
 * se le pregunta a Nave por el pago (lib/navePosnet.ts) y recién ahí se cierra.
 * Un aviso falso solo puede hacer que revisemos. Siempre se contesta 200, así
 * Nave no reintenta (si algo falló, la caja vuelve a preguntar sola).
 *
 * El parámetro ?entorno de la dirección ya no se usa: cada posnet dice en
 * Configuración si es de prueba, y se le pregunta al servidor que corresponde.
 */
import { getSupabaseServerClient } from "@/lib/supabase";
import { revisarCobroPosnet, ventaDelAvisoPosnet } from "@/lib/navePosnet";
import { avisarVenta } from "@/lib/avisosEnviar";

export const dynamic = "force-dynamic";

const ok = (cuerpo: Record<string, unknown> = { ok: true }) => Response.json(cuerpo, { headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const texto = await req.text().catch(() => "");
  console.log("[nave/posnet/aviso]", texto.slice(0, 1000));
  let aviso: Record<string, unknown> = {};
  try {
    aviso = JSON.parse(texto);
  } catch {
    return ok({ ok: true, ignorado: "no_json" });
  }

  try {
    const supabase = getSupabaseServerClient();
    const venta = await ventaDelAvisoPosnet(supabase, aviso);
    if (!venta) return ok({ ok: true, ignorado: "sin_venta" });
    const estado = await revisarCobroPosnet(supabase, venta.idVenta);
    // Los avisos a las marcas salen de quien cerró la venta: si la cerró este aviso, de acá
    // (la caja los manda solo cuando la cierra ella). Igual que el webhook de Mercado Pago.
    if (estado.estado === "PAGADO" && estado.confirmadoAhora && venta.idLocal) await avisarVenta(venta.idVenta, venta.idLocal);
    return ok({ ok: true, estado: estado.estado });
  } catch (e) {
    console.error("[nave/posnet/aviso] error", e);
    return ok({ ok: true, error: true });
  }
}

// Algunos servicios prueban la dirección con un GET antes de guardarla.
export async function GET() {
  return ok({ ok: true, servicio: "aviso posnet" });
}
