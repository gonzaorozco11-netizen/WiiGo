import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import CobrosDigitalesApp from "@/components/CobrosDigitalesApp";

export const dynamic = "force-dynamic";
// «Actualizar ahora» baja y guarda reportes de Mercado Pago: puede tardar más que lo común.
export const maxDuration = 60;

// Cobros digitales (Gonzalo, 17/11): cada pago sin efectivo con lo que el medio
// de pago descontó de verdad y cuánto es tuyo y cuánto de cada marca.
export default async function CobrosDigitalesPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "cobros-digitales")) return <PantallaBloqueada />;
  return <CobrosDigitalesApp />;
}
