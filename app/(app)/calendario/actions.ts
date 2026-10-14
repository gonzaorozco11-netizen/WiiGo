"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionConPermisos } from "@/lib/permisos";
import { fechaHoraArgentina } from "@/lib/horarios";
import { armarAlmanaque, type MesAlmanaque } from "@/lib/eventos";
import type { AlcanceEvento, EstadoParticipacion, OrdenEntrada, TipoEvento } from "@/lib/eventos";
import type { PlanMarca } from "@/lib/planesMarca";

// El calendario del lado de WiiGo: cargar lo que viene, aprobar lo que
// proponen las marcas y repartir los lugares.

/**
 * Cuántos meses de almanaque se dibujan.
 *
 * Los mismos que ve la marca, con la misma función: si cada lado armara el
 * suyo, el día que cambie un color quedan dos calendarios distintos para el
 * mismo local.
 */
const MESES_ALMANAQUE = 3;

async function sesionInterna() {
  const sesion = await obtenerSesionConPermisos();
  // Un usuario de marca no entra acá ni con la URL a mano.
  if (!sesion || sesion.rol === "marca") return null;
  return sesion;
}

export type MarcaEnEvento = {
  idMarca: string;
  nombre: string;
  plan: PlanMarca;
  estado: EstadoParticipacion;
};

export type EventoAdmin = {
  idEvento: string;
  nombre: string;
  tipo: TipoEvento;
  descripcion: string | null;
  fechaDesde: string;
  fechaHasta: string;
  /** Null cuando dura todo el día. */
  horaDesde: string | null;
  horaHasta: string | null;
  alcance: AlcanceEvento;
  cupo: number | null;
  ordenEntrada: OrdenEntrada;
  visibleParaTodas: boolean;
  estado: string;
  /** Null si lo armó WiiGo. */
  marcaPropone: string | null;
  /** Lo que la marca va a meter adentro del local: promotora, muestras, mesa. */
  trae: string | null;
  marcas: MarcaEnEvento[];
};

export type CalendarioAdmin = {
  hoy: string;
  propuestas: EventoAdmin[];
  proximos: EventoAdmin[];
  marcas: { idMarca: string; nombre: string; plan: PlanMarca }[];
  almanaque: MesAlmanaque[];
};

export async function calendarioAdmin(): Promise<CalendarioAdmin | null> {
  if (!(await sesionInterna())) return null;

  const supabase = getSupabaseServerClient();
  const hoy = fechaHoraArgentina().fecha;

  const [{ data: eventos }, { data: marcas }] = await Promise.all([
    supabase
      .from("eventos")
      .select(
        "id_evento, nombre, tipo, descripcion, fecha_desde, fecha_hasta, hora_desde, hora_hasta, alcance, cupo, orden_entrada, visible_para_todas, estado, id_marca_propone, trae"
      )
      .gte("fecha_hasta", hoy)
      .neq("estado", "CANCELADO")
      .order("fecha_desde", { ascending: true }),
    supabase.from("marcas").select("id_marca, nombre, plan").eq("estado", "ACTIVA").order("nombre"),
  ]);

  const nombrePorMarca = new Map(
    (marcas ?? []).map((m) => [m.id_marca as string, (m.nombre as string) ?? "Marca"])
  );
  const planPorMarca = new Map(
    (marcas ?? []).map((m) => [m.id_marca as string, ((m.plan as PlanMarca) ?? "BRONCE") as PlanMarca])
  );

  const ids = (eventos ?? []).map((e) => e.id_evento as string);
  const { data: participaciones } = ids.length
    ? await supabase.from("eventos_marcas").select("id_evento, id_marca, estado").in("id_evento", ids)
    : { data: [] as Record<string, unknown>[] };

  const porEvento = new Map<string, MarcaEnEvento[]>();
  for (const p of participaciones ?? []) {
    const idE = p.id_evento as string;
    const idM = p.id_marca as string;
    porEvento.set(idE, [
      ...(porEvento.get(idE) ?? []),
      {
        idMarca: idM,
        nombre: nombrePorMarca.get(idM) ?? "Marca",
        plan: planPorMarca.get(idM) ?? "BRONCE",
        estado: (p.estado as EstadoParticipacion) ?? "ANOTADA",
      },
    ]);
  }

  const armar = (e: Record<string, unknown>): EventoAdmin => ({
    idEvento: e.id_evento as string,
    nombre: (e.nombre as string) ?? "Evento",
    tipo: (e.tipo as TipoEvento) ?? "EVENTO",
    descripcion: (e.descripcion as string | null) ?? null,
    fechaDesde: e.fecha_desde as string,
    fechaHasta: e.fecha_hasta as string,
    horaDesde: (e.hora_desde as string | null) ?? null,
    horaHasta: (e.hora_hasta as string | null) ?? null,
    alcance: (e.alcance as AlcanceEvento) ?? "AVISO",
    cupo: (e.cupo as number | null) ?? null,
    ordenEntrada: (e.orden_entrada as OrdenEntrada) ?? "GOLD_PRIMERO",
    visibleParaTodas: Boolean(e.visible_para_todas),
    estado: (e.estado as string) ?? "BORRADOR",
    marcaPropone: e.id_marca_propone
      ? nombrePorMarca.get(e.id_marca_propone as string) ?? "Una marca"
      : null,
    trae: (e.trae as string | null) ?? null,
    marcas: porEvento.get(e.id_evento as string) ?? [],
  });

  const todos = (eventos ?? []).map(armar);
  const proximos = todos.filter((e) => e.estado !== "PROPUESTO" && e.estado !== "RECHAZADO");

  return {
    hoy,
    propuestas: todos.filter((e) => e.estado === "PROPUESTO"),
    proximos,
    marcas: (marcas ?? []).map((m) => ({
      idMarca: m.id_marca as string,
      nombre: (m.nombre as string) ?? "Marca",
      plan: ((m.plan as PlanMarca) ?? "BRONCE") as PlanMarca,
    })),
    // Solo lo que está en pie. Una propuesta sin aprobar todavía no ocupa el
    // local, y pintarla en el almanaque haría creer que el día ya está
    // tomado cuando la decisión es justamente la que falta.
    almanaque: armarAlmanaque(
      hoy,
      MESES_ALMANAQUE,
      proximos.map((e) => ({ tipo: e.tipo, fechaDesde: e.fechaDesde, fechaHasta: e.fechaHasta }))
    ),
  };
}

export async function guardarEvento(datos: {
  idEvento?: string | null;
  nombre: string;
  tipo: TipoEvento;
  descripcion: string;
  fechaDesde: string;
  fechaHasta: string;
  horaDesde: string;
  horaHasta: string;
  alcance: AlcanceEvento;
  cupo: number | null;
  ordenEntrada: OrdenEntrada;
  visibleParaTodas: boolean;
  /** true publica; false lo deja en borrador. */
  publicar: boolean;
  /** Solo con alcance INVITACION. */
  invitadas: string[];
}): Promise<{ error: string | null }> {
  const sesion = await sesionInterna();
  if (!sesion) return { error: "No tenés permiso para esto." };

  const nombre = datos.nombre.trim();
  if (!nombre) return { error: "Ponele un nombre." };
  if (!datos.fechaDesde) return { error: "Falta la fecha." };
  const hasta = datos.fechaHasta || datos.fechaDesde;
  if (hasta < datos.fechaDesde) {
    return { error: "La fecha de fin no puede ser anterior a la de inicio." };
  }
  if (datos.horaDesde && datos.horaHasta && datos.horaHasta <= datos.horaDesde) {
    return { error: "La hora de fin tiene que ser posterior a la de inicio." };
  }

  const supabase = getSupabaseServerClient();
  const fila = {
    nombre,
    tipo: datos.tipo,
    descripcion: datos.descripcion.trim() || null,
    fecha_desde: datos.fechaDesde,
    fecha_hasta: hasta,
    hora_desde: datos.horaDesde || null,
    hora_hasta: datos.horaHasta || null,
    alcance: datos.alcance,
    // Un aviso no tiene cupo ni orden: guardarlos igual deja números que
    // después nadie entiende de dónde salieron.
    cupo: datos.alcance === "ABIERTO" ? datos.cupo : null,
    orden_entrada: datos.alcance === "ABIERTO" ? datos.ordenEntrada : "LLEGADA",
    visible_para_todas: datos.alcance === "INVITACION" ? datos.visibleParaTodas : true,
    estado: datos.publicar ? "PUBLICADO" : "BORRADOR",
  };

  let idEvento = datos.idEvento ?? null;
  if (idEvento) {
    const { error } = await supabase.from("eventos").update(fila).eq("id_evento", idEvento);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await supabase
      .from("eventos")
      .insert({ ...fila, creado_por: sesion.idUsuario })
      .select("id_evento")
      .single();
    if (error) return { error: error.message };
    idEvento = data?.id_evento as string;
  }

  if (datos.alcance === "INVITACION" && idEvento) {
    // Se agregan las nuevas y no se tocan las que ya contestaron: sacarle la
    // invitación a una marca que ya dijo que sí la deja afuera sin aviso.
    const { data: ya } = await supabase
      .from("eventos_marcas")
      .select("id_marca")
      .eq("id_evento", idEvento);
    const tengo = new Set((ya ?? []).map((p) => p.id_marca as string));
    const nuevas = datos.invitadas.filter((m) => !tengo.has(m));
    if (nuevas.length) {
      await supabase
        .from("eventos_marcas")
        .insert(nuevas.map((idMarca) => ({ id_evento: idEvento, id_marca: idMarca, estado: "INVITADA" })));
    }
  }

  revalidatePath("/calendario");
  revalidatePath("/portal/calendario");
  return { error: null };
}

/** Aprobar lo que propuso una marca: pasa a PUBLICADO y la marca queda adentro. */
export async function aprobarPropuesta(idEvento: string): Promise<{ error: string | null }> {
  const sesion = await sesionInterna();
  if (!sesion) return { error: "No tenés permiso para esto." };

  const supabase = getSupabaseServerClient();
  const { data: e } = await supabase
    .from("eventos")
    .select("id_evento, estado, id_marca_propone")
    .eq("id_evento", idEvento)
    .maybeSingle();
  if (!e || e.estado !== "PROPUESTO") return { error: "Esa propuesta ya se resolvió." };

  const { error } = await supabase
    .from("eventos")
    .update({
      estado: "PUBLICADO",
      resuelto_por: sesion.idUsuario,
      resuelto_el: new Date().toISOString(),
    })
    .eq("id_evento", idEvento);
  if (error) return { error: error.message };

  // La que lo propuso entra confirmada: es su evento.
  if (e.id_marca_propone) {
    await supabase
      .from("eventos_marcas")
      .upsert(
        { id_evento: idEvento, id_marca: e.id_marca_propone as string, estado: "CONFIRMADA" },
        { onConflict: "id_evento,id_marca" }
      );
  }

  revalidatePath("/calendario");
  revalidatePath("/portal/calendario");
  return { error: null };
}

/** Rechazarla. El motivo es obligatorio: sin él se vuelve a proponer igual. */
export async function rechazarPropuesta(
  idEvento: string,
  motivo: string
): Promise<{ error: string | null }> {
  const sesion = await sesionInterna();
  if (!sesion) return { error: "No tenés permiso para esto." };
  if (!motivo.trim()) return { error: "Escribí por qué no se puede." };

  const { error } = await getSupabaseServerClient()
    .from("eventos")
    .update({
      estado: "RECHAZADO",
      motivo_rechazo: motivo.trim(),
      resuelto_por: sesion.idUsuario,
      resuelto_el: new Date().toISOString(),
    })
    .eq("id_evento", idEvento)
    .eq("estado", "PROPUESTO");
  if (error) return { error: error.message };

  revalidatePath("/calendario");
  revalidatePath("/portal/calendario");
  return { error: null };
}

/** Dar o sacar el lugar a una marca anotada. */
export async function resolverMarca(
  idEvento: string,
  idMarca: string,
  entra: boolean,
  motivo = ""
): Promise<{ error: string | null }> {
  const sesion = await sesionInterna();
  if (!sesion) return { error: "No tenés permiso para esto." };

  const { error } = await getSupabaseServerClient()
    .from("eventos_marcas")
    .update({
      estado: entra ? "CONFIRMADA" : "RECHAZADA",
      motivo: entra ? null : motivo.trim() || null,
      resuelto_el: new Date().toISOString(),
    })
    .eq("id_evento", idEvento)
    .eq("id_marca", idMarca);
  if (error) return { error: error.message };

  revalidatePath("/calendario");
  revalidatePath("/portal/calendario");
  return { error: null };
}
