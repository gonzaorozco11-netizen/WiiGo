import { redirect } from "next/navigation";
import { armarTablero } from "@/lib/tablero";
import MisTareasApp from "@/components/MisTareasApp";

export const dynamic = "force-dynamic";

// Mis Tareas: la bandeja de entrada de cada persona.
//
// Sin pantalla propia en Áreas a propósito. Lo que se ve acá ya está filtrado
// por las pantallas que cada uno tiene (armarTablero solo consulta lo que la
// persona puede ver), así que un permiso aparte no agregaría nada y sí podría
// dejar a alguien sin su lista de tareas por olvido.

export default async function MisTareasPage() {
  const tablero = await armarTablero();
  if (!tablero) redirect("/login");

  return <MisTareasApp tablero={tablero} />;
}
