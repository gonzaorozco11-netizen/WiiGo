import { NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// El totem pregunta cada pocos segundos si su pedido ya se pagó. A propósito
// esto es un endpoint con URL fija y NO un Server Action: los Server Actions
// se identifican con un id que cambia en cada deploy, y el totem tiene la
// página abierta durante días — después de subir una versión nueva, sus
// consultas apuntaban a un id que ya no existía y fallaban en silencio,
// dejando al cliente esperando para siempre. Una URL fija sobrevive a los
// deploys.
//
// No lleva autenticación (igual que el resto del self-checkout, que es
// público): solo devuelve el estado de un pedido si ya se conoce su UUID,
// que es justamente el que el propio totem acaba de crear.
export async function GET(request: NextRequest) {
  const idVenta = request.nextUrl.searchParams.get("idVenta");
  if (!idVenta) {
    return Response.json({ error: "Falta el pedido" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("ventas")
    .select("estado, numero, total")
    .eq("id_venta", idVenta)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "No se encontró el pedido" }, { status: 404 });

  return Response.json({ estado: data.estado, numero: data.numero, total: data.total });
}
