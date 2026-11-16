import { misCombos, combosPedidos } from "@/app/portal/combos/actions";
import PortalCombos from "@/components/PortalCombos";

export const dynamic = "force-dynamic";

// Portal de la marca → Mis combos (16/11). El layout del portal ya manda al login si no hay sesión.
export default async function CombosPortalPage() {
  const [datos, pedidos] = await Promise.all([misCombos(), combosPedidos()]);
  if (!datos) return null;
  return <PortalCombos combos={datos.combos} productos={datos.productos} soloLectura={datos.soloLectura} pedidos={pedidos} />;
}
