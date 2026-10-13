import { misTareas } from "@/app/portal/actions";
import PortalTareas from "@/components/PortalTareas";

export const dynamic = "force-dynamic";

export default async function PortalTareasPage() {
  const datos = await misTareas();
  if (!datos) return <p className="vacio">No se pudieron cargar tus tareas. Probá recargar.</p>;

  return <PortalTareas datos={datos} />;
}
