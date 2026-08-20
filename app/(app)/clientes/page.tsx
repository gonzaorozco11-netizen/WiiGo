import { getSupabaseServerClient, type Cliente } from "@/lib/supabase";
import ClientesApp from "@/components/ClientesApp";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase.from("clientes").select("*").order("nombre", { ascending: true });

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los clientes</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  return <ClientesApp initialClientes={(data ?? []) as Cliente[]} />;
}
