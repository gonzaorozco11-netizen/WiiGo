import { notFound } from "next/navigation";
import {
  getSupabaseServerClient,
  type Local,
  type Marca,
  type Producto,
  type Subcategoria,
} from "@/lib/supabase";
import { fetchContenidoAsesor } from "@/lib/contenidoAsesor";
import AsesorApp from "@/components/AsesorApp";

export const dynamic = "force-dynamic";

export default async function AsesorPage({ params }: { params: Promise<{ idLocal: string }> }) {
  const { idLocal } = await params;
  const supabase = getSupabaseServerClient();

  const { data: local } = await supabase
    .from("locales")
    .select("*")
    .eq("id_local", idLocal)
    .eq("estado", "ACTIVO")
    .maybeSingle();

  if (!local) notFound();

  const [marcasRes, productosRes, subcategoriasRes, contenido] = await Promise.all([
    supabase.from("marcas").select("*").eq("estado", "ACTIVA").eq("visible_asesor", true),
    supabase.from("productos").select("*").eq("estado", "ACTIVO").eq("visible_asesor", true),
    supabase.from("subcategorias").select("*").eq("estado", "ACTIVA"),
    fetchContenidoAsesor(supabase),
  ]);

  return (
    <AsesorApp
      local={local as Local}
      marcas={(marcasRes.data ?? []) as Marca[]}
      productos={(productosRes.data ?? []) as Producto[]}
      subcategorias={(subcategoriasRes.data ?? []) as Subcategoria[]}
      objetivos={contenido.objetivosGlobales}
      filtros={contenido.filtrosGlobales}
      fichaPorProducto={contenido.fichaPorProducto}
      objetivosPorProducto={contenido.objetivosPorProducto}
      filtrosPorProducto={contenido.filtrosPorProducto}
    />
  );
}
