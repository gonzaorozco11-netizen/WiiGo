import {
  getSupabaseServerClient,
  type Local,
  type Producto,
  type Marca,
  type Subcategoria,
  type VarianteProducto,
  type Stock,
  type MovimientoStock,
} from "@/lib/supabase";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import PantallaBloqueada from "@/components/PantallaBloqueada";
import StockApp from "@/components/StockApp";
import { calcularCobertura, DIAS_MINIMOS, type Cobertura } from "@/lib/cobertura";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "stock")) return <PantallaBloqueada />;

  const supabase = getSupabaseServerClient();

  const [localesRes, variantesRes, productosRes, marcasRes, subcategoriasRes, stockRes, movimientosRes] =
    await Promise.all([
      supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
      supabase.from("variantes_producto").select("*").eq("estado", "ACTIVO"),
      supabase.from("productos").select("*").eq("estado", "ACTIVO"),
      supabase.from("marcas").select("*"),
      supabase.from("subcategorias").select("*"),
      supabase.from("stock").select("*"),
      supabase.from("movimientos_stock").select("*").order("fecha", { ascending: false }).limit(50),
    ]);

  const error =
    localesRes.error ||
    variantesRes.error ||
    productosRes.error ||
    marcasRes.error ||
    subcategoriasRes.error ||
    stockRes.error ||
    movimientosRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudo cargar el stock</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  if ((localesRes.data ?? []).length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">Todavía no hay locales cargados</p>
        <p className="text-sm text-neutral-500">
          Antes de manejar stock, andá a la sección "Locales" y creá al menos uno.
        </p>
      </div>
    );
  }

  // La cobertura se calcula con las ventas reales. Antes de abrir el local no
  // hay ninguna, así que la columna muestra desde cuándo va a servir en vez de
  // quedar en blanco sin explicación.
  const filasStock = (stockRes.data ?? []) as Stock[];
  const cobertura = await calcularCobertura(supabase, filasStock);

  return (
    <StockApp
      cobertura={Object.fromEntries(cobertura.porVarianteLocal) as Record<string, Cobertura>}
      diasDeHistorial={cobertura.diasDeHistorial}
      coberturaSinDatos={cobertura.sinDatos}
      diasMinimos={DIAS_MINIMOS}
      locales={(localesRes.data ?? []) as Local[]}
      variantes={(variantesRes.data ?? []) as VarianteProducto[]}
      productos={(productosRes.data ?? []) as Producto[]}
      marcas={(marcasRes.data ?? []) as Marca[]}
      subcategorias={(subcategoriasRes.data ?? []) as Subcategoria[]}
      stock={(stockRes.data ?? []) as Stock[]}
      movimientos={(movimientosRes.data ?? []) as MovimientoStock[]}
      // Cuánto cuesta la mercadería es información de administración: el
      // local carga la merma, pero no tiene por qué saber cuánto le pagás al
      // proveedor por lo que se rompió.
      puedeVerCostos={
        puedeVerPantalla(sesion, "compras-costeo") || puedeVerPantalla(sesion, "proveedores")
      }
    />
  );
}
