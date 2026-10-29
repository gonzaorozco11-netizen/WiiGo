// Se fija cada mañana si Alifrut cambió algo en su catálogo (8:00 de
// Argentina, 11:00 UTC: ver vercel.json).
//
// Los precios de WiiGo son exclusivos y solo se ven con el usuario de
// Gonzalo, así que de acá no salen precios: Alifrut publica una "huella" de su
// catálogo (/api/catalogo-al-dia) que cambia cuando cambia algo. Si cambió, en
// Precios aparece "Alifrut actualizó su lista: traé tus precios". Cuando
// Alifrut pase un link privado con la lista, este es el lugar para traerla
// sola.
import { getSupabaseServerClient } from "@/lib/supabase";
import { CLAVES_ALIFRUT } from "@/lib/catalogoProveedor";

function responder(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return responder({ error: "No autorizado" }, 401);

  let huella: string | null = null;
  try {
    const r = await fetch("https://www.alifrut-distribuidora.com.ar/api/catalogo-al-dia", { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const j = (await r.json()) as { huella?: unknown };
    huella = typeof j.huella === "string" && j.huella ? j.huella : null;
  } catch {
    // Si Alifrut no contesta, mañana se prueba de nuevo.
  }
  if (!huella) return responder({ ok: false, motivo: "Alifrut no devolvió la huella" });

  const supabase = getSupabaseServerClient();
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", CLAVES_ALIFRUT.huella).maybeSingle();
  const anterior = (data?.valor as string | null) ?? null;
  if (anterior === huella) return responder({ ok: true, cambio: false });

  const ahora = new Date().toISOString();
  const filas: { parametro: string; valor: string; fecha_actualizacion: string }[] = [{ parametro: CLAVES_ALIFRUT.huella, valor: huella, fecha_actualizacion: ahora }];
  // La primera vez solo se guarda: no hay con qué comparar.
  if (anterior) filas.push({ parametro: CLAVES_ALIFRUT.huellaCambioEl, valor: ahora, fecha_actualizacion: ahora });
  await supabase.from("configuracion").upsert(filas, { onConflict: "parametro" });
  console.log("Cron Alifrut:", { cambio: Boolean(anterior) });
  return responder({ ok: true, cambio: Boolean(anterior) });
}
