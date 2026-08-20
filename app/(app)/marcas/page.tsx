import { getSupabaseServerClient, type Marca } from "@/lib/supabase";
import MarcasApp from "@/components/MarcasApp";

export const dynamic = "force-dynamic";

export default async function MarcasPage() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("marcas")
    .select("*")
    .order("nombre", { ascending: true });

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar las marcas</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  return <MarcasApp initialMarcas={(data ?? []) as Marca[]} />;
}
