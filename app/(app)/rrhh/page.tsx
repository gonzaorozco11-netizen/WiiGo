import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { listarHorarios } from "@/app/(app)/organizacion/actions";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import RrhhApp from "@/components/RrhhApp";

export const dynamic = "force-dynamic";

export default async function RrhhPage() {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const [{ data: usuarios }, horarios, { data: personas }] = await Promise.all([
    supabase.from("usuarios").select("id_usuario, nombre, sueldo_base").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    listarHorarios(),
    supabase.from("personas").select("id_persona, nombre, apellido").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
  ]);

  return <RrhhApp usuarios={usuarios ?? []} horariosIniciales={horarios} personas={personas ?? []} />;
}
