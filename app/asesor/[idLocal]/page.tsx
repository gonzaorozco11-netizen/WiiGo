import { notFound } from "next/navigation";
import {
  getSupabaseServerClient,
  type Local,
  type Producto,
  type Subcategoria,
  type ProfesionalPublico,
  type ConsultorioEnFicha,
  type FormacionProfesional,
  type TrayectoriaProfesional,
  type ConocemeSlide,
  type ProductoPublico,
  type VarianteProductoPublica,
  COLUMNAS_PRODUCTO_PUBLICO,
  COLUMNAS_VARIANTE_PUBLICA,
  COLUMNAS_PROFESIONAL_PUBLICO,
  traerMarcasPublicas,
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
    variantesRes,
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
    miembrosRes,
    consultoriosRes,
  ] = await Promise.all([
    // Columnas explícitas: con "*" viajaban al navegador el royalty, el fee de
    // ingreso, el plan y el contacto de cada marca. Esta pantalla es pública.
    traerMarcasPublicas(supabase, { soloVisiblesEnAsesor: true }),
    supabase.from("productos").select(COLUMNAS_PRODUCTO_PUBLICO).eq("estado", "ACTIVO").eq("visible_asesor", true),
    supabase.from("variantes_producto").select(COLUMNAS_VARIANTE_PUBLICA).eq("estado", "ACTIVO"),
    supabase.from("subcategorias").select("*").eq("estado", "ACTIVA"),
    supabase.from("profesionales").select(COLUMNAS_PROFESIONAL_PUBLICO).eq("estado", "ACTIVO").eq("publicado", true).order("orden", { ascending: true }),
    supabase.from("fortalezas_profesional").select("*").eq("estado", "ACTIVA"),
    supabase.from("profesional_fortalezas").select("id_profesional, id_fortaleza, principal"),
    supabase.from("profesional_objetivos").select("id_profesional, id_objetivo"),
    supabase.from("filminas_profesional").select("*").eq("visible", true).order("orden", { ascending: true }),
    supabase.from("galeria_profesional").select("id_foto, id_profesional, url, publico, orden"),
    supabase.from("videos_profesional").select("id_video, id_profesional, url, titulo"),
    supabase.from("formacion_profesional").select("*").eq("publico", true).order("anio", { ascending: false }),
    supabase.from("trayectoria_profesional").select("*").eq("publico", true).order("orden", { ascending: true }),
    fetchContenidoAsesor(supabase),
    // Aparte de la lista: si todavía no se corrió sql/profesionales-consultorios.sql
    // estas dos fallan solas y la pantalla sigue andando como antes.
    supabase
      .from("profesionales")
      .select("id_profesional, id_consultorio")
      .eq("estado", "ACTIVO")
      .eq("publicado", true)
      .not("id_consultorio", "is", null),
    supabase.from("consultorios").select("id_consultorio, nombre, link_reserva, link_reserva_online").eq("estado", "ACTIVO"),
  ]);

  // Las que comparten consultorio usan su agenda: el botón de turno abre el
  // link del consultorio, y la ficha muestra con quién atiende.
  const profesionales = (profesionalesRes.data ?? []) as ProfesionalPublico[];
  const consultorioPorProfesional: Record<string, ConsultorioEnFicha> = {};
  if (!miembrosRes.error && !consultoriosRes.error) {
    const miembros = (miembrosRes.data ?? []) as { id_profesional: string; id_consultorio: string }[];
    const consultorioPorId = new Map(
      ((consultoriosRes.data ?? []) as { id_consultorio: string; nombre: string; link_reserva: string | null; link_reserva_online: string | null }[]).map(
        (c) => [c.id_consultorio, c]
      )
    );
    const profesionalPorId = new Map(profesionales.map((p) => [p.id_profesional, p]));
    for (const m of miembros) {
      const consultorio = consultorioPorId.get(m.id_consultorio);
      const profesional = profesionalPorId.get(m.id_profesional);
      if (!consultorio || !profesional) continue;
      if (consultorio.link_reserva) profesional.link_reserva = consultorio.link_reserva;
      if (consultorio.link_reserva_online) profesional.link_reserva_online = consultorio.link_reserva_online;
      consultorioPorProfesional[m.id_profesional] = {
        nombre: consultorio.nombre,
        companeras: miembros
          .filter((o) => o.id_consultorio === m.id_consultorio && o.id_profesional !== m.id_profesional)
          .flatMap((o) => {
            const p = profesionalPorId.get(o.id_profesional);
            return p ? [{ id_profesional: p.id_profesional, nombre: `${p.nombre}${p.apellido ? ` ${p.apellido}` : ""}`, foto: p.foto }] : [];
          }),
      };
    }
  }

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

  // La galería se ve en la ficha, no solo dentro de "Conóceme": antes una foto
  // subida que no estaba en ninguna filmina no aparecía en ningún lado.
  const idsPublicados = new Set(profesionales.map((p) => p.id_profesional));
  const fotosPorProfesional: Record<string, string[]> = {};
  ((galeriaRes.data ?? []) as { id_profesional: string; url: string; publico: boolean | null; orden: number | null }[])
    .filter((f) => f.publico !== false && idsPublicados.has(f.id_profesional))
    .sort((a, b) => (a.orden ?? 9999) - (b.orden ?? 9999))
    .forEach((f) => (fotosPorProfesional[f.id_profesional] ??= []).push(f.url));

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

  // Los sabores/presentaciones que se muestran en la ficha. Se agrupan acá y
  // no en el cliente para no mandarle al tótem variantes de productos que ni
  // siquiera están visibles en el asesor.
  const idsVisibles = new Set((productosRes.data ?? []).map((p: ProductoPublico) => p.id_producto));
  const variantesPorProducto: Record<string, VarianteProductoPublica[]> = {};
  ((variantesRes.data ?? []) as VarianteProductoPublica[]).forEach((v) => {
    if (!idsVisibles.has(v.id_producto)) return;
    (variantesPorProducto[v.id_producto] ??= []).push(v);
  });
  Object.values(variantesPorProducto).forEach((lista) =>
    lista.sort((a, b) => (a.orden ?? 9999) - (b.orden ?? 9999) || a.nombre.localeCompare(b.nombre, "es"))
  );

  const trayectoriaPorProfesional: Record<string, TrayectoriaProfesional[]> = {};
  (trayectoriaRes.data ?? []).forEach((t: TrayectoriaProfesional) => {
    (trayectoriaPorProfesional[t.id_profesional] ??= []).push(t);
  });

  return (
    <AsesorApp
      local={local as Local}
      marcas={marcasRes.marcas}
      productos={(productosRes.data ?? []) as ProductoPublico[]}
      variantesPorProducto={variantesPorProducto}
      subcategorias={(subcategoriasRes.data ?? []) as Subcategoria[]}
      profesionales={profesionales}
      consultorioPorProfesional={consultorioPorProfesional}
      fotosPorProfesional={fotosPorProfesional}
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
