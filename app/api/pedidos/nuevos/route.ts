// Cuántos pedidos de profesionales hay sin armar, y de quién es el último.
// Lo consulta cada 30 segundos el aviso del sistema interno (AvisoPedidos).
//
// /api es público en el proxy, así que esta ruta se fija sola que sea alguien
// del equipo con la pantalla Pedidos.
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { esRolInterno } from "@/lib/rolesInternos";

export async function GET() {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !esRolInterno(sesion.rol) || !puedeVerPantalla(sesion, "pedidos")) {
    return NextResponse.json({ nuevos: 0, de: null }, { status: 401 });
  }
  const supabase = getSupabaseServerClient();
  const { data, count, error } = await supabase
    .from("pedidos_profesional")
    .select("id_profesional", { count: "exact" })
    .eq("estado", "NUEVO")
    .order("creado", { ascending: false })
    .limit(1);
  if (error) return NextResponse.json({ nuevos: 0, de: null });

  let de: string | null = null;
  const idUltima = data?.[0]?.id_profesional as string | undefined;
  if (idUltima) {
    const { data: p } = await supabase.from("profesionales").select("nombre, apellido").eq("id_profesional", idUltima).maybeSingle();
    de = p ? [p.nombre, p.apellido].filter(Boolean).join(" ") : null;
  }
  return NextResponse.json({ nuevos: count ?? 0, de }, { headers: { "Cache-Control": "no-store" } });
}
