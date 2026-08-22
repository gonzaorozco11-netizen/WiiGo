import { getSupabaseServerClient, type Marca } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import RentabilidadApp from "@/components/RentabilidadApp";

export const dynamic = "force-dynamic";

export default async function RentabilidadPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "rentabilidad")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("marcas")
    .select("*")
    .eq("tipo_comercializacion", "PROPIA")
    .order("nombre", { ascending: true });

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar las marcas</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  return <RentabilidadApp marcas={(data ?? []) as Marca[]} />;
}
