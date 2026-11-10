import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import InventarioApp from "@/components/InventarioApp";
import { localDeSesion } from "@/lib/fraccionado";
import { catalogoInventario, conteosDe, inventarioAbierto, ubicacionesDe } from "@/lib/inventario";
import { cargarGondola } from "@/lib/gondola";

export const dynamic = "force-dynamic";

// Inventario general del local: se cuenta por módulo y al cerrar se carga el stock.
// Lo puede usar quien tiene Inventario o el conteo del turno (el equipo del local).
export default async function InventarioPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !(puedeVerPantalla(sesion, "inventario") || puedeVerPantalla(sesion, "conteo"))) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const idLocal = await localDeSesion(supabase, sesion.idUsuario);
  if (!idLocal) return <p className="max-w-md mx-auto text-center py-12 text-neutral-700">Tu usuario no tiene un local asignado.</p>;

  const inv = await inventarioAbierto(supabase, idLocal);
  if (inv === "SIN_SQL") {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-1">Falta crear las tablas del inventario</p>
        <p className="text-sm text-neutral-500">Corré sql/inventario.sql en el SQL Editor de Supabase.</p>
      </div>
    );
  }
  const esAdmin = sesion.rol === "admin";
  if (!inv) return <InventarioApp abierto={false} esAdmin={esAdmin} miNombre={sesion.nombre} catalogo={[]} conteos={[]} firmas={[]} />;

  const [catalogo, { conteos, firmas }, gondola, ubicaciones] = await Promise.all([
    catalogoInventario(supabase),
    conteosDe(supabase, inv.id),
    // El mueble en 3D de cada lugar, para confirmar dónde está cada producto.
    cargarGondola(supabase, idLocal).catch(() => null),
    esAdmin ? ubicacionesDe(supabase, idLocal, inv.id) : Promise.resolve(null),
  ]);
  return (
    <InventarioApp
      abierto
      esAdmin={esAdmin}
      miNombre={sesion.nombre}
      catalogo={catalogo}
      conteos={conteos}
      firmas={firmas}
      desde={inv.desde}
      gondola={gondola ?? []}
      ubicaciones={ubicaciones}
    />
  );
}
