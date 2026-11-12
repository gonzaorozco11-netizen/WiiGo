import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import PedidoProveedorApp from "@/components/PedidoProveedorApp";
import { localDeSesion } from "@/lib/fraccionado";
import { pedidosEsperando, sugerirPedidoProveedor } from "@/lib/pedidoProveedor";

export const dynamic = "force-dynamic";

// Pedido al proveedor (Alifrut): lo arma el equipo del local con lo que llegó
// al mínimo, y Gonzalo lo carga en la web del proveedor (/compras/pedir/[id]).
export default async function PedirPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !(puedeVerPantalla(sesion, "compras-pedir") || puedeVerPantalla(sesion, "compras"))) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const idLocal = await localDeSesion(supabase, sesion.idUsuario);
  if (!idLocal) {
    return <p className="max-w-md mx-auto text-center py-12 text-neutral-700">Tu usuario no tiene un local asignado. Pedile a Gonzalo que lo vincule en Organización.</p>;
  }

  // El proveedor al que se le liquida por lo vendido (Alifrut): el que tiene
  // granel y mercadería de la marca propia.
  const { data: proveedores } = await supabase
    .from("proveedores")
    .select("id_proveedor, nombre")
    .eq("estado", "ACTIVO")
    .eq("modo_facturacion", "LIQUIDACION_VENTA")
    .order("nombre");
  const proveedor = proveedores?.[0];
  if (!proveedor) {
    return <p className="max-w-md mx-auto text-center py-12 text-neutral-700">No hay ningún proveedor que liquide por lo vendido (como Alifrut).</p>;
  }

  const [sugerido, esperando] = await Promise.all([
    sugerirPedidoProveedor(supabase, proveedor.id_proveedor as string, idLocal),
    pedidosEsperando(supabase),
  ]);

  return (
    <PedidoProveedorApp
      proveedor={{ id: proveedor.id_proveedor as string, nombre: proveedor.nombre as string }}
      idLocal={idLocal}
      sugerido={sugerido}
      esperando={esperando.filter((p) => p.idProveedor === proveedor.id_proveedor)}
      puedeCargar={puedeVerPantalla(sesion, "compras")}
    />
  );
}
