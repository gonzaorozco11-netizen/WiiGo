import {
  getSupabaseServerClient,
  type Local,
  type Producto,
  type VarianteProducto,
  type Stock,
  type OrdenCompraProveedor,
  type DetalleOrdenCompra,
  type DetalleRecepcionProveedor,
  type RecepcionProveedor,
} from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import ProveedoresApp from "@/components/ProveedoresApp";
import { listarProveedores } from "./actions";

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
    ordenesRes,
    detalleOrdenesRes,
    detalleRecepcionRes,
    recepcionesRes,
    turnosAbiertosRes,
  ] = await Promise.all([
    listarProveedores(),
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase.from("marcas").select("id_marca").eq("tipo_comercializacion", "PROPIA"),
    supabase.from("variantes_producto").select("*").eq("estado", "ACTIVO"),
    supabase.from("stock").select("*"),
    supabase.from("ordenes_compra_proveedor").select("*").order("fecha_alta", { ascending: false }),
    supabase.from("detalle_orden_compra").select("*"),
    supabase.from("detalle_recepcion_proveedor").select("*").neq("estado_control", "COMPLETA"),
    supabase.from("recepciones_proveedor").select("id_orden, facturada"),
    supabase.from("turnos").select("id_turno, id_local").eq("estado", "ABIERTO"),
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
    ordenesRes.error ||
    detalleOrdenesRes.error ||
    detalleRecepcionRes.error ||
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
      ordenes={(ordenesRes.data ?? []) as OrdenCompraProveedor[]}
      detalleOrdenes={(detalleOrdenesRes.data ?? []) as DetalleOrdenCompra[]}
      reclamos={(detalleRecepcionRes.data ?? []) as DetalleRecepcionProveedor[]}
      recepciones={(recepcionesRes.data ?? []) as Pick<RecepcionProveedor, "id_orden" | "facturada">[]}
      turnosAbiertos={turnosAbiertosRes.data ?? []}
    />
  );
}
