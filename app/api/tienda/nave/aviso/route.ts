import { getSupabaseServerClient } from "@/lib/supabase";
import { secretoValido } from "@/lib/nave";
import { registrarPagoTarjeta } from "@/lib/pagoTarjetaOnline";

/**
 * Aviso de Nave: «hubo un pago» de un pedido de la tienda (lib/nave.ts).
 * POST /api/tienda/nave/aviso?pedido=<id>&s=<secreto>  body: { payment_id, payment_check_url }
 *
 * Nave no firma el aviso: se valida con el secreto de la URL (sale del pedido y de
 * AUTH_SECRET) y, sobre todo, se le pregunta a Nave por ese pago antes de dar el
 * pedido por pagado (lib/pagoTarjetaOnline.ts). Siempre contesta 200 a lo que
 * no es un error de Nave, así no reintenta en vano.
 */
export const dynamic = "force-dynamic";

const ok = (cuerpo: Record<string, unknown> = { ok: true }, status = 200) => Response.json(cuerpo, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const url = new URL(req.url);
  const idPedido = url.searchParams.get("pedido") ?? "";
  const secreto = url.searchParams.get("s") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(idPedido) || !secreto) return ok({ error: "missing_params" }, 400);
  if (!secretoValido(idPedido, secreto)) return ok({ error: "invalid_secret" }, 401);

  let cuerpo: Record<string, unknown> = {};
  try {
    cuerpo = (await req.json()) as Record<string, unknown>;
  } catch {
    return ok({ error: "invalid_payload" }, 400);
  }
  const idPago = String(cuerpo.payment_id ?? "").trim();
  if (!idPago || idPago.length > 100) return ok({ error: "invalid_payload" }, 400);

  try {
    const r = await registrarPagoTarjeta(getSupabaseServerClient(), idPedido, idPago);
    return ok({ ok: true, estado: r.estado });
  } catch (e) {
    console.error("[nave/aviso]", idPedido, idPago, e);
    // 500: que Nave vuelva a avisar más tarde.
    return ok({ error: "retry" }, 500);
  }
}
