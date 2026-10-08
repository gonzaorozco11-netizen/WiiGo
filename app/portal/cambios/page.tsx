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
  const [productos, solicitudes, politica, { data: subcategorias }] = await Promise.all([
    misProductos(),
    misSolicitudes(),
    obtenerPolitica(supabase),
    supabase
      .from("subcategorias")
      .select("id_subcategoria, nombre")
      .eq("id_marca", sesion.idMarca)
      .order("nombre", { ascending: true }),
  ]);

  return (
    <PortalCambios
      productos={productos}
      solicitudes={solicitudes}
      politica={politica}
      subcategorias={(subcategorias ?? []).map((s) => ({
        id: s.id_subcategoria as string,
        nombre: s.nombre as string,
      }))}
    />
  );
}
