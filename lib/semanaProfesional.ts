import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaHoraArgentina } from "@/lib/horarios";

// La semana de una profesional: cuánta gente la miró en la pantalla del local,
// su objetivo de la semana, su racha y su nivel. Sin premios en plata
// (decisión de Gonzalo, 2026-10-26): lo que la motiva es ver que la miran y
// que se lo reconozcan.
//
// Los elogios salen de números reales. Si la semana fue floja no se la
// felicita: se le da un empujón. Un elogio falso le hace dejar de creer en
// todos los demás.

export const PARAM_OBJETIVO_SEMANAL = "PROFESIONAL_OBJETIVO_SEMANAL";
export const PARAM_PACIENTES_DESTACADA = "PROFESIONAL_PACIENTES_DESTACADA";
export const OBJETIVO_SEMANAL_DEFECTO = 3;
export const PACIENTES_DESTACADA_DEFECTO = 8;

function sumarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** El lunes (en Argentina) de la semana de ese momento. */
export function lunesDe(momento: Date | string = new Date()) {
  const { fecha, diaSemanaISO } = fechaHoraArgentina(momento);
  return sumarDias(fecha, 1 - diaSemanaISO);
}

const inicioDelDia = (fecha: string) => `${fecha}T00:00:00-03:00`;

export async function reglasProfesionales(supabase: SupabaseClient) {
  const { data } = await supabase.from("configuracion").select("parametro, valor").in("parametro", [PARAM_OBJETIVO_SEMANAL, PARAM_PACIENTES_DESTACADA]);
  const valor = (p: string, defecto: number) => {
    const n = Number((data ?? []).find((f) => f.parametro === p)?.valor);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : defecto;
  };
  return {
    objetivoSemanal: valor(PARAM_OBJETIVO_SEMANAL, OBJETIVO_SEMANAL_DEFECTO),
    pacientesDestacada: valor(PARAM_PACIENTES_DESTACADA, PACIENTES_DESTACADA_DEFECTO),
  };
}

/** Pacientes distintos: los clientes identificados cuentan una vez; los que no, cada compra. */
function contarPacientes(referidos: { id_cliente: string | null }[]) {
  const conCliente = new Set(referidos.map((r) => r.id_cliente).filter(Boolean));
  return conCliente.size + referidos.filter((r) => !r.id_cliente).length;
}

/**
 * Las profesionales con la ficha destacada este mes: las que llegaron a la
 * cantidad de pacientes que pide Gonzalo. La pantalla del local las muestra
 * primero.
 */
export async function profesionalesDestacadas(supabase: SupabaseClient): Promise<Set<string>> {
  const primeroDelMes = `${fechaHoraArgentina().fecha.slice(0, 8)}01`;
  const [{ data }, reglas] = await Promise.all([
    supabase.from("referidos_profesionales").select("id_profesional, id_cliente").neq("estado", "ANULADO").gte("fecha", inicioDelDia(primeroDelMes)),
    reglasProfesionales(supabase),
  ]);
  const porProfesional = new Map<string, { id_cliente: string | null }[]>();
  for (const r of data ?? []) {
    const lista = porProfesional.get(r.id_profesional as string) ?? [];
    lista.push({ id_cliente: (r.id_cliente as string | null) ?? null });
    porProfesional.set(r.id_profesional as string, lista);
  }
  return new Set([...porProfesional.entries()].filter(([, lista]) => contarPacientes(lista) >= reglas.pacientesDestacada).map(([id]) => id));
}

export type SemanaProfesional = {
  disponible: boolean;
  fichas: number;
  conocemeEntero: number;
  reservar: number;
  fichasSemanaPasada: number;
  masVista: boolean;
  elogio: string;
  objetivo: { meta: number; llevas: number; diasQuedan: number };
  racha: number;
  semanasRacha: boolean[]; // las últimas 6, de la más vieja a la actual
  nivel: { destacada: boolean; pacientesMes: number; meta: number };
};

export async function semanaProfesional(supabase: SupabaseClient, idProfesional: string, nombre: string): Promise<SemanaProfesional> {
  const hoy = fechaHoraArgentina();
  const lunes = lunesDe();
  const lunesPasado = sumarDias(lunes, -7);
  const primeroDelMes = `${hoy.fecha.slice(0, 8)}01`;
  const hace26Semanas = sumarDias(lunes, -7 * 26);

  const [visitasRes, todasRes, refRes, reglas] = await Promise.all([
    supabase.from("visitas_asesor").select("evento, fecha").eq("id_profesional", idProfesional).gte("fecha", inicioDelDia(lunesPasado)),
    supabase.from("visitas_asesor").select("id_profesional").eq("evento", "FICHA").gte("fecha", inicioDelDia(lunes)),
    supabase
      .from("referidos_profesionales")
      .select("id_cliente, fecha, estado")
      .eq("id_profesional", idProfesional)
      .neq("estado", "ANULADO")
      .gte("fecha", inicioDelDia(hace26Semanas)),
    reglasProfesionales(supabase),
  ]);

  const visitas = visitasRes.data ?? [];
  const inicioSemana = new Date(inicioDelDia(lunes)).getTime();
  const deEstaSemana = visitas.filter((v) => new Date(v.fecha as string).getTime() >= inicioSemana);
  const cuenta = (lista: typeof visitas, evento: string) => lista.filter((v) => v.evento === evento).length;
  const fichas = cuenta(deEstaSemana, "FICHA");
  const fichasSemanaPasada = cuenta(visitas, "FICHA") - fichas;

  // ¿Fue la más vista de esta semana?
  const porProfesional = new Map<string, number>();
  for (const v of todasRes.data ?? []) porProfesional.set(v.id_profesional as string, (porProfesional.get(v.id_profesional as string) ?? 0) + 1);
  const maximo = Math.max(0, ...porProfesional.values());
  const empatadas = [...porProfesional.values()].filter((n) => n === maximo).length;
  const masVista = fichas > 0 && fichas === maximo;

  // Compras con su código: objetivo de la semana, racha y nivel del mes.
  const referidos = (refRes.data ?? []).map((r) => ({ id_cliente: (r.id_cliente as string | null) ?? null, fecha: r.fecha as string }));
  const semanaDe = (fecha: string) => lunesDe(fecha);
  const llevas = contarPacientes(referidos.filter((r) => semanaDe(r.fecha) === lunes));
  const pacientesMes = contarPacientes(referidos.filter((r) => fechaHoraArgentina(r.fecha).fecha >= primeroDelMes));

  const semanasConCompra = new Set(referidos.map((r) => semanaDe(r.fecha)));
  let racha = 0;
  let semana = semanasConCompra.has(lunes) ? lunes : lunesPasado;
  while (semanasConCompra.has(semana)) {
    racha += 1;
    semana = sumarDias(semana, -7);
  }
  const semanasRacha = Array.from({ length: 6 }, (_, i) => semanasConCompra.has(sumarDias(lunes, -7 * (5 - i))));

  let elogio: string;
  if (fichas === 0) {
    elogio = "Todavía nadie abrió tu ficha esta semana. ¿Les contás a tus pacientes que estás en la pantalla de WiiGo?";
  } else if (masVista) {
    elogio = empatadas > 1 ? `¡Muy buena semana, ${nombre}! Tu ficha es de las más vistas de WiiGo.` : `¡Muy buena semana, ${nombre}! Tu ficha es la más vista de WiiGo.`;
  } else if (fichas > fichasSemanaPasada) {
    elogio = `¡Vas muy bien, ${nombre}! Ya te miraron más que en toda la semana pasada.`;
  } else {
    // Veces, no personas: la pantalla no sabe quién toca.
    elogio = `Tu ficha se abrió ${fichas === 1 ? "1 vez" : `${fichas} veces`} esta semana. Completá lo que te falta para que se vea todavía mejor.`;
  }

  return {
    disponible: !visitasRes.error,
    fichas,
    conocemeEntero: cuenta(deEstaSemana, "CONOCEME_FIN"),
    reservar: cuenta(deEstaSemana, "RESERVAR"),
    fichasSemanaPasada,
    masVista,
    elogio,
    objetivo: { meta: reglas.objetivoSemanal, llevas, diasQuedan: 8 - hoy.diaSemanaISO },
    racha,
    semanasRacha,
    nivel: { destacada: pacientesMes >= reglas.pacientesDestacada, pacientesMes, meta: reglas.pacientesDestacada },
  };
}
