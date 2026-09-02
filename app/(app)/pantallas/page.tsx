import { getSupabaseServerClient, type Local } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import PantallasApp from "@/components/PantallasApp";
import { baseUrlPublica } from "@/lib/urlPublica";

export const dynamic = "force-dynamic";

export default async function PantallasPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "pantallas")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("locales")
    .select("*")
    .eq("estado", "ACTIVO")
    .order("nombre", { ascending: true });

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los locales</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  // El dominio bueno, no aquel por el que se entró: si alguien abre el
  // sistema por la URL interna de un deploy de Vercel, el totem heredaba esa
  // URL y el QR del comprobante terminaba mandando al cliente a la pantalla
  // de login de Vercel. Ver lib/urlPublica.ts.
  return <PantallasApp locales={(data ?? []) as Local[]} baseUrl={baseUrlPublica()} />;
}
