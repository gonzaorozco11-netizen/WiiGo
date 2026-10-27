import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionProfesional } from "@/lib/profesionalSesion";
import { CAMPOS_DATOS, type TipoCambio } from "@/lib/cambiosProfesional";
import { leerRedes } from "@/lib/redesProfesional";
import FichaEditor, { type DatosFicha, type Pendiente } from "./FichaEditor";

export const dynamic = "force-dynamic";

export default async function FichaEspacio({ searchParams }: { searchParams: Promise<{ seccion?: string }> }) {
  const { seccion } = await searchParams;
  const sesion = await obtenerSesionProfesional();
  if (!sesion) redirect("/login?next=/mi-espacio/ficha");
  const id = sesion.idProfesional;
  const supabase = getSupabaseServerClient();

  const [pRes, galRes, formRes, trayRes, vidRes, fortRes, objRes, catFortRes, catObjRes, pendRes, redesRes] = await Promise.all([
    supabase.from("profesionales").select(`foto, telefono, email, ${Object.keys(CAMPOS_DATOS).join(", ")}`).eq("id_profesional", id).maybeSingle(),
    supabase.from("galeria_profesional").select("id_foto, url, titulo, publico, orden").eq("id_profesional", id).order("orden"),
    // Solo lo que se ve en la pantalla: lo que WiiGo dejó como no público no se le muestra ni se le borra.
    supabase.from("formacion_profesional").select("titulo, institucion, anio").eq("id_profesional", id).or("publico.is.null,publico.eq.true").order("orden"),
    supabase.from("trayectoria_profesional").select("titulo, lugar, anio_desde, anio_hasta").eq("id_profesional", id).or("publico.is.null,publico.eq.true").order("orden"),
    supabase.from("videos_profesional").select("titulo, url").eq("id_profesional", id).order("orden"),
    supabase.from("profesional_fortalezas").select("id_fortaleza, principal").eq("id_profesional", id),
    supabase.from("profesional_objetivos").select("id_objetivo").eq("id_profesional", id),
    supabase.from("fortalezas_profesional").select("id_fortaleza, nombre").eq("estado", "ACTIVA").order("nombre"),
    supabase.from("objetivos").select("id_objetivo, nombre").eq("estado", "ACTIVO").order("orden"),
    supabase
      .from("cambios_profesional")
      .select("id_cambio, tipo, valor_nuevo, estado, nota, fecha")
      .eq("id_profesional", id)
      .in("estado", ["PENDIENTE", "CORREGIR"])
      .order("fecha"),
    // Aparte: si todavía no se corrió sql/profesionales-redes.sql, esta falla
    // sola y el resto de la ficha anda igual.
    supabase.from("profesionales").select("redes").eq("id_profesional", id).maybeSingle(),
  ]);

  const p = (pRes.data ?? {}) as unknown as Record<string, string | number | null>;
  const datos: DatosFicha = {
    nombre: sesion.nombre,
    foto: (p.foto as string | null) ?? null,
    telefono: (p.telefono as string | null) ?? "",
    email: (p.email as string | null) ?? "",
    campos: Object.fromEntries(Object.keys(CAMPOS_DATOS).map((c) => [c, p[c] ?? null])) as DatosFicha["campos"],
    galeria: (galRes.data ?? []).map((g) => ({
      idFoto: g.id_foto as string,
      url: g.url as string,
      titulo: (g.titulo as string | null) ?? null,
      publico: g.publico !== false,
    })),
    formacion: (formRes.data ?? []).map((f) => ({ titulo: f.titulo as string, institucion: (f.institucion as string | null) ?? null, anio: (f.anio as number | null) ?? null })),
    trayectoria: (trayRes.data ?? []).map((t) => ({
      titulo: t.titulo as string,
      lugar: (t.lugar as string | null) ?? null,
      anio_desde: (t.anio_desde as number | null) ?? null,
      anio_hasta: (t.anio_hasta as number | null) ?? null,
    })),
    videos: (vidRes.data ?? []).map((v) => ({ titulo: (v.titulo as string | null) ?? null, url: v.url as string })),
    fortalezas: (fortRes.data ?? []).map((f) => ({ id_fortaleza: f.id_fortaleza as string, principal: Boolean(f.principal) })),
    objetivos: (objRes.data ?? []).map((o) => o.id_objetivo as string),
    catalogoFortalezas: (catFortRes.data ?? []).map((f) => ({ id: f.id_fortaleza as string, nombre: f.nombre as string })),
    catalogoObjetivos: (catObjRes.data ?? []).map((o) => ({ id: o.id_objetivo as string, nombre: o.nombre as string })),
    redes: leerRedes(redesRes.data?.redes),
    redesDisponible: !redesRes.error,
  };
  const pendientes: Pendiente[] = (pendRes.data ?? []).map((c) => ({
    idCambio: c.id_cambio as string,
    tipo: c.tipo as TipoCambio,
    valor: c.valor_nuevo,
    estado: c.estado as "PENDIENTE" | "CORREGIR",
    nota: (c.nota as string | null) ?? null,
  }));

  return (
    <main className="esp-lienzo">
      <FichaEditor datos={datos} pendientes={pendientes} seccionInicial={seccion} />
    </main>
  );
}
