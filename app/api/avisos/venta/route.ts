// Los avisos de una venta, en su propio pedido.
//
// La pantalla la llama apenas la venta quedó cerrada, y no espera la
// respuesta. Así el cajero no espera por un mail, y —esto es lo importante—
// el trabajo no corre colgado de una respuesta que ya se fue: tiene su propio
// pedido y su propio presupuesto de tiempo, así que nada lo corta por la
// mitad. Ver el encabezado de lib/avisosEnviar.ts: los dos intentos
// anteriores perdían mails justamente por eso.
//
// /api es público en el proxy porque ahí viven los webhooks (Mercado Pago
// llega sin cookie). Esta ruta NO es un webhook, así que se fija ella misma
// que haya sesión. Sin eso, cualquiera podría hacer que le lleguen mails a
// las marcas.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase";
import { avisarVenta } from "@/lib/avisosEnviar";

export async function POST(req: Request) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return NextResponse.json({ ok: false }, { status: 500 });

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await readSessionToken(token, secret))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let idVenta = "";
  try {
    const cuerpo = (await req.json()) as { idVenta?: unknown };
    idVenta = typeof cuerpo.idVenta === "string" ? cuerpo.idVenta : "";
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!idVenta) return NextResponse.json({ ok: false }, { status: 400 });

  // El local sale de la venta y no del cuerpo del pedido: así la pantalla no
  // puede pedir avisos de una venta con el local de otra.
  const supabase = getSupabaseServerClient();
  const { data: venta } = await supabase
    .from("ventas")
    .select("id_venta, id_local, estado")
    .eq("id_venta", idVenta)
    .maybeSingle();

  // Solo una venta cobrada manda avisos. Un pedido pendiente o cancelado no
  // vendió nada todavía.
  if (!venta || venta.estado !== "PAGADA") return NextResponse.json({ ok: false }, { status: 404 });

  await avisarVenta(idVenta, venta.id_local as string);
  return NextResponse.json({ ok: true });
}
