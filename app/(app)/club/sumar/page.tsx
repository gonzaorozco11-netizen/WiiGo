import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ConsultarClienteClub from "@/components/ConsultarClienteClub";

// WiiGo Club, el acceso directo del Inicio: buscar a un cliente por DNI (nombre,
// desde cuándo está, puntos) y, si no está, sumarlo ahí mismo (21/11). Lo usa
// quien vende o quien maneja Clientes.
export default async function SumarClienteClubPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!(puedeVerPantalla(sesion, "club-sumar") || puedeVerPantalla(sesion, "pos") || puedeVerPantalla(sesion, "clientes"))) return <PantallaBloqueada />;

  return (
    <div className="max-w-md mx-auto py-8 px-1">
      <h1 className="text-xl font-extrabold text-neutral-900">WiiGo Club</h1>
      <p className="text-sm text-neutral-500 mt-1 mb-5">
        Buscá a un cliente por DNI para ver sus puntos. Si no está, sumalo: con el DNI, cada compra suma puntos desde hoy, en cualquier estación.
      </p>
      <ConsultarClienteClub />
    </div>
  );
}
