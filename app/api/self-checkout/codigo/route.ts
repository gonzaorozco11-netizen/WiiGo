import { NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { candidatosCodigo, esMismoCodigo } from "@/lib/codigoBarras";

export const dynamic = "force-dynamic";

// El tótem pregunta acá por un código que no conoce (por ejemplo, uno que se
// corrigió después de que se abrió la pantalla). URL fija y no un Server
// Action, por lo mismo que estado-pedido: el tótem queda abierto días, y
// después de un deploy sus Server Actions ya no existen. Con eso, la
// creatina Body Advance y la L-Arginina, con el código recién corregido, no
// entraban (Gonzalo, 2026-11-12). Público como el resto del self-checkout:
// solo devuelve el id de un producto activo que tenga ese código.
export async function GET(request: NextRequest) {
  const codigo = request.nextUrl.searchParams.get("codigo") ?? "";
  const candidatos = candidatosCodigo(codigo);
  if (candidatos.length === 0) return Response.json({ idVariante: null }, { headers: { "Cache-Control": "no-store" } });

  const supabase = getSupabaseServerClient();
  for (const c of candidatos) {
    const { data } = await supabase.from("variantes_producto").select("id_variante, codigo_barras").eq("estado", "ACTIVO").like("codigo_barras", `%${c}`).limit(10);
    const igual = (data ?? []).find((v) => esMismoCodigo(v.codigo_barras as string | null, codigo));
    if (igual) return Response.json({ idVariante: igual.id_variante }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ idVariante: null }, { headers: { "Cache-Control": "no-store" } });
}
