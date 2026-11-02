import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina } from "@/lib/horarios";
import { lunesDe, profesionalesDestacadas } from "@/lib/semanaProfesional";

// Los puntos del mes de cada profesional y el ranking (Gonzalo, 2026-11-02;
// mockup aprobado en https://claude.ai/artifact/AUQiJqKJQvyx1DVxcBLYEu).
//
// Suman tres cosas: los pacientes que compraron con ella, las historias que
// mencionan a @wiigo.arg y los reels. Las historias y los reels cuentan
// recién cuando Gonzalo los verifica en Aprobaciones: lo que ella avisa no
// suma solo (ver sql/profesionales-objetivos-redes.sql).
//
// Los puntos no son plata: el premio de las 3 primeras del mes es salir en
// las pantallas del local, contenido pautado y compartido por WiiGo, y salir
// primeras en la pantalla asesora.

export const PARAMS_PUNTOS = {
  ptsPaciente: "PROFESIONAL_PTS_PACIENTE",
  ptsHistoria: "PROFESIONAL_PTS_HISTORIA",
  historiasSemana: "PROFESIONAL_HISTORIAS_SEMANA",
  ptsReel: "PROFESIONAL_PTS_REEL",
  reelCadaDias: "PROFESIONAL_REEL_CADA_DIAS",
} as const;

export type ReglasPuntos = Record<keyof typeof PARAMS_PUNTOS, number>;

const DEFECTO: ReglasPuntos = { ptsPaciente: 10, ptsHistoria: 5, historiasSemana: 2, ptsReel: 15, reelCadaDias: 15 };

export async function reglasPuntos(supabase: SupabaseClient): Promise<ReglasPuntos> {
  const { data } = await supabase.from("configuracion").select("parametro, valor").in("parametro", Object.values(PARAMS_PUNTOS));
  const reglas = { ...DEFECTO };
  for (const [clave, parametro] of Object.entries(PARAMS_PUNTOS) as [keyof ReglasPuntos, string][]) {
    const n = Number((data ?? []).find((f) => f.parametro === parametro)?.valor);
    if (Number.isFinite(n) && n >= 0) reglas[clave] = Math.round(n);
  }
  return reglas;
}

export type Publicacion = {
  idPublicacion: string;
  idProfesional: string;
  tipo: "HISTORIA" | "REEL";
  estado: "PENDIENTE" | "VERIFICADA" | "RECHAZADA";
  motivo: string | null;
  creadaEl: string;
};

const DIA_MS = 86400000;
const primeroDelMes = () => `${fechaHoraArgentina().fecha.slice(0, 8)}01`;
const inicioDelDia = (fecha: string) => `${fecha}T00:00:00-03:00`;

/**
 * Cuáles de las publicaciones verificadas DE UNA PROFESIONAL suman (se llama
 * con la lista de una sola: el reel se cuenta desde su último reel): hasta N historias por semana
 * (de lunes a domingo) y un reel cada tantos días. Las que pasan el tope
 * quedan verificadas pero no suman: así no conviene subir diez el mismo día.
 */
export function publicacionesQueSuman(publicaciones: Publicacion[], reglas: ReglasPuntos): Set<string> {
  const suman = new Set<string>();
  const verificadas = publicaciones.filter((p) => p.estado === "VERIFICADA").sort((a, b) => a.creadaEl.localeCompare(b.creadaEl));
  const historiasPorSemana = new Map<string, number>();
  let ultimoReel: number | null = null;
  for (const p of verificadas) {
    if (p.tipo === "HISTORIA") {
      const clave = `${p.idProfesional}|${lunesDe(p.creadaEl)}`;
      const llevas = historiasPorSemana.get(clave) ?? 0;
      if (llevas < reglas.historiasSemana) {
        suman.add(p.idPublicacion);
        historiasPorSemana.set(clave, llevas + 1);
      }
    } else {
      const momento = new Date(p.creadaEl).getTime();
      if (ultimoReel === null || momento - ultimoReel >= reglas.reelCadaDias * DIA_MS) {
        suman.add(p.idPublicacion);
        ultimoReel = momento;
      }
    }
  }
  return suman;
}

async function leerPublicaciones(supabase: SupabaseClient, desde: string, idProfesional?: string) {
  let consulta = supabase
    .from("publicaciones_profesional")
    .select("id_publicacion, id_profesional, tipo, estado, motivo, creada_el")
    .gte("creada_el", desde)
    .order("creada_el", { ascending: false });
  if (idProfesional) consulta = consulta.eq("id_profesional", idProfesional);
  const { data, error } = await consulta;
  // Sin el SQL corrido la tabla no existe: no hay publicaciones, todo lo demás sigue.
  if (error) return { disponible: false, publicaciones: [] as Publicacion[] };
  return {
    disponible: true,
    publicaciones: (data ?? []).map((p) => ({
      idPublicacion: p.id_publicacion as string,
      idProfesional: p.id_profesional as string,
      tipo: p.tipo as Publicacion["tipo"],
      estado: p.estado as Publicacion["estado"],
      motivo: (p.motivo as string | null) ?? null,
      creadaEl: p.creada_el as string,
    })),
  };
}

export type PuestoDelMes = {
  idProfesional: string;
  pacientes: number;
  historias: number;
  reels: number;
  puntos: number;
  puesto: number;
};

/** El ranking del mes en curso, de la que más puntos tiene a la que menos. */
export async function rankingDelMes(supabase: SupabaseClient): Promise<{ filas: PuestoDelMes[]; reglas: ReglasPuntos; disponible: boolean }> {
  const desdeMes = primeroDelMes();
  const reglas = await reglasPuntos(supabase);
  // Los reels se miran desde antes del mes: el de fin de mes pasado marca cuándo vuelve a sumar uno.
  const desdeReels = new Date(new Date(inicioDelDia(desdeMes)).getTime() - reglas.reelCadaDias * DIA_MS).toISOString();
  const [profRes, refRes, pubs] = await Promise.all([
    supabase.from("profesionales").select("id_profesional").eq("estado", "ACTIVO"),
    supabase.from("referidos_profesionales").select("id_profesional, id_cliente").neq("estado", "ANULADO").gte("fecha", inicioDelDia(desdeMes)),
    leerPublicaciones(supabase, desdeReels),
  ]);

  // Pacientes distintos en el mes: los identificados cuentan una vez; los que no, cada compra.
  const clientes = new Map<string, Set<string>>();
  const sinCliente = new Map<string, number>();
  for (const r of refRes.data ?? []) {
    const id = r.id_profesional as string;
    if (r.id_cliente) {
      if (!clientes.has(id)) clientes.set(id, new Set());
      clientes.get(id)!.add(r.id_cliente as string);
    } else sinCliente.set(id, (sinCliente.get(id) ?? 0) + 1);
  }

  const inicioMes = new Date(inicioDelDia(desdeMes)).getTime();
  const porProfesional = new Map<string, Publicacion[]>();
  for (const p of pubs.publicaciones) {
    const lista = porProfesional.get(p.idProfesional) ?? [];
    lista.push(p);
    porProfesional.set(p.idProfesional, lista);
  }

  const filas = (profRes.data ?? []).map((p) => {
    const id = p.id_profesional as string;
    const pacientes = (clientes.get(id)?.size ?? 0) + (sinCliente.get(id) ?? 0);
    const suyas = porProfesional.get(id) ?? [];
    const suman = publicacionesQueSuman(suyas, reglas);
    const delMes = suyas.filter((x) => suman.has(x.idPublicacion) && new Date(x.creadaEl).getTime() >= inicioMes);
    const historias = delMes.filter((x) => x.tipo === "HISTORIA").length;
    const reels = delMes.filter((x) => x.tipo === "REEL").length;
    return {
      idProfesional: id,
      pacientes,
      historias,
      reels,
      puntos: pacientes * reglas.ptsPaciente + historias * reglas.ptsHistoria + reels * reglas.ptsReel,
      puesto: 0,
    };
  });
  filas.sort((a, b) => b.puntos - a.puntos);
  // Empatadas comparten puesto.
  filas.forEach((f, i) => (f.puesto = i > 0 && f.puntos === filas[i - 1].puntos ? filas[i - 1].puesto : i + 1));
  return { filas, reglas, disponible: pubs.disponible };
}

/** Las del podio del mes (puesto 1 a 3, con algún punto). */
export function podio(filas: PuestoDelMes[]) {
  return new Set(filas.filter((f) => f.puntos > 0 && f.puesto <= 3).map((f) => f.idProfesional));
}

/**
 * Las que salen primeras en la pantalla del local: las que llegaron a los
 * pacientes del mes y las del podio de puntos.
 */
export async function destacadasDelMes(supabase: SupabaseClient): Promise<Set<string>> {
  const [porPacientes, ranking] = await Promise.all([
    profesionalesDestacadas(supabase).catch(() => new Set<string>()),
    rankingDelMes(supabase).catch(() => null),
  ]);
  return new Set([...porPacientes, ...(ranking ? podio(ranking.filas) : [])]);
}

export type ObjetivosRedes = {
  disponible: boolean;
  reglas: ReglasPuntos;
  historias: { verificadas: number; enRevision: number; meta: number };
  reel: { enRevision: number; sumaEnDias: number; hechoEnPeriodo: boolean };
  recientes: Publicacion[];
};

/** Sus objetivos de redes de esta semana y lo último que avisó, para su espacio. */
export async function objetivosRedes(supabase: SupabaseClient, idProfesional: string): Promise<ObjetivosRedes> {
  const reglas = await reglasPuntos(supabase);
  const desde = new Date(Date.now() - Math.max(reglas.reelCadaDias, 14) * 2 * DIA_MS).toISOString();
  const { disponible, publicaciones } = await leerPublicaciones(supabase, desde, idProfesional);
  const lunes = lunesDe();
  const deEstaSemana = publicaciones.filter((p) => p.tipo === "HISTORIA" && lunesDe(p.creadaEl) === lunes);
  const suman = publicacionesQueSuman(publicaciones, reglas);

  // ¿Cuándo vuelve a sumar un reel? Desde el último que sumó, cada tantos días.
  const ultimoQueSumo = publicaciones.find((p) => p.tipo === "REEL" && suman.has(p.idPublicacion));
  const pasaron = ultimoQueSumo ? (Date.now() - new Date(ultimoQueSumo.creadaEl).getTime()) / DIA_MS : Infinity;
  const hechoEnPeriodo = pasaron < reglas.reelCadaDias;

  return {
    disponible,
    reglas,
    historias: {
      verificadas: deEstaSemana.filter((p) => p.estado === "VERIFICADA").length,
      enRevision: deEstaSemana.filter((p) => p.estado === "PENDIENTE").length,
      meta: reglas.historiasSemana,
    },
    reel: {
      enRevision: publicaciones.filter((p) => p.tipo === "REEL" && p.estado === "PENDIENTE").length,
      sumaEnDias: hechoEnPeriodo ? Math.ceil(reglas.reelCadaDias - pasaron) : 0,
      hechoEnPeriodo,
    },
    recientes: publicaciones.slice(0, 5),
  };
}
