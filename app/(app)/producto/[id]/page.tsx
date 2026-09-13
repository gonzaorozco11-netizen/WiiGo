import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import FichaProductoApp from "@/components/FichaProductoApp";
import { fichaDeProducto } from "@/lib/fichaProducto";

export const dynamic = "force-dynamic";

// La ficha de un producto, con su propia dirección para poder mandarla por
// mensaje o guardarla en favoritos.
//
// No tiene pantalla propia en Áreas a propósito: es el detalle de Stock, así
// que quien puede ver Stock puede ver la ficha. Agregar un permiso nuevo
// obligaría a repasar todas las áreas ya cargadas para que nadie pierda
// acceso a algo que ya tenía.

export default async function FichaProductoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "stock")) return <PantallaBloqueada />;

  const { id } = await params;
  const { desde, hasta } = await searchParams;

  const hoy = new Date();
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const ficha = await fichaDeProducto(id, desde ?? iso(primero), hasta ?? iso(hoy));

  if (!ficha) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">No se encontró ese producto</p>
        <p className="text-sm text-neutral-500">Puede que lo hayan dado de baja o que el link esté mal.</p>
      </div>
    );
  }

  return <FichaProductoApp ficha={ficha} />;
}
