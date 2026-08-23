import { getSupabaseServerClient, type Marca, type Objetivo } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ProfesionalesApp from "@/components/ProfesionalesApp";

export const dynamic = "force-dynamic";

export default async function ProfesionalesPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "profesionales")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const [{ data: marcas }, { data: objetivos }] = await Promise.all([
    supabase.from("marcas").select("*").eq("estado", "ACTIVA").order("nombre"),
    supabase.from("objetivos").select("*").eq("estado", "ACTIVO").order("orden", { ascending: true }),
  ]);

  return <ProfesionalesApp marcas={(marcas ?? []) as Marca[]} objetivosGlobales={(objetivos ?? []) as Objetivo[]} />;
}
