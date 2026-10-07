import { misCostosPortal } from "@/app/portal/actions";
import PortalMisProductos from "@/components/PortalMisProductos";

export const dynamic = "force-dynamic";

export default async function PortalProductosPage() {
  const datos = await misCostosPortal();
  if (!datos) return <p className="vacio">No se pudieron cargar tus productos. Probá recargar.</p>;

  return <PortalMisProductos datos={datos} />;
}
