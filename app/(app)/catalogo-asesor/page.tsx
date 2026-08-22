import { getSupabaseServerClient, type Objetivo, type FiltroProducto } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import CatalogoAsesorApp from "@/components/CatalogoAsesorApp";

export const dynamic = "force-dynamic";

export default async function CatalogoAsesorPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "catalogo-asesor")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();

  const [objetivosRes, filtrosRes] = await Promise.all([
    supabase.from("objetivos").select("*").order("orden", { ascending: true }),
    supabase.from("filtros_producto").select("*").order("orden", { ascending: true }),
  ]);

  const error = objetivosRes.error || filtrosRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudo cargar el catálogo asesor</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  return (
    <CatalogoAsesorApp
      initialObjetivos={(objetivosRes.data ?? []) as Objetivo[]}
      initialFiltros={(filtrosRes.data ?? []) as FiltroProducto[]}
    />
  );
}
