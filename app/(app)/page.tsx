import { redirect } from "next/navigation";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";

// El Dueño sigue entrando por Marcas, como siempre. Un operativo con acceso
// a Ficha Asistencia cae ahí directo — así nadie se olvida de fichar antes
// de ponerse a hacer cualquier otra cosa.
export default async function HomePage() {
  const sesion = await obtenerSesionConPantallas();
  if (sesion && sesion.rol !== "admin" && puedeVerPantalla(sesion, "ficha-asistencia")) {
    redirect("/ficha-asistencia");
  }
  redirect("/marcas");
}
