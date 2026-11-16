import Link from "next/link";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import AprenderApp from "@/components/AprenderApp";
import { obtenerAprender } from "./actions";

export const dynamic = "force-dynamic";

// Aprender: el equipo estudia los productos que vende, por tema, con lo que
// administración aprobó (ver /aprender/revisar).
export default async function AprenderPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "aprender") && !puedeVerPantalla(sesion, "aprender-revisar")) return <PantallaBloqueada />;
  const datos = await obtenerAprender();
  // Quien aprueba los textos entra a revisarlos desde acá (ya no es otro ítem del menú).
  const revisa = sesion?.rol === "admin" || puedeVerPantalla(sesion, "aprender-revisar");
  return (
    <>
      {revisa && (
        <div className="mb-4 flex justify-end">
          <Link href="/aprender/revisar" className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-700 hover:border-neutral-400">
            Revisar textos de la IA →
          </Link>
        </div>
      )}
      <AprenderApp datos={datos} />
    </>
  );
}
