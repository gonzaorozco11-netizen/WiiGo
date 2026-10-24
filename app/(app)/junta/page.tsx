import { obtenerSesionConPantallas } from "@/lib/roles";
import { armarTablero } from "@/lib/tablero";
import { hayClaveIA } from "@/lib/ia";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import JuntaApp from "@/components/JuntaApp";
import { leerConversaciones } from "./actions";
import "./junta.css";

export const dynamic = "force-dynamic";
// Una pregunta a toda la junta son siete consultas a la IA: le damos tiempo.
export const maxDuration = 120;

// La Junta: seis encargados con IA que opinan con los números reales. Solo del Dueño.
export default async function JuntaPage() {
  const sesion = await obtenerSesionConPantallas();
  if (sesion?.rol !== "admin") return <PantallaBloqueada />;

  const [tablero, conversaciones] = await Promise.all([armarTablero().catch(() => null), leerConversaciones()]);
  const d = tablero?.dueno;

  return (
    <JuntaApp
      mensajesIniciales={conversaciones.mensajes}
      faltaSql={conversaciones.faltaSql}
      sinClave={!hayClaveIA()}
      hoy={d ? { vendido: d.hoy.vendido, ventas: d.hoy.tickets, ticket: d.hoy.tickets ? Math.round(d.hoy.vendido / d.hoy.tickets) : 0 } : null}
      pendientes={[...(tablero?.urgentes ?? []), ...(tablero?.seguimiento ?? [])].slice(0, 8)}
    />
  );
}
