import { calendarioPortal } from "@/app/portal/calendario/actions";
import PortalCalendario from "@/components/PortalCalendario";

export const dynamic = "force-dynamic";

export default async function PortalCalendarioPage() {
  const datos = await calendarioPortal();
  if (!datos) return <p className="vacio">No se pudo cargar el calendario. Probá recargar.</p>;

  return <PortalCalendario datos={datos} />;
}
