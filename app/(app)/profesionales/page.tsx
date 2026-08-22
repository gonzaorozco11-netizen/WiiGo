import { getSupabaseServerClient, type Marca } from "@/lib/supabase";
import ProfesionalesApp from "@/components/ProfesionalesApp";

export const dynamic = "force-dynamic";

export default async function ProfesionalesPage() {
  const supabase = getSupabaseServerClient();
  const { data: marcas } = await supabase.from("marcas").select("*").eq("estado", "ACTIVA").order("nombre");

  return <ProfesionalesApp marcas={(marcas ?? []) as Marca[]} />;
}
