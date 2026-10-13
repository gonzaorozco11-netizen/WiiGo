import { canastaPortal } from "@/app/portal/canasta/actions";
import PortalCanasta from "@/components/PortalCanasta";

export const dynamic = "force-dynamic";

export default async function PortalCanastaPage() {
  const datos = await canastaPortal();
  if (!datos) return <p className="vacio">No se pudo cargar. Probá recargar.</p>;

  return <PortalCanasta datos={datos} />;
}
