import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import PedidoProveedorApp from "@/components/PedidoProveedorApp";
import { localDeSesion } from "@/lib/fraccionado";
import { pedidosEsperando, proveedorDelPedido, sugerirPedidoProveedor } from "@/lib/pedidoProveedor";

export const dynamic = "force-dynamic";

// Pedido al proveedor (Alifrut): la lista se va armando sola con lo que llega
// al mínimo, y Gonzalo la carga en la web del proveedor cuando quiere
// (/compras/pedir/[id]). La clave «compras-pedir» queda para dársela a alguien
// del equipo si algún día hace falta: entonces la arma y se la manda.
export default async function PedirPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!sesion || !(puedeVerPantalla(sesion, "compras-pedir") || puedeVerPantalla(sesion, "compras"))) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();
  const idLocal = await localDeSesion(supabase, sesion.idUsuario);
  if (!idLocal) {
    return <p className="max-w-md mx-auto text-center py-12 text-neutral-700">Tu usuario no tiene un local asignado. Pedile a Gonzalo que lo vincule en Organización.</p>;
  }

  const proveedor = await proveedorDelPedido(supabase);
  if (!proveedor) {
    return <p className="max-w-md mx-auto text-center py-12 text-neutral-700">No hay ningún proveedor que liquide por lo vendido (como Alifrut).</p>;
  }

  const [sugerido, esperando] = await Promise.all([sugerirPedidoProveedor(supabase, proveedor.id, idLocal), pedidosEsperando(supabase)]);

  return (
    <PedidoProveedorApp
      proveedor={proveedor}
      idLocal={idLocal}
      sugerido={sugerido}
      esperando={esperando.filter((p) => p.idProveedor === proveedor.id)}
      puedeCargar={puedeVerPantalla(sesion, "compras")}
    />
  );
}
