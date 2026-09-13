import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import FichaProveedorApp from "@/components/FichaProveedorApp";
import { fichaDeProveedor } from "@/lib/fichaProveedor";

export const dynamic = "force-dynamic";

// La ficha de un proveedor, con dirección propia para poder compartirla.
//
// Sin permiso nuevo: es el detalle de Proveedores, así que usa el mismo. Sumar
// una pantalla a Áreas obligaría a repasar todas las áreas ya cargadas para
// que nadie pierda acceso a algo que ya tenía.

export default async function FichaProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "proveedores")) return <PantallaBloqueada />;

  const { id } = await params;
  const ficha = await fichaDeProveedor(id);

  if (!ficha) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">No se encontró ese proveedor</p>
        <p className="text-sm text-neutral-500">Puede que lo hayan dado de baja o que el link esté mal.</p>
      </div>
    );
  }

  return <FichaProveedorApp ficha={ficha} />;
}
