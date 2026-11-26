// Lo que Nave informa de un pago, tal cual (solo el dueño). Para ver con datos reales
// la comisión, las retenciones y el neto antes de usarlos en las liquidaciones (26/11).
//   /api/nave/pago?pedido=1021   → el pago de un pedido de la tienda online
//   /api/nave/pago?id=<payment_id>
//
// /api es público en el proxy: la ruta se fija sola que sea un admin.
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas } from "@/lib/roles";
import { consultarPagoNave } from "@/lib/nave";

export async function GET(req: Request) {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || sesion.rol !== "admin") return NextResponse.json({ error: "Solo administración." }, { status: 401 });

  const url = new URL(req.url);
  let id = url.searchParams.get("id")?.trim() || "";
  const pedido = Number(url.searchParams.get("pedido"));
  if (!id && pedido > 0) {
    const { data } = await getSupabaseServerClient().from("pedidos_online").select("nave_pago_id").eq("numero", pedido).maybeSingle();
    id = (data?.nave_pago_id as string | null) ?? "";
    if (!id) return NextResponse.json({ error: `El pedido #${pedido} no tiene pago de Nave.` }, { status: 404 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Falta ?pedido=N o ?id=<payment_id>." }, { status: 400 });

  try {
    const r = await consultarPagoNave(id);
    return NextResponse.json({ estado: r.estado, forma: r.forma, pago: r.datos }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error consultando a Nave" }, { status: 502 });
  }
}
