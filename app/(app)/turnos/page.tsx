import { getSupabaseServerClient, type Local, type Turno } from "@/lib/supabase";
import TurnosApp from "@/components/TurnosApp";

export const dynamic = "force-dynamic";

export default async function TurnosPage() {
  const supabase = getSupabaseServerClient();

  const [localesRes, turnosAbiertosRes] = await Promise.all([
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase.from("turnos").select("*").eq("estado", "ABIERTO"),
  ]);

  if (localesRes.error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los locales</p>
        <p className="text-sm text-neutral-500">{localesRes.error.message}</p>
      </div>
    );
  }

  if ((localesRes.data ?? []).length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">Todavía no hay locales cargados</p>
        <p className="text-sm text-neutral-500">Andá a la sección "Locales" y creá al menos uno.</p>
      </div>
    );
  }

  return (
    <TurnosApp
      locales={(localesRes.data ?? []) as Local[]}
      turnosAbiertos={(turnosAbiertosRes.data ?? []) as Turno[]}
    />
  );
}
