import { getSupabaseServerClient, type Local } from "@/lib/supabase";
import LocalesApp from "@/components/LocalesApp";

export const dynamic = "force-dynamic";

export default async function LocalesPage() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("locales").select("*").order("nombre", { ascending: true });

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los locales</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  return <LocalesApp initialLocales={(data ?? []) as Local[]} />;
}
