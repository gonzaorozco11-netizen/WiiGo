import { getSupabaseServerClient, type Local, type Usuario, type Rol } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import OrganizacionApp from "@/components/OrganizacionApp";

export const dynamic = "force-dynamic";

export default async function OrganizacionPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "organizacion")) return <PantallaBloqueada />;

  const esAdmin = sesion?.rol === "admin";
  const supabase = getSupabaseServerClient();

  const [localesRes, usuariosRes, rolesRes] = await Promise.all([
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    // La gestión de usuarios sigue siendo estrictamente admin-only, no
    // delegable como el resto de esta pantalla (ver Usuarios → Permisos).
    esAdmin
      ? supabase.from("usuarios").select("id_usuario, nombre, email, rol, estado, fecha_alta, permisos, id_rol").order("nombre", { ascending: true })
      : Promise.resolve({ data: null }),
    esAdmin ? supabase.from("roles").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }) : Promise.resolve({ data: null }),
  ]);

  return (
    <OrganizacionApp
      locales={(localesRes.data ?? []) as Local[]}
      esAdmin={esAdmin}
      usuarios={(usuariosRes.data ?? []) as Omit<Usuario, "password_hash">[]}
      roles={(rolesRes.data ?? []) as Rol[]}
    />
  );
}
