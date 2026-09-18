import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { listarHorarios } from "@/app/(app)/organizacion/actions";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import RrhhApp, { type VistaRrhh } from "@/components/RrhhApp";

// Los datos que necesitan las tres pantallas de RR.HH.
//
// Se cargan igual para las tres a propósito: son tres consultas chicas sobre
// tablas de pocas filas, y tener una carga distinta por pantalla sería tres
// lugares donde equivocarse para ahorrar milisegundos.
export default async function PantallaRrhh({ vista }: { vista: VistaRrhh }) {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const [{ data: usuarios }, horarios, { data: personas }] = await Promise.all([
    supabase
      .from("usuarios")
      .select("id_usuario, nombre, sueldo_base")
      .eq("estado", "ACTIVO")
      .order("nombre", { ascending: true }),
    listarHorarios(),
    supabase
      .from("personas")
      .select("id_persona, nombre, apellido")
      .eq("estado", "ACTIVO")
      .order("nombre", { ascending: true }),
  ]);

  return <RrhhApp vista={vista} usuarios={usuarios ?? []} horariosIniciales={horarios} personas={personas ?? []} />;
}
