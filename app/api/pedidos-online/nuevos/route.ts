// Cuántos pedidos de la tienda online esperan que alguien los atienda (paso 1).
// Lo consulta cada 30 segundos el aviso del sistema interno (AvisoPedidosOnline).
//
// /api es público en el proxy, así que esta ruta se fija sola que sea alguien
// del equipo con la pantalla. A quien no está trabajando (no fichó, o ya se
// fue) le contesta 0: no le suena en la casa.
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { esRolInterno } from "@/lib/rolesInternos";
import { estaTrabajando } from "@/lib/cobrosEsperando";

const NADA = { n: 0, numero: null, total: 0, de: null };

export async function GET() {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !esRolInterno(sesion.rol) || !(puedeVerPantalla(sesion, "pedidos-online") || puedeVerPantalla(sesion, "pedidos"))) {
    return NextResponse.json(NADA, { status: 401 });
  }
  const supabase = getSupabaseServerClient();
  if (!(await estaTrabajando(supabase, sesion.idUsuario))) return NextResponse.json(NADA, { headers: { "Cache-Control": "no-store" } });
  const { data, count, error } = await supabase
    .from("pedidos_online")
    .select("numero, nombre, total_lista", { count: "exact" })
    .eq("estado", "NUEVO")
    .order("creado", { ascending: false })
    .limit(1);
  if (error || !count) return NextResponse.json(NADA, { headers: { "Cache-Control": "no-store" } });
  const ultimo = data?.[0];
  return NextResponse.json(
    { n: count, numero: Number(ultimo?.numero ?? 0) || null, total: Number(ultimo?.total_lista ?? 0), de: (ultimo?.nombre as string | null) ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
