import { getSupabaseServerClient, type Producto, type Marca, type Subcategoria, type Local } from "@/lib/supabase";
import { fetchContenidoAsesor } from "@/lib/contenidoAsesor";
import { fetchVariantesPorProducto } from "@/lib/variantes";
import ProductosApp from "@/components/ProductosApp";

export const dynamic = "force-dynamic";

// Sugerencia simple de reposición: cuántas unidades se vendieron en los
// últimos DIAS_VENTANA días, llevado a un ritmo diario y multiplicado por
// cuántos días de cobertura queremos tener siempre disponibles.
const DIAS_VENTANA = 30;
const DIAS_COBERTURA = 14;

export default async function ProductosPage() {
  const supabase = getSupabaseServerClient();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DIAS_VENTANA);

  const [
    productosRes,
    marcasRes,
    subcategoriasRes,
    contenidoAsesor,
    variantesPorProducto,
    localesRes,
    stockRes,
    ventasRecientesRes,
    configRes,
  ] = await Promise.all([
    supabase.from("productos").select("*").order("nombre", { ascending: true }),
    supabase.from("marcas").select("*").eq("estado", "ACTIVA").order("nombre", { ascending: true }),
    supabase.from("subcategorias").select("*").order("nombre", { ascending: true }),
    fetchContenidoAsesor(supabase),
    fetchVariantesPorProducto(supabase),
    supabase.from("locales").select("*").eq("estado", "ACTIVO").order("nombre", { ascending: true }),
    supabase.from("stock").select("id_variante, cantidad"),
    supabase.from("ventas").select("id_venta").eq("estado", "PAGADA").gte("fecha", cutoff.toISOString()),
    supabase.from("configuracion").select("valor").eq("parametro", "MARGEN_MINIMO_PORCENTAJE").maybeSingle(),
  ]);

  const error = productosRes.error || marcasRes.error || subcategoriasRes.error;
  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-red-600 font-medium mb-2">No se pudieron cargar los productos</p>
        <p className="text-sm text-neutral-500">{error.message}</p>
      </div>
    );
  }

  if ((marcasRes.data ?? []).length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <p className="text-neutral-700 font-medium mb-2">Todavía no hay marcas cargadas</p>
        <p className="text-sm text-neutral-500">
          Antes de cargar productos, andá a la sección "Marcas" y creá al menos una.
        </p>
      </div>
    );
  }

  const stockPorVariante: Record<string, number> = {};
  (stockRes.data ?? []).forEach((s) => {
    stockPorVariante[s.id_variante] = (stockPorVariante[s.id_variante] ?? 0) + (s.cantidad ?? 0);
  });

  const stockOptimoPorVariante: Record<string, number> = {};
  const idsVentaRecientes = (ventasRecientesRes.data ?? []).map((v) => v.id_venta);
  if (idsVentaRecientes.length > 0) {
    const { data: detalleReciente } = await supabase
      .from("detalle_ventas")
      .select("id_variante, cantidad")
      .in("id_venta", idsVentaRecientes);
    const vendidoPorVariante: Record<string, number> = {};
    (detalleReciente ?? []).forEach((d) => {
      vendidoPorVariante[d.id_variante] = (vendidoPorVariante[d.id_variante] ?? 0) + (d.cantidad ?? 0);
    });
    Object.entries(vendidoPorVariante).forEach(([idVariante, cantidad]) => {
      stockOptimoPorVariante[idVariante] = Math.ceil((cantidad / DIAS_VENTANA) * DIAS_COBERTURA);
    });
  }

  return (
    <ProductosApp
      initialProductos={(productosRes.data ?? []) as Producto[]}
      marcas={(marcasRes.data ?? []) as Marca[]}
      subcategorias={(subcategoriasRes.data ?? []) as Subcategoria[]}
      locales={(localesRes.data ?? []) as Local[]}
      margenMinimo={Number(configRes.data?.valor ?? 15)}
      stockPorVariante={stockPorVariante}
      stockOptimoPorVariante={stockOptimoPorVariante}
      diasCobertura={DIAS_COBERTURA}
      objetivosGlobales={contenidoAsesor.objetivosGlobales}
      filtrosGlobales={contenidoAsesor.filtrosGlobales}
      fichaPorProducto={contenidoAsesor.fichaPorProducto}
      objetivosPorProducto={contenidoAsesor.objetivosPorProducto}
      filtrosPorProducto={contenidoAsesor.filtrosPorProducto}
      variantesPorProducto={variantesPorProducto}
    />
  );
}
