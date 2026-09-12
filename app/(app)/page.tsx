import { redirect } from "next/navigation";
import { armarTablero } from "@/lib/tablero";
import TableroInicio from "@/components/TableroInicio";

export const dynamic = "force-dynamic";

// Pantalla de inicio: lo que cada uno tiene pendiente.
//
// Antes esto era un redirect — el Dueño caía en Marcas y un operativo con
// Ficha Asistencia caía ahí directo, para que nadie se olvidara de fichar.
// Ese motivo sigue valiendo, así que no se perdió: si todavía no marcó la
// entrada, "Fichá tu entrada" es la primera tarjeta y va en rojo. La
// diferencia es que ahora, además, ve el resto de su día.
export default async function HomePage() {
  const tablero = await armarTablero();
  // Sin sesión válida no hay tablero que armar: al login, como siempre.
  if (!tablero) redirect("/login");

  return <TableroInicio tablero={tablero} />;
}
