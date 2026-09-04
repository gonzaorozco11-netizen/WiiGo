import { obtenerSesionMarca } from "@/lib/marcaSesion";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerPolitica } from "@/lib/solicitudesMarca";
import { misProductos, misSolicitudes } from "@/app/portal/cambios/actions";
import PortalCambios from "@/components/PortalCambios";

export const dynamic = "force-dynamic";

export default async function PortalCambiosPage() {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return <p className="vacio">No se pudo cargar la pantalla. Probá recargar.</p>;

  const supabase = getSupabaseServerClient();
  // La política se le muestra a la marca antes de que pida nada: si sabe de
  // entrada hasta dónde puede llegar un descuento, no manda uno que va a
  // volver rechazado.
  const [productos, solicitudes, politica] = await Promise.all([
    misProductos(),
    misSolicitudes(),
    obtenerPolitica(supabase),
  ]);

  return <PortalCambios productos={productos} solicitudes={solicitudes} politica={politica} />;
}
