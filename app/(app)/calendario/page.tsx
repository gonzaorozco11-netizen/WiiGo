import { obtenerSesionConPermisos } from "@/lib/permisos";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { calendarioAdmin, puedeEditarCalendario } from "@/app/(app)/calendario/actions";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import CalendarioApp from "@/components/CalendarioApp";
import "./calendario.css";

export const dynamic = "force-dynamic";

// El calendario de WiiGo. Quien puede editar (el Dueño o "calendario-editar")
// carga, aprueba y reparte lugares; el resto del equipo (pantalla
// "calendario", por ejemplo los operativos) lo ve sin poder tocar nada, y sin
// los borradores ni las propuestas sin aprobar.
export default async function CalendarioPage() {
  const sesion = await obtenerSesionConPermisos();
  // Los usuarios de marca no entran acá: esta es la pantalla de WiiGo.
  if (!sesion || sesion.rol === "marca") return <PantallaBloqueada />;
  const pantallas = await obtenerSesionConPantallas();
  const editor = await puedeEditarCalendario();
  if (!editor && !puedeVerPantalla(pantallas, "calendario")) return <PantallaBloqueada />;

  const datos = await calendarioAdmin();
  if (!datos) return <PantallaBloqueada />;

  if (!editor) {
    return (
      <CalendarioApp
        soloLectura
        datos={{ ...datos, propuestas: [], proximos: datos.proximos.filter((e) => e.estado !== "BORRADOR") }}
      />
    );
  }
  return <CalendarioApp datos={datos} />;
}
