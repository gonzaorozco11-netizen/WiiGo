import { getSupabaseServerClient, type Marca } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ProfesionalesApp from "@/components/ProfesionalesApp";

export const dynamic = "force-dynamic";

export default async function ProfesionalesPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "profesionales")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const { data: marcas } = await supabase.from("marcas").select("*").eq("estado", "ACTIVA").order("nombre");

  return <ProfesionalesApp marcas={(marcas ?? []) as Marca[]} />;
}
