import { getSupabaseServerClient, type Marca } from "@/lib/supabase";
import LiquidacionesApp from "@/components/LiquidacionesApp";

export const dynamic = "force-dynamic";

export default async function LiquidacionesPage() {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("marcas")
    .select("*")
    .eq("tipo_comercializacion", "CONSIGNACION")
    .order("nombre", { ascending: true });

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar las marcas</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  if ((data ?? []).length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">No hay marcas en consignación</p>
        <p className="text-sm text-neutral-500">
          Las liquidaciones son solo para marcas externas — marcá al menos una como "Consignación" en su ficha.
        </p>
      </div>
    );
  }

  return <LiquidacionesApp marcas={(data ?? []) as Marca[]} />;
}
