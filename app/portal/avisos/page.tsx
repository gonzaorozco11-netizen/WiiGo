import { misAvisos } from "@/app/portal/avisos/actions";
import PortalAvisos from "@/components/PortalAvisos";

export const dynamic = "force-dynamic";

export default async function PortalAvisosPage() {
  const datos = await misAvisos();
  if (!datos) return <p className="vacio">No se pudieron cargar tus avisos. Probá recargar.</p>;

  return <PortalAvisos datos={datos} />;
}
