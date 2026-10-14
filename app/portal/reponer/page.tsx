import { miReposicion } from "@/app/portal/reponer/actions";
import { reposicionPortal } from "@/app/portal/actions";
import PortalReponer from "@/components/PortalReponer";

export const dynamic = "force-dynamic";

export default async function ReponerPage() {
  // El historial va acá y no en el Tablero: mandar el envío y controlar qué
  // llegó son las dos mitades de la misma conversación. Tenerlas en pantallas
  // distintas obliga a mandar en una y reclamar en otra.
  const [datos, envios] = await Promise.all([miReposicion(), reposicionPortal()]);
  // Sin sesión de marca o sin local activo no hay nada que mostrar: el layout
  // del portal ya manda al login, así que acá alcanza con no romper.
  if (!datos) return null;
  return <PortalReponer datos={datos} envios={envios} />;
}
