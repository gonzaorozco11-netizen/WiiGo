import type { SupabaseClient } from "@supabase/supabase-js";

// Qué le falta a la ficha de una profesional, para mostrárselo en su espacio
// ("Te faltan 3 cosas"). Las primeras seis son las mismas que mira la
// ficha interna para el anillo de completitud; las demás son las que hacen
// que la ficha de la pantalla del local se vea completa.

export type ItemCompletitud = {
  clave: string;
  label: string;
  ayuda: string;
  ok: boolean;
};

export async function completitudProfesional(supabase: SupabaseClient, idProfesional: string) {
  const [pRes, fortRes, objRes, formRes, galRes, vidRes] = await Promise.all([
    supabase
      .from("profesionales")
      .select("foto, titulo, especialidad, bio, biografia_completa, tipo_atencion, link_reserva, id_consultorio, precio_presencial, precio_online")
      .eq("id_profesional", idProfesional)
      .maybeSingle(),
    supabase.from("profesional_fortalezas").select("id_fortaleza").eq("id_profesional", idProfesional),
    supabase.from("profesional_objetivos").select("id_objetivo").eq("id_profesional", idProfesional),
    supabase.from("formacion_profesional").select("institucion, anio").eq("id_profesional", idProfesional),
    supabase.from("galeria_profesional").select("publico").eq("id_profesional", idProfesional),
    supabase.from("videos_profesional").select("url").eq("id_profesional", idProfesional),
  ]);
  const p = pRes.data;

  // El link de turnos puede venir del consultorio que comparte con otras.
  let linkConsultorio: string | null = null;
  if (p?.id_consultorio) {
    const { data: c } = await supabase.from("consultorios").select("link_reserva").eq("id_consultorio", p.id_consultorio).maybeSingle();
    linkConsultorio = (c?.link_reserva as string | null) ?? null;
  }

  const formacion = formRes.data ?? [];
  const fotosPublicas = (galRes.data ?? []).filter((g) => g.publico !== false).length;

  const items: ItemCompletitud[] = [
    { clave: "foto", label: "Tu foto", ayuda: "Es lo primero que se ve en la pantalla.", ok: Boolean(p?.foto) },
    { clave: "titulo", label: "Título y especialidad", ayuda: "Por ejemplo: Lic. en Nutrición · Nutrición deportiva.", ok: Boolean(p?.titulo && p?.especialidad) },
    { clave: "bio", label: "Presentación corta", ayuda: "Dos o tres líneas sobre cómo trabajás.", ok: Boolean(p?.bio) },
    { clave: "fortalezas", label: "En qué te destacás", ayuda: "Elegí dos o tres fortalezas.", ok: (fortRes.data ?? []).length > 0 },
    { clave: "objetivos", label: "En qué ayudás", ayuda: "Los objetivos de tus pacientes: bajar de peso, rendir más…", ok: (objRes.data ?? []).length > 0 },
    { clave: "turnos", label: "Cómo sacar turno", ayuda: "Presencial, online y el link de tu agenda.", ok: Boolean(p?.tipo_atencion && (p?.link_reserva || linkConsultorio)) },
    { clave: "historia", label: "Contá tu historia", ayuda: "Es lo primero que se lee en Conóceme.", ok: Boolean(p?.biografia_completa) },
    { clave: "precio", label: "Precio de tu consulta", ayuda: "Presencial, online o los dos.", ok: p?.precio_presencial != null || p?.precio_online != null },
    {
      clave: "formacion",
      label: "Dónde y cuándo estudiaste",
      ayuda: formacion.length === 0 ? "Tus títulos, posgrados y cursos." : "Sumá la institución o el año a cada título.",
      ok: formacion.length > 0 && formacion.every((f) => f.institucion || f.anio),
    },
    {
      clave: "fotos",
      label: "Al menos 5 fotos",
      ayuda: fotosPublicas === 0 ? "Vos atendiendo, midiendo o dando una charla." : `Tenés ${fotosPublicas}. Con 5 tu ficha queda completa.`,
      ok: fotosPublicas >= 5,
    },
    { clave: "video", label: "Un video", ayuda: "Un link de Instagram o YouTube.", ok: (vidRes.data ?? []).length > 0 },
  ];

  const listos = items.filter((i) => i.ok).length;
  return { items, listos, porcentaje: Math.round((listos / items.length) * 100) };
}
