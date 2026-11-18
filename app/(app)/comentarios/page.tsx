import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { getSupabaseServerClient } from "@/lib/supabase";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ComentariosApp from "@/components/ComentariosApp";
import { comentariosParaRevisar } from "@/lib/opinionesProducto";

export const dynamic = "force-dynamic";

// Lo que escriben los clientes sobre los productos que compraron: se publica
// recién cuando un operativo lo aprueba (Gonzalo, 18/11).
export default async function ComentariosPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "comentarios")) return <PantallaBloqueada />;
  const datos = await comentariosParaRevisar(getSupabaseServerClient());
  return <ComentariosApp {...datos} esAdmin={sesion?.rol === "admin"} />;
}
