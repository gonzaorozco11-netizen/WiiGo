import { notFound } from "next/navigation";
import { getSupabaseServerClient, type Marca, type Producto, type Subcategoria } from "@/lib/supabase";
import { fetchContenidoAsesor } from "@/lib/contenidoAsesor";
import MarcaDetail from "@/components/MarcaDetail";

export const dynamic = "force-dynamic";

export default async function MarcaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const [marcaRes, subcategoriasRes, productosRes, contenidoAsesor] = await Promise.all([
    supabase.from("marcas").select("*").eq("id_marca", id).maybeSingle(),
    supabase
      .from("subcategorias")
      .select("*")
      .eq("id_marca", id)
      .order("nombre", { ascending: true }),
    supabase.from("productos").select("*").eq("id_marca", id).order("nombre", { ascending: true }),
    fetchContenidoAsesor(supabase),
  ]);

  if (!marcaRes.data) notFound();

  return (
    <MarcaDetail
      marca={marcaRes.data as Marca}
      subcategorias={(subcategoriasRes.data ?? []) as Subcategoria[]}
      productos={(productosRes.data ?? []) as Producto[]}
      objetivosGlobales={contenidoAsesor.objetivosGlobales}
      filtrosGlobales={contenidoAsesor.filtrosGlobales}
      fichaPorProducto={contenidoAsesor.fichaPorProducto}
      objetivosPorProducto={contenidoAsesor.objetivosPorProducto}
      filtrosPorProducto={contenidoAsesor.filtrosPorProducto}
    />
  );
}
