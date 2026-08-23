import { getSupabaseServerClient, type Local } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import OrganizacionApp from "@/components/OrganizacionApp";

export const dynamic = "force-dynamic";

export default async function OrganizacionPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "organizacion")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const { data: locales } = await supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true });

  return <OrganizacionApp locales={(locales ?? []) as Local[]} />;
}
