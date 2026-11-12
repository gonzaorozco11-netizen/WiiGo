import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import SumarClienteClub from "@/components/SumarClienteClub";

// El acceso directo del Inicio: sumar a alguien a WiiGo Club sin estar
// vendiendo (se quiere anotar, o lo anotan antes de cobrar). Lo usa quien
// vende o quien maneja Clientes.
export default async function SumarClienteClubPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!(puedeVerPantalla(sesion, "club-sumar") || puedeVerPantalla(sesion, "pos") || puedeVerPantalla(sesion, "clientes"))) return <PantallaBloqueada />;

  return (
    <div className="max-w-md mx-auto py-8 px-1">
      <h1 className="text-xl font-extrabold text-neutral-900">Sumar cliente al Club</h1>
      <p className="text-sm text-neutral-500 mt-1 mb-5">
        Con el DNI, cada compra suma puntos WiiGo desde hoy, en cualquier estación. El mail es para mandarle sus puntos y novedades si las acepta.
      </p>
      <div className="bg-white border border-neutral-200 rounded-xl p-4">
        <SumarClienteClub />
      </div>
    </div>
  );
}
