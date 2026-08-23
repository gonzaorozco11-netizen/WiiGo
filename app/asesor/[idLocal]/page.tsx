import { notFound } from "next/navigation";
import {
  getSupabaseServerClient,
  type Local,
  type Marca,
  type Producto,
  type Subcategoria,
  type Profesional,
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

  const [marcasRes, productosRes, subcategoriasRes, profesionalesRes, fortalezasRes, profFortalezasRes, profObjetivosRes, contenido] =
    await Promise.all([
      supabase.from("marcas").select("*").eq("estado", "ACTIVA").eq("visible_asesor", true),
      supabase.from("productos").select("*").eq("estado", "ACTIVO").eq("visible_asesor", true),
      supabase.from("subcategorias").select("*").eq("estado", "ACTIVA"),
      supabase.from("profesionales").select("*").eq("estado", "ACTIVO").eq("publicado", true).order("orden", { ascending: true }),
      supabase.from("fortalezas_profesional").select("*").eq("estado", "ACTIVA"),
      supabase.from("profesional_fortalezas").select("id_profesional, id_fortaleza, principal"),
      supabase.from("profesional_objetivos").select("id_profesional, id_objetivo"),
      fetchContenidoAsesor(supabase),
    ]);

  const fortalezaPorId: Record<string, string> = {};
  (fortalezasRes.data ?? []).forEach((f: { id_fortaleza: string; nombre: string }) => {
    fortalezaPorId[f.id_fortaleza] = f.nombre;
  });

  const fortalezasPorProfesional: Record<string, { nombre: string; principal: boolean }[]> = {};
  (profFortalezasRes.data ?? []).forEach((row: { id_profesional: string; id_fortaleza: string; principal: boolean }) => {
    const nombre = fortalezaPorId[row.id_fortaleza];
    if (!nombre) return;
    (fortalezasPorProfesional[row.id_profesional] ??= []).push({ nombre, principal: row.principal });
  });

  const objetivosPorProfesional: Record<string, string[]> = {};
  (profObjetivosRes.data ?? []).forEach((row: { id_profesional: string; id_objetivo: string }) => {
    (objetivosPorProfesional[row.id_profesional] ??= []).push(row.id_objetivo);
  });

  return (
    <AsesorApp
      local={local as Local}
      marcas={(marcasRes.data ?? []) as Marca[]}
      productos={(productosRes.data ?? []) as Producto[]}
      subcategorias={(subcategoriasRes.data ?? []) as Subcategoria[]}
      profesionales={(profesionalesRes.data ?? []) as Profesional[]}
      fortalezasPorProfesional={fortalezasPorProfesional}
      objetivosPorProfesional={objetivosPorProfesional}
      objetivos={contenido.objetivosGlobales}
      filtros={contenido.filtrosGlobales}
      fichaPorProducto={contenido.fichaPorProducto}
      objetivosPorProducto={contenido.objetivosPorProducto}
      filtrosPorProducto={contenido.filtrosPorProducto}
    />
  );
}
