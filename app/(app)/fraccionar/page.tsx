import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import FraccionarApp from "@/components/FraccionarApp";
import { asegurarGraneles } from "@/lib/granel";
import { datosFraccionar, localDeSesion } from "@/lib/fraccionado";

export const dynamic = "force-dynamic";

// Fraccionar: pasar el granel (en el depósito, en gramos) a bolsitas.
export default async function FraccionarPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !puedeVerPantalla(sesion, "fraccionar")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  await asegurarGraneles(supabase).catch(() => 0);
  const idLocal = await localDeSesion(supabase, sesion.idUsuario);
  if (!idLocal) {
    return <p className="max-w-md mx-auto text-center py-12 text-neutral-700">Tu usuario no tiene un local asignado. Pedile a Gonzalo que lo vincule en Organización.</p>;
  }
  const datos = await datosFraccionar(supabase, idLocal);
  if (!datos) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-1">Falta crear las tablas del granel</p>
        <p className="text-sm text-neutral-500">Corré sql/granel-fraccionado.sql en el SQL Editor de Supabase.</p>
      </div>
    );
  }
  return <FraccionarApp {...datos} esAdmin={sesion.rol === "admin"} />;
}
