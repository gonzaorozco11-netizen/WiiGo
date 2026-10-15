import { obtenerSesionMarca } from "@/lib/marcaSesion";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerPolitica } from "@/lib/solicitudesMarca";
import { misProductos, misSolicitudes } from "@/app/portal/cambios/actions";
import { condicionesDeMarca, tasasGeneralesParaSimular } from "@/lib/margenMarca";
import PortalCambios from "@/components/PortalCambios";

export const dynamic = "force-dynamic";

export default async function PortalCambiosPage() {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return <p className="vacio">No se pudo cargar la pantalla. Probá recargar.</p>;

  const supabase = getSupabaseServerClient();
  // La política se le muestra a la marca antes de que pida nada: si sabe de
  // entrada hasta dónde puede llegar un descuento, no manda uno que va a
  // volver rechazado.
  const [productos, solicitudes, politica, { data: subcategorias }, condiciones, tasas, { data: cfg }] =
    await Promise.all([
      misProductos(),
      misSolicitudes(),
      obtenerPolitica(supabase),
      supabase
        .from("subcategorias")
        .select("id_subcategoria, nombre")
        .eq("id_marca", sesion.idMarca)
        .order("nombre", { ascending: true }),
      // Para mostrarle el reparto mientras define el precio del producto nuevo:
      // es el mismo cálculo que la liquidación que de verdad le paga.
      condicionesDeMarca(supabase, sesion.idMarca),
      tasasGeneralesParaSimular(supabase),
      // El múltiplo al que se redondea un precio calculado. Estaba solo del
      // lado de WiiGo: la marca calculaba un precio y le quedaba con
      // centavos, que en un cartel de góndola no existe.
      supabase.from("configuracion").select("valor").eq("parametro", "REDONDEO_PRECIO").maybeSingle(),
    ]);

  if (!condiciones) return <p className="vacio">No se pudo cargar la pantalla. Probá recargar.</p>;

  return (
    <PortalCambios
      productos={productos}
      solicitudes={solicitudes}
      politica={politica}
      subcategorias={(subcategorias ?? []).map((s) => ({
        id: s.id_subcategoria as string,
        nombre: s.nombre as string,
      }))}
      tasas={tasas}
      condiciones={condiciones}
      redondeo={Number(cfg?.valor ?? 0) || 0}
    />
  );
}
