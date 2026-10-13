"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { obtenerSesionMarca } from "@/lib/marcaSesion";
import { fechaHoraArgentina } from "@/lib/horarios";
import {
  armarAlmanaque,
  diasHasta,
  entraDeUna,
  puedeAnotarse,
  type AlcanceEvento,
  type EstadoParticipacion,
  type MesAlmanaque,
  type OrdenEntrada,
  type TipoEvento,
} from "@/lib/eventos";
import type { PlanMarca } from "@/lib/planesMarca";

// El calendario del lado de la marca.
//
// Ninguna función recibe el idMarca por parámetro: sale de la sesión. Un
// archivo "use server" expone cada función como endpoint, así que un parámetro
// sería el agujero por donde una marca se anota en nombre de otra.

/** Cuántos meses de almanaque se dibujan. */
const MESES_ALMANAQUE = 3;

export type EventoPortal = {
  idEvento: string;
  nombre: string;
  tipo: TipoEvento;
  descripcion: string | null;
  fechaDesde: string;
  fechaHasta: string;
  alcance: AlcanceEvento;
  cupo: number | null;
  ordenEntrada: OrdenEntrada;
  /** Cuántos lugares ya están tomados (confirmadas + anotadas). */
  tomados: number;
  /** Dónde está parada esta marca. Null si no tiene nada que ver con ella. */
  miEstado: EstadoParticipacion | null;
  /** Lo propuso ella y todavía no se resolvió. */
  esMiPropuesta: boolean;
  /** Puede tocar "Anotarme" ahora mismo. */
  puedoAnotarme: boolean;
  diasFaltan: number;
};

export type CalendarioPortal = {
  plan: PlanMarca;
  hoy: string;
  eventos: EventoPortal[];
  almanaque: MesAlmanaque[];
};

export async function calendarioPortal(): Promise<CalendarioPortal | null> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const hoy = fechaHoraArgentina().fecha;

  // Lo que ya pasó no se muestra: el calendario es para prepararse, no para
  // repasar. Un evento de varios días sigue vigente hasta el último.
  const { data: filas } = await supabase
    .from("eventos")
    .select(
      "id_evento, nombre, tipo, descripcion, fecha_desde, fecha_hasta, alcance, cupo, orden_entrada, visible_para_todas, estado, id_marca_propone"
    )
    .gte("fecha_hasta", hoy)
    .in("estado", ["PUBLICADO", "PROPUESTO"])
    .order("fecha_desde", { ascending: true });

  // Lo que propuso ella lo ve aunque todavía no esté aprobado; lo de otra
  // marca, no: no tiene por qué enterarse de lo que pide la competencia.
  const candidatos = (filas ?? []).filter(
    (e) => e.estado !== "PROPUESTO" || e.id_marca_propone === sesion.idMarca
  );

  const ids = candidatos.map((e) => e.id_evento as string);
  const { data: participaciones } = ids.length
    ? await supabase.from("eventos_marcas").select("id_evento, id_marca, estado").in("id_evento", ids)
    : { data: [] as Record<string, unknown>[] };

  const mias = new Map<string, EstadoParticipacion>();
  const tomadosPorEvento = new Map<string, number>();
  for (const p of participaciones ?? []) {
    const idE = p.id_evento as string;
    const estado = p.estado as EstadoParticipacion;
    if (p.id_marca === sesion.idMarca) mias.set(idE, estado);
    // Una invitación sin contestar no ocupa lugar: lo ocupa recién cuando dice
    // que sí. Si contara, el cupo se vería lleno de gente que no va a ir.
    if (estado === "ANOTADA" || estado === "CONFIRMADA") {
      tomadosPorEvento.set(idE, (tomadosPorEvento.get(idE) ?? 0) + 1);
    }
  }

  const eventos: EventoPortal[] = candidatos
    // Un evento por invitación solo lo ve la invitada, salvo que se haya
    // marcado como visible para todas.
    .filter(
      (e) =>
        e.alcance !== "INVITACION" ||
        Boolean(e.visible_para_todas) ||
        mias.has(e.id_evento as string)
    )
    .map((e) => {
      const idEvento = e.id_evento as string;
      const alcance = (e.alcance as AlcanceEvento) ?? "AVISO";
      const ordenEntrada = (e.orden_entrada as OrdenEntrada) ?? "GOLD_PRIMERO";
      const cupo = (e.cupo as number | null) ?? null;
      const tomados = tomadosPorEvento.get(idEvento) ?? 0;
      const miEstado = mias.get(idEvento) ?? null;
      const lleno = cupo != null && tomados >= cupo;

      return {
        idEvento,
        nombre: (e.nombre as string) ?? "Evento",
        tipo: (e.tipo as TipoEvento) ?? "EVENTO",
        descripcion: (e.descripcion as string | null) ?? null,
        fechaDesde: e.fecha_desde as string,
        fechaHasta: e.fecha_hasta as string,
        alcance,
        cupo,
        ordenEntrada,
        tomados,
        miEstado,
        esMiPropuesta: e.estado === "PROPUESTO",
        puedoAnotarme:
          e.estado === "PUBLICADO" &&
          miEstado == null &&
          !lleno &&
          puedeAnotarse({ alcance, ordenEntrada }, sesion.plan),
        diasFaltan: diasHasta(e.fecha_desde as string, hoy),
      };
    });

  return {
    plan: sesion.plan,
    hoy,
    eventos,
    almanaque: armarAlmanaque(
      hoy,
      MESES_ALMANAQUE,
      eventos
        .filter((e) => !e.esMiPropuesta)
        .map((e) => ({ tipo: e.tipo, fechaDesde: e.fechaDesde, fechaHasta: e.fechaHasta }))
    ),
  };
}

/**
 * La marca se anota en un evento abierto.
 *
 * Las condiciones se vuelven a mirar acá y no solo en pantalla: esconder un
 * botón no protege nada, y el cupo puede haberse llenado mientras tenía la
 * página abierta.
 */
export async function anotarmeEnEvento(idEvento: string): Promise<{ error: string | null }> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return { error: "Tenés que entrar de nuevo." };

  const supabase = getSupabaseServerClient();
  const { data: e } = await supabase
    .from("eventos")
    .select("id_evento, alcance, cupo, orden_entrada, estado")
    .eq("id_evento", idEvento)
    .maybeSingle();

  if (!e || e.estado !== "PUBLICADO") return { error: "Ese evento ya no está disponible." };

  const alcance = (e.alcance as AlcanceEvento) ?? "AVISO";
  const ordenEntrada = (e.orden_entrada as OrdenEntrada) ?? "GOLD_PRIMERO";
  if (!puedeAnotarse({ alcance, ordenEntrada }, sesion.plan)) {
    return { error: "Este evento no es para anotarse." };
  }

  const { data: ya } = await supabase
    .from("eventos_marcas")
    .select("id_marca, estado")
    .eq("id_evento", idEvento);

  if ((ya ?? []).some((p) => p.id_marca === sesion.idMarca)) {
    return { error: "Ya estabas en este evento." };
  }

  const cupo = (e.cupo as number | null) ?? null;
  const tomados = (ya ?? []).filter((p) => p.estado === "ANOTADA" || p.estado === "CONFIRMADA").length;
  if (cupo != null && tomados >= cupo) {
    return { error: "Se llenó el cupo mientras tenías la pantalla abierta." };
  }

  const { error } = await supabase.from("eventos_marcas").insert({
    id_evento: idEvento,
    id_marca: sesion.idMarca,
    estado: entraDeUna({ ordenEntrada }, sesion.plan) ? "CONFIRMADA" : "ANOTADA",
  });
  if (error) return { error: error.message };

  revalidatePath("/portal/calendario");
  revalidatePath("/portal/tareas");
  return { error: null };
}

/** Contestar una invitación. */
export async function responderInvitacion(
  idEvento: string,
  acepta: boolean
): Promise<{ error: string | null }> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return { error: "Tenés que entrar de nuevo." };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("eventos_marcas")
    .update({ estado: acepta ? "CONFIRMADA" : "NO_VA", resuelto_el: new Date().toISOString() })
    .eq("id_evento", idEvento)
    .eq("id_marca", sesion.idMarca)
    .eq("estado", "INVITADA");
  if (error) return { error: error.message };

  revalidatePath("/portal/calendario");
  revalidatePath("/portal/tareas");
  return { error: null };
}

/**
 * La marca propone un evento.
 *
 * Nace en PROPUESTO y no se publica: mismo criterio que todo el portal, nada
 * sale a la vista de nadie hasta que WiiGo dice que sí. La marca lo ve en su
 * calendario con el reloj, igual que cualquier otra solicitud.
 */
export async function proponerEvento(datos: {
  nombre: string;
  fechaDesde: string;
  fechaHasta: string;
  descripcion: string;
  necesita: string;
}): Promise<{ error: string | null }> {
  const sesion = await obtenerSesionMarca();
  if (!sesion) return { error: "Tenés que entrar de nuevo." };

  const nombre = datos.nombre.trim();
  if (!nombre) return { error: "Ponele un nombre al evento." };
  if (!datos.fechaDesde || !datos.fechaHasta) return { error: "Elegí las fechas." };
  if (datos.fechaHasta < datos.fechaDesde) {
    return { error: "La fecha de fin no puede ser anterior a la de inicio." };
  }
  const hoy = fechaHoraArgentina().fecha;
  if (datos.fechaDesde < hoy) return { error: "No se puede proponer algo para una fecha que ya pasó." };

  const { error } = await getSupabaseServerClient().from("eventos").insert({
    nombre,
    tipo: "EVENTO",
    descripcion: datos.descripcion.trim() || null,
    fecha_desde: datos.fechaDesde,
    fecha_hasta: datos.fechaHasta,
    alcance: "INVITACION",
    visible_para_todas: false,
    estado: "PROPUESTO",
    id_marca_propone: sesion.idMarca,
    necesita: datos.necesita.trim() || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/portal/calendario");
  return { error: null };
}
