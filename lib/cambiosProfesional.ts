import type { SupabaseClient } from "@supabase/supabase-js";

// Los cambios que una profesional manda desde su espacio y que esperan la
// aprobación de Gonzalo antes de salir en la pantalla del local (tabla
// cambios_profesional, ver sql/profesionales-usuario.sql).
//
// Lo usan las dos puntas: su espacio (/mi-espacio) para guardar el pedido y la
// bandeja de Aprobaciones para mostrarlo y aplicarlo. Por eso vive acá y no en
// un archivo de server actions.

export type TipoCambio = "DATOS" | "FOTO_PERFIL" | "FOTO" | "FORMACION" | "TRAYECTORIA" | "VIDEOS" | "FORTALEZAS" | "OBJETIVOS";

// Los únicos campos de su ficha que puede cambiar ella. Lo demás (publicada,
// código, links de turnos, consultorio, observaciones) lo maneja WiiGo.
export const CAMPOS_DATOS = {
  titulo: "Título",
  especialidad: "Especialidad",
  bio: "Presentación corta",
  biografia_completa: "Su historia",
  matricula: "Matrícula",
  ciudad: "Ciudad",
  tipo_atencion: "Cómo atiende",
  precio_presencial: "Precio presencial",
  precio_online: "Precio online",
} as const;
export type CampoDatos = keyof typeof CAMPOS_DATOS;
export const CAMPOS_NUMERICOS: CampoDatos[] = ["precio_presencial", "precio_online"];

export const QUE_HIZO: Record<TipoCambio, string> = {
  DATOS: "Cambió los datos de su ficha",
  FOTO_PERFIL: "Cambió su foto de perfil",
  FOTO: "Subió una foto",
  FORMACION: "Cambió su formación",
  TRAYECTORIA: "Cambió su recorrido",
  VIDEOS: "Cambió sus videos",
  FORTALEZAS: "Cambió en qué se destaca",
  OBJETIVOS: "Cambió en qué ayuda",
};

export type ItemFormacion = { titulo: string; institucion: string | null; anio: number | null };
export type ItemTrayectoria = { titulo: string; lugar: string | null; anio_desde: number | null; anio_hasta: number | null };
export type ItemVideo = { titulo: string | null; url: string };
export type ItemFortaleza = { id_fortaleza: string; principal: boolean };

/**
 * Aplica un cambio aprobado sobre la ficha real. Devuelve el error en texto
 * para mostrarlo en la bandeja; si algo falla, el cambio queda pendiente.
 */
export async function aplicarCambioProfesional(
  supabase: SupabaseClient,
  idProfesional: string,
  tipo: TipoCambio,
  valor: unknown
): Promise<string | null> {
  if (tipo === "DATOS") {
    const datos = valor as Record<string, unknown>;
    const limpio: Record<string, unknown> = {};
    for (const campo of Object.keys(CAMPOS_DATOS) as CampoDatos[]) {
      if (campo in datos) limpio[campo] = datos[campo];
    }
    const { error } = await supabase.from("profesionales").update(limpio).eq("id_profesional", idProfesional);
    return error?.message ?? null;
  }

  if (tipo === "FOTO_PERFIL") {
    const { url } = valor as { url: string };
    const { error } = await supabase.from("profesionales").update({ foto: url }).eq("id_profesional", idProfesional);
    return error?.message ?? null;
  }

  if (tipo === "FOTO") {
    const { url, titulo } = valor as { url: string; titulo: string | null };
    const { data: ultima } = await supabase
      .from("galeria_profesional")
      .select("orden")
      .eq("id_profesional", idProfesional)
      .order("orden", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase.from("galeria_profesional").insert({
      id_profesional: idProfesional,
      url,
      titulo,
      publico: true,
      orden: ((ultima?.orden as number | null) ?? -1) + 1,
    });
    return error?.message ?? null;
  }

  // Las listas se reemplazan enteras: lo que mandó es la lista completa como
  // quiere que quede. En formación y recorrido solo se reemplaza lo que se ve
  // en la pantalla: lo que Gonzalo marcó como no público ella no lo ve en su
  // espacio, así que tampoco se le borra.
  if (tipo === "FORMACION") {
    const items = valor as ItemFormacion[];
    await supabase.from("formacion_profesional").delete().eq("id_profesional", idProfesional).or("publico.is.null,publico.eq.true");
    if (items.length === 0) return null;
    const { error } = await supabase
      .from("formacion_profesional")
      .insert(items.map((f) => ({ id_profesional: idProfesional, titulo: f.titulo, institucion: f.institucion, anio: f.anio, publico: true })));
    return error?.message ?? null;
  }

  if (tipo === "TRAYECTORIA") {
    const items = valor as ItemTrayectoria[];
    await supabase.from("trayectoria_profesional").delete().eq("id_profesional", idProfesional).or("publico.is.null,publico.eq.true");
    if (items.length === 0) return null;
    const { error } = await supabase.from("trayectoria_profesional").insert(
      items.map((t, i) => ({
        id_profesional: idProfesional,
        titulo: t.titulo,
        lugar: t.lugar,
        anio_desde: t.anio_desde,
        anio_hasta: t.anio_hasta,
        orden: i,
        publico: true,
      }))
    );
    return error?.message ?? null;
  }

  if (tipo === "VIDEOS") {
    const items = valor as ItemVideo[];
    await supabase.from("videos_profesional").delete().eq("id_profesional", idProfesional);
    if (items.length === 0) return null;
    const { error } = await supabase
      .from("videos_profesional")
      .insert(items.map((v, i) => ({ id_profesional: idProfesional, titulo: v.titulo, url: v.url, orden: i })));
    return error?.message ?? null;
  }

  if (tipo === "FORTALEZAS") {
    const items = valor as ItemFortaleza[];
    await supabase.from("profesional_fortalezas").delete().eq("id_profesional", idProfesional);
    if (items.length === 0) return null;
    const { error } = await supabase
      .from("profesional_fortalezas")
      .insert(items.map((f) => ({ id_profesional: idProfesional, id_fortaleza: f.id_fortaleza, principal: f.principal })));
    return error?.message ?? null;
  }

  if (tipo === "OBJETIVOS") {
    const ids = valor as string[];
    await supabase.from("profesional_objetivos").delete().eq("id_profesional", idProfesional);
    if (ids.length === 0) return null;
    const { error } = await supabase
      .from("profesional_objetivos")
      .insert(ids.map((id) => ({ id_profesional: idProfesional, id_objetivo: id })));
    return error?.message ?? null;
  }

  return "Tipo de cambio desconocido";
}
