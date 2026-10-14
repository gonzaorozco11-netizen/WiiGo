import { miReposicion } from "@/app/portal/reponer/actions";
import PortalReponer from "@/components/PortalReponer";

export const dynamic = "force-dynamic";

export default async function ReponerPage() {
  const datos = await miReposicion();
  // Sin sesión de marca o sin local activo no hay nada que mostrar: el layout
  // del portal ya manda al login, así que acá alcanza con no romper.
  if (!datos) return null;
  return <PortalReponer datos={datos} />;
}
