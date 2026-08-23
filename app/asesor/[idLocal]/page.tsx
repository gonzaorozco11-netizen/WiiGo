import { notFound } from "next/navigation";
import {
  getSupabaseServerClient,
  type Local,
  type Marca,
  type Producto,
  type Subcategoria,
  type Profesional,
  type FormacionProfesional,
  type TrayectoriaProfesional,
  type ConocemeSlide,
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

  const [
    marcasRes,
    productosRes,
    subcategoriasRes,
    profesionalesRes,
    fortalezasRes,
    profFortalezasRes,
    profObjetivosRes,
    filminasRes,
    galeriaRes,
    videosRes,
    formacionRes,
    trayectoriaRes,
    contenido,
  ] = await Promise.all([
    supabase.from("marcas").select("*").eq("estado", "ACTIVA").eq("visible_asesor", true),
    supabase.from("productos").select("*").eq("estado", "ACTIVO").eq("visible_asesor", true),
    supabase.from("subcategorias").select("*").eq("estado", "ACTIVA"),
    supabase.from("profesionales").select("*").eq("estado", "ACTIVO").eq("publicado", true).order("orden", { ascending: true }),
    supabase.from("fortalezas_profesional").select("*").eq("estado", "ACTIVA"),
    supabase.from("profesional_fortalezas").select("id_profesional, id_fortaleza, principal"),
    supabase.from("profesional_objetivos").select("id_profesional, id_objetivo"),
    supabase.from("filminas_profesional").select("*").eq("visible", true).order("orden", { ascending: true }),
    supabase.from("galeria_profesional").select("id_foto, id_profesional, url"),
    supabase.from("videos_profesional").select("id_video, id_profesional, url, titulo"),
    supabase.from("formacion_profesional").select("*").eq("publico", true).order("anio", { ascending: false }),
    supabase.from("trayectoria_profesional").select("*").eq("publico", true).order("orden", { ascending: true }),
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

  const fotoUrlPorId: Record<string, string> = {};
  (galeriaRes.data ?? []).forEach((f: { id_foto: string; url: string }) => {
    fotoUrlPorId[f.id_foto] = f.url;
  });

  const videoPorId: Record<string, { url: string; titulo: string }> = {};
  (videosRes.data ?? []).forEach((v: { id_video: string; url: string; titulo: string }) => {
    videoPorId[v.id_video] = { url: v.url, titulo: v.titulo };
  });

  const conocemePorProfesional: Record<string, ConocemeSlide[]> = {};
  (filminasRes.data ?? []).forEach(
    (f: { id_filmina: string; id_profesional: string; tipo: string; titulo: string | null; texto: string | null; id_foto: string | null; id_video: string | null }) => {
      const video = f.id_video ? videoPorId[f.id_video] : null;
      (conocemePorProfesional[f.id_profesional] ??= []).push({
        id_filmina: f.id_filmina,
        tipo: f.tipo as ConocemeSlide["tipo"],
        titulo: f.titulo,
        texto: f.texto,
        fotoUrl: f.id_foto ? (fotoUrlPorId[f.id_foto] ?? null) : null,
        videoUrl: video?.url ?? null,
        videoTitulo: video?.titulo ?? null,
      });
    }
  );

  const formacionPorProfesional: Record<string, FormacionProfesional[]> = {};
  (formacionRes.data ?? []).forEach((f: FormacionProfesional) => {
    (formacionPorProfesional[f.id_profesional] ??= []).push(f);
  });

  const trayectoriaPorProfesional: Record<string, TrayectoriaProfesional[]> = {};
  (trayectoriaRes.data ?? []).forEach((t: TrayectoriaProfesional) => {
    (trayectoriaPorProfesional[t.id_profesional] ??= []).push(t);
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
      conocemePorProfesional={conocemePorProfesional}
      formacionPorProfesional={formacionPorProfesional}
      trayectoriaPorProfesional={trayectoriaPorProfesional}
      objetivos={contenido.objetivosGlobales}
      filtros={contenido.filtrosGlobales}
      fichaPorProducto={contenido.fichaPorProducto}
      objetivosPorProducto={contenido.objetivosPorProducto}
      filtrosPorProducto={contenido.filtrosPorProducto}
    />
  );
}
