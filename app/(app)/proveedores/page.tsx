import {
  getSupabaseServerClient,
  type Local,
  type Producto,
  type VarianteProducto,
  type Stock,
  type RecepcionProveedor,
} from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ProveedoresApp from "@/components/ProveedoresApp";
import { listarProveedores, listarMarcasParaProveedores } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProveedoresPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "proveedores")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();

  const [
    proveedores,
    localesRes,
    marcasPropiasRes,
    variantesRes,
    stockRes,
    recepcionesRes,
    turnosAbiertosRes,
    marcasEnLista,
  ] = await Promise.all([
    listarProveedores(),
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase.from("marcas").select("id_marca").eq("tipo_comercializacion", "PROPIA"),
    supabase.from("variantes_producto").select("*").eq("estado", "ACTIVO"),
    supabase.from("stock").select("*"),
    // Las órdenes de compra y sus diferencias ya no se consultan acá: esa
    // pestaña se mudó entera a Compras. Eran tres consultas a tablas grandes
    // en cada carga de una pantalla que ahora solo muestra cuentas.
    supabase.from("recepciones_proveedor").select("id_orden, facturada"),
    supabase.from("turnos").select("id_turno, id_local").eq("estado", "ABIERTO"),
    listarMarcasParaProveedores(),
  ]);

  const idsMarcaPropia = (marcasPropiasRes.data ?? []).map((m) => m.id_marca);
  const productosRes =
    idsMarcaPropia.length > 0
      ? await supabase.from("productos").select("*").eq("estado", "ACTIVO").in("id_marca", idsMarcaPropia)
      : { data: [], error: null };

  const error =
    localesRes.error ||
    marcasPropiasRes.error ||
    productosRes.error ||
    variantesRes.error ||
    stockRes.error ||
    recepcionesRes.error ||
    turnosAbiertosRes.error;

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudo cargar Proveedores</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  return (
    <ProveedoresApp
      proveedores={proveedores}
      esAdmin={sesion?.rol === "admin"}
      locales={(localesRes.data ?? []) as Local[]}
      productos={(productosRes.data ?? []) as Producto[]}
      variantes={(variantesRes.data ?? []) as VarianteProducto[]}
      stock={(stockRes.data ?? []) as Stock[]}
      recepciones={(recepcionesRes.data ?? []) as Pick<RecepcionProveedor, "id_orden" | "facturada">[]}
      turnosAbiertos={turnosAbiertosRes.data ?? []}
      marcasEnLista={marcasEnLista}
    />
  );
}
