import type { SupabaseClient } from "@supabase/supabase-js";
import { leerRedes } from "@/lib/redesProfesional";

// Los cambios que una profesional manda desde su espacio y que esperan la
// aprobación de Gonzalo antes de salir en la pantalla del local (tabla
// cambios_profesional, ver sql/profesionales-usuario.sql).
//
// Lo usan las dos puntas: su espacio (/mi-espacio) para guardar el pedido y la
// bandeja de Aprobaciones para mostrarlo y aplicarlo. Por eso vive acá y no en
// un archivo de server actions.

export type TipoCambio = "DATOS" | "FOTO_PERFIL" | "FOTO" | "FORMACION" | "TRAYECTORIA" | "VIDEOS" | "FORTALEZAS" | "OBJETIVOS" | "REDES";

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
  REDES: "Cambió sus redes",
};

export type ItemFormacion = { titulo: string; institucion: string | null; anio: number | null };
export type ItemTrayectoria = { titulo: string; lugar: string | null; anio_desde: number | null; anio_hasta: number | null };
export type ItemVideo = { titulo: string | null; url: string };
// Una fortaleza de la lista (id) o una que escribió ella (nuevo): esa se suma
// a la lista recién cuando Gonzalo la aprueba.
export type ItemFortaleza = { id_fortaleza: string | null; nuevo?: string | null; principal: boolean };
// En qué ayuda: los objetivos de la lista y los que escribió ella.
export type ValorObjetivos = { ids: string[]; nuevos: string[] };

/** Los pedidos viejos guardaban solo la lista de ids. */
export function leerObjetivos(valor: unknown): ValorObjetivos {
  if (Array.isArray(valor)) return { ids: valor.map(String), nuevos: [] };
  const v = (valor ?? {}) as { ids?: unknown; nuevos?: unknown };
  return {
    ids: Array.isArray(v.ids) ? v.ids.map(String) : [],
    nuevos: Array.isArray(v.nuevos) ? v.nuevos.map(String) : [],
  };
}

/** Un nombre escrito a mano, prolijo: sin espacios de más y con mayúscula al principio. */
export function limpiarNombre(v: unknown, maximo = 60): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, maximo);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Energía" y "energia " son el mismo objetivo: así no se duplican al aprobar. */
export function mismoNombre(a: string, b: string) {
  const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return plano(a) === plano(b);
}

/**
 * Arriba lo más viejo, abajo lo de hoy, como lo muestra la pantalla. Lo que no
 * tiene año va primero (la pantalla lo ordena igual) y entre ellos se respeta
 * el orden en que estaban.
 */
export function ordenarPorAnio<T>(lista: T[], anio: (x: T) => number | null): T[] {
  return lista
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (anio(a.x) ?? -1) - (anio(b.x) ?? -1) || a.i - b.i)
    .map((o) => o.x);
}

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
      .insert(items.map((f, i) => ({ id_profesional: idProfesional, titulo: f.titulo, institucion: f.institucion, anio: f.anio, orden: i, publico: true })));
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

  // Las nuevas se crean antes de borrar nada: si falla, su ficha queda como estaba.
  if (tipo === "FORTALEZAS") {
    const items = valor as ItemFortaleza[];
    const filas: { id_fortaleza: string; principal: boolean }[] = [];
    const nuevas = items.filter((f) => !f.id_fortaleza && f.nuevo);
    const { data: catalogo } = nuevas.length
      ? await supabase.from("fortalezas_profesional").select("id_fortaleza, nombre").eq("estado", "ACTIVA")
      : { data: [] as { id_fortaleza: string; nombre: string }[] };
    for (const f of items) {
      let id = f.id_fortaleza;
      if (!id && f.nuevo) {
        const igual = (catalogo ?? []).find((c) => mismoNombre(c.nombre as string, f.nuevo as string));
        if (igual) id = igual.id_fortaleza as string;
        else {
          const { data, error } = await supabase.from("fortalezas_profesional").insert({ nombre: f.nuevo, estado: "ACTIVA" }).select("id_fortaleza").single();
          if (error) return error.message;
          id = data.id_fortaleza as string;
        }
      }
      if (id && !filas.some((x) => x.id_fortaleza === id)) filas.push({ id_fortaleza: id, principal: f.principal });
    }
    await supabase.from("profesional_fortalezas").delete().eq("id_profesional", idProfesional);
    if (filas.length === 0) return null;
    const { error } = await supabase.from("profesional_fortalezas").insert(filas.map((f) => ({ id_profesional: idProfesional, ...f })));
    return error?.message ?? null;
  }

  // Un objetivo nuevo se suma a la lista de WiiGo. En "¿Cuál es tu objetivo?"
  // aparece recién cuando tiene productos asignados en Catálogo asesor.
  if (tipo === "OBJETIVOS") {
    const { ids, nuevos } = leerObjetivos(valor);
    const todos = [...ids];
    if (nuevos.length > 0) {
      const { data: catalogo } = await supabase.from("objetivos").select("id_objetivo, nombre, orden, estado");
      let orden = Math.max(0, ...(catalogo ?? []).map((o) => (o.orden as number | null) ?? 0)) + 1;
      for (const nombre of nuevos) {
        const igual = (catalogo ?? []).find((o) => o.estado === "ACTIVO" && mismoNombre(o.nombre as string, nombre));
        if (igual) {
          todos.push(igual.id_objetivo as string);
          continue;
        }
        const { data, error } = await supabase.from("objetivos").insert({ nombre, estado: "ACTIVO", orden: orden++ }).select("id_objetivo").single();
        if (error) return error.message;
        todos.push(data.id_objetivo as string);
      }
    }
    const unicos = [...new Set(todos)];
    await supabase.from("profesional_objetivos").delete().eq("id_profesional", idProfesional);
    if (unicos.length === 0) return null;
    const { error } = await supabase
      .from("profesional_objetivos")
      .insert(unicos.map((id) => ({ id_profesional: idProfesional, id_objetivo: id })));
    return error?.message ?? null;
  }

  if (tipo === "REDES") {
    const redes = leerRedes(valor);
    const { error } = await supabase
      .from("profesionales")
      .update({ redes: Object.keys(redes).length > 0 ? redes : null })
      .eq("id_profesional", idProfesional);
    return error?.message ?? null;
  }

  return "Tipo de cambio desconocido";
}
