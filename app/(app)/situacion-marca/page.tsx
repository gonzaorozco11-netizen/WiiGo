import { getSupabaseServerClient, type Marca, type Local } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import SituacionMarcaApp from "@/components/SituacionMarcaApp";

export const dynamic = "force-dynamic";

export default async function SituacionMarcaPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "situacion-marca")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();

  const [marcasRes, localesRes] = await Promise.all([
    supabase.from("marcas").select("*").eq("tipo_comercializacion", "CONSIGNACION").order("nombre", { ascending: true }),
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
  ]);

  if (marcasRes.error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar las marcas</p>
        <p className="text-sm text-neutral-500">{marcasRes.error.message}</p>
      </div>
    );
  }

  if ((marcasRes.data ?? []).length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">No hay marcas en consignación</p>
        <p className="text-sm text-neutral-500">
          Esta pantalla es para marcas externas — marcá al menos una como "Consignación" en su ficha.
        </p>
      </div>
    );
  }

  return <SituacionMarcaApp marcas={(marcasRes.data ?? []) as Marca[]} locales={(localesRes.data ?? []) as Local[]} />;
}
