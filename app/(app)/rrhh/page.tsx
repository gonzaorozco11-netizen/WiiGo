import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import RrhhApp from "@/components/RrhhApp";

export const dynamic = "force-dynamic";

export default async function RrhhPage() {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const { data: usuarios } = await supabase
    .from("usuarios")
    .select("id_usuario, nombre, sueldo_base")
    .eq("estado", "ACTIVO")
    .order("nombre", { ascending: true });

  return <RrhhApp usuarios={usuarios ?? []} />;
}
