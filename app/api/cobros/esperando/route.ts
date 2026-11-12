// Cuántos clientes del tótem esperan para pagar en efectivo. Lo consulta
// cada 10 segundos el aviso del sistema interno (AvisoCobros).
//
// /api es público en el proxy, así que esta ruta se fija sola que sea alguien
// del equipo con la pantalla Cobros en efectivo. A quien no está trabajando
// (no fichó, o ya se fue) le contesta 0: no le suena en la casa.
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { esRolInterno } from "@/lib/rolesInternos";
import { cobrosEsperando, estaTrabajando, NADIE_ESPERANDO as NADA } from "@/lib/cobrosEsperando";

export async function GET() {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !esRolInterno(sesion.rol) || !puedeVerPantalla(sesion, "cobros-efectivo")) {
    return NextResponse.json(NADA, { status: 401 });
  }
  const supabase = getSupabaseServerClient();
  if (!(await estaTrabajando(supabase, sesion.idUsuario))) return NextResponse.json(NADA, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(await cobrosEsperando(supabase), { headers: { "Cache-Control": "no-store" } });
}
