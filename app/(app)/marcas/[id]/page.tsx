import { notFound } from "next/navigation";
import { getSupabaseServerClient, type Marca, type Producto, type Subcategoria } from "@/lib/supabase";
import { fetchContenidoAsesor } from "@/lib/contenidoAsesor";
import { fetchVariantesPorProducto } from "@/lib/variantes";
import MarcaDetail from "@/components/MarcaDetail";

export const dynamic = "force-dynamic";

export default async function MarcaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const [marcaRes, subcategoriasRes, productosRes, contenidoAsesor, variantesPorProducto] = await Promise.all([
    supabase.from("marcas").select("*").eq("id_marca", id).maybeSingle(),
    supabase
      .from("subcategorias")
      .select("*")
      .eq("id_marca", id)
      .order("nombre", { ascending: true }),
    supabase.from("productos").select("*").eq("id_marca", id).order("nombre", { ascending: true }),
    fetchContenidoAsesor(supabase),
    fetchVariantesPorProducto(supabase),
  ]);

  if (!marcaRes.data) notFound();

  // Las tasas con las que se calcula lo que le queda a la marca: su producto no
  // es de WiiGo, así que lo que se le descuenta no son los costos de WiiGo.
  const { data: cfg } = await supabase
    .from("configuracion")
    .select("parametro, valor")
    .in("parametro", [
      "IVA_GENERAL_PORCENTAJE",
      "SIRCREB_PORCENTAJE",
      "IMP_CREDITOS_PORCENTAJE",
      "IMP_DEBITOS_PORCENTAJE",
      "MP_COMISION_DINERO_CUENTA",
      "MP_COMISION_DEBITO",
      "MP_COMISION_CREDITO",
    ]);
  const c = new Map((cfg ?? []).map((x) => [x.parametro as string, Number(x.valor ?? 0)]));

  return (
    <MarcaDetail
      tasas={{
        impCreditos: c.get("IMP_CREDITOS_PORCENTAJE") ?? 0,
        impDebitos: c.get("IMP_DEBITOS_PORCENTAJE") ?? 0,
        sircreb: c.get("SIRCREB_PORCENTAJE") ?? 0,
        ivaGeneral: c.get("IVA_GENERAL_PORCENTAJE") ?? 21,
        mpPorMedio: {
          MP_COMISION_DINERO_CUENTA: c.get("MP_COMISION_DINERO_CUENTA") ?? 0,
          MP_COMISION_DEBITO: c.get("MP_COMISION_DEBITO") ?? 0,
          MP_COMISION_CREDITO: c.get("MP_COMISION_CREDITO") ?? 0,
        },
      }}
      marca={marcaRes.data as Marca}
      subcategorias={(subcategoriasRes.data ?? []) as Subcategoria[]}
      productos={(productosRes.data ?? []) as Producto[]}
      objetivosGlobales={contenidoAsesor.objetivosGlobales}
      filtrosGlobales={contenidoAsesor.filtrosGlobales}
      fichaPorProducto={contenidoAsesor.fichaPorProducto}
      objetivosPorProducto={contenidoAsesor.objetivosPorProducto}
      filtrosPorProducto={contenidoAsesor.filtrosPorProducto}
      variantesPorProducto={variantesPorProducto}
    />
  );
}
