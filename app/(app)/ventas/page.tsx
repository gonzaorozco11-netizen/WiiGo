import {
  getSupabaseServerClient,
  type Local,
  type Venta,
  type Producto,
  type VarianteProducto,
  type Marca,
  type Cliente,
} from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import VentasApp from "@/components/VentasApp";

export const dynamic = "force-dynamic";

// La pantalla arranca mostrando "esta semana" (mismo default que ya tenía
// VentasApp) — traer solo eso en la carga inicial en vez de la tabla entera
// es lo que evita que la pantalla se ponga cada vez más lenta a medida que
// se acumulan ventas. Cambiar el filtro en pantalla pide el resto bajo
// demanda (ver listarVentasFiltradas en actions.ts).
function hace7diasISO() {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - 6);
  return fecha.toISOString().slice(0, 10);
}

export default async function VentasPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "ventas")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();

  const [localesRes, ventasRes, productosRes, variantesRes, marcasRes, clientesRes] = await Promise.all([
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase
      .from("ventas")
      .select("*")
      .neq("estado", "PENDIENTE_PAGO")
      .gte("fecha", `${hace7diasISO()}T00:00:00`)
      .order("fecha", { ascending: false }),
    supabase.from("productos").select("*"),
    supabase.from("variantes_producto").select("*"),
    supabase.from("marcas").select("*"),
    supabase.from("clientes").select("*"),
  ]);

  const error =
    localesRes.error || ventasRes.error || productosRes.error || variantesRes.error || marcasRes.error || clientesRes.error;

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar las ventas</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  return (
    <VentasApp
      locales={(localesRes.data ?? []) as Local[]}
      ventasIniciales={(ventasRes.data ?? []) as Venta[]}
      productos={(productosRes.data ?? []) as Producto[]}
      variantes={(variantesRes.data ?? []) as VarianteProducto[]}
      marcas={(marcasRes.data ?? []) as Marca[]}
      clientes={(clientesRes.data ?? []) as Cliente[]}
    />
  );
}
