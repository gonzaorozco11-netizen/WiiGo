import { redirect } from "next/navigation";
import { armarTablero } from "@/lib/tablero";
import { obtenerSesionConPantallas } from "@/lib/roles";
import { getSupabaseServerClient } from "@/lib/supabase";
import { tareasDeUsuario } from "@/lib/tareasEquipo";
import MisTareasApp from "@/components/MisTareasApp";

export const dynamic = "force-dynamic";

// Mis Tareas: la bandeja de entrada de cada persona.
//
// Sin pantalla propia en Áreas a propósito. Lo que se ve acá ya está filtrado
// por las pantallas que cada uno tiene (armarTablero solo consulta lo que la
// persona puede ver), así que un permiso aparte no agregaría nada y sí podría
// dejar a alguien sin su lista de tareas por olvido.
//
// Arriba van las tareas de Administración WiiGo (aprobadas por el Dueño desde
// la Junta): son para esa persona, su turno o todo el equipo.

export default async function MisTareasPage() {
  const [tablero, sesion] = await Promise.all([armarTablero(), obtenerSesionConPantallas()]);
  if (!tablero || !sesion) redirect("/login");
  const asignadas = await tareasDeUsuario(getSupabaseServerClient(), sesion.idUsuario).catch(() => []);

  return <MisTareasApp tablero={tablero} asignadas={asignadas} />;
}
