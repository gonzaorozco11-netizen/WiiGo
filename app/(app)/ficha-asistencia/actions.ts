"use server";

import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { fechaHoraArgentina, minutosDeHora } from "@/lib/horarios";
import { EMISOR } from "@/lib/emisor";
import { textoLlamado, textoApercibimiento, APERCIBIMIENTO_DESDE_DEFECTO, type Antecedente } from "@/lib/sanciones";
import type { SupabaseClient } from "@supabase/supabase-js";

async function personaActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (!sesion) return null;

  const supabase = getSupabaseServerClient();
  const { data: usuario } = await supabase.from("usuarios").select("id_persona").eq("id_usuario", sesion.sub).maybeSingle();
  if (!usuario?.id_persona) return null;

  const { data: persona } = await supabase
    .from("personas")
    .select("id_persona, nombre, apellido, id_horario, id_local")
    .eq("id_persona", usuario.id_persona)
    .maybeSingle();
  if (!persona) return null;
  return { ...persona, nombreSesion: sesion.nombre as string, idUsuario: sesion.sub as string };
}

type Persona = NonNullable<Awaited<ReturnType<typeof personaActual>>>;

/**
 * La caja del local de la persona, para abrirla al entrar y cerrarla al
 * irse. Solo para los operativos (horario fijo) que tienen local asignado.
 */
export type CajaFicha = {
  idLocal: string;
  nombreLocal: string;
  /** El sobre de cambio con el que abre cada turno. */
  fondo: number;
  abierta: { idTurno: string; abiertaPor: string; esMia: boolean; desde: string } | null;
};

async function cajaDeLaPersona(supabase: SupabaseClient, persona: Persona): Promise<CajaFicha | null> {
  if (!persona.id_horario || !persona.id_local) return null;
  const [{ data: local }, { data: turnos }] = await Promise.all([
    supabase.from("locales").select("*").eq("id_local", persona.id_local as string).maybeSingle(),
    supabase.from("turnos").select("id_turno, usuario_apertura, fecha_apertura, id_usuario_apertura").eq("id_local", persona.id_local as string).eq("estado", "ABIERTO"),
  ]).then(async ([l, t]) => {
    // Sin sql/llamados-y-caja.sql no existe id_usuario_apertura: se reintenta sin esa columna.
    if (t.error) {
      const t2 = await supabase.from("turnos").select("id_turno, usuario_apertura, fecha_apertura").eq("id_local", persona.id_local as string).eq("estado", "ABIERTO");
      return [l, t2] as const;
    }
    return [l, t] as const;
  });
  const fondo = Number((local as Record<string, unknown> | null)?.fondo_cambio ?? 20000) || 0;
  const t = (turnos ?? [])[0] as Record<string, unknown> | undefined;
  return {
    idLocal: persona.id_local as string,
    nombreLocal: ((local as Record<string, unknown> | null)?.nombre as string) ?? "el local",
    fondo,
    abierta: t
      ? {
          idTurno: t.id_turno as string,
          abiertaPor: (t.usuario_apertura as string) ?? "—",
          esMia: (Boolean(t.id_usuario_apertura) && t.id_usuario_apertura === persona.idUsuario) || t.usuario_apertura === persona.nombreSesion,
          desde: t.fecha_apertura as string,
        }
      : null,
  };
}

export type HorarioResumen = {
  id_horario: string;
  nombre: string;
  hora_entrada: string;
  hora_salida: string | null;
  tolerancia_minutos: number;
};

export type EstadoFicha = {
  persona: { nombre: string; apellido: string | null } | null;
  sinPersonaVinculada: boolean;
  siguienteTipo: "ENTRADA" | "SALIDA";
  // Para ENTRADA: lista de horarios activos para elegir, y cuál viene
  // pre-marcado (el suyo, solo si hoy es uno de sus días habituales — si no,
  // no se pre-marca ninguno y ella elige a mano si vino por otro turno).
  horarios: HorarioResumen[];
  idHorarioSugerido: string | null;
  // Para SALIDA: el horario que se usó en la entrada de hoy (no se vuelve a
  // elegir, tiene que ser el mismo para que el par entrada/salida sea
  // coherente).
  horarioDeHoy: HorarioResumen | null;
  /**
   * Si tiene que firmar al fichar: los que tienen horario fijo (los
   * operativos). La firma sale en su planilla de asistencia del mes.
   */
  pideFirma: boolean;
  /** La caja de su local: para abrirla al entrar o cerrarla con el arqueo antes de irse. */
  caja: CajaFicha | null;
};

// El usuario que ficha tiene que estar vinculado a una Persona en
// Organización (usuarios.id_persona) — si no, no hay a quién asociarle la
// marcación ni contra qué horario compararla.
export async function obtenerEstadoFicha(): Promise<EstadoFicha> {
  const persona = await personaActual();
  if (!persona) {
    return { persona: null, sinPersonaVinculada: true, siguienteTipo: "ENTRADA", horarios: [], idHorarioSugerido: null, horarioDeHoy: null, pideFirma: false, caja: null };
  }

  const supabase = getSupabaseServerClient();
  const [{ data: horariosData }, caja] = await Promise.all([
    supabase.from("horarios_trabajo").select("id_horario, nombre, hora_entrada, hora_salida, tolerancia_minutos, dias_semana").eq("estado", "ACTIVO").order("nombre"),
    cajaDeLaPersona(supabase, persona),
  ]);
  const horarios = (horariosData ?? []) as (HorarioResumen & { dias_semana: number[] })[];

  // Se trae el último fichaje sin importar cuándo, y se compara la fecha en
  // JS (no con un rango gte/lte en la consulta) — más simple y sin
  // ambigüedad de con qué huso horario Postgres interpreta un string de
  // fecha sin "Z".
  const { data: ultimoFichaje } = await supabase
    .from("fichajes")
    .select("tipo, fecha_hora, id_horario")
    .eq("id_persona", persona.id_persona as string)
    .order("fecha_hora", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ahora = fechaHoraArgentina();
  const esDeHoy = !!ultimoFichaje && fechaHoraArgentina(ultimoFichaje.fecha_hora as string).fecha === ahora.fecha;
  const siguienteTipo: "ENTRADA" | "SALIDA" = esDeHoy && ultimoFichaje!.tipo === "ENTRADA" ? "SALIDA" : "ENTRADA";

  // El turno que viene marcado: el que corresponde a esta hora, no siempre
  // el habitual. Si a las 17 viene a cubrir el turno tarde, viene marcado el
  // de la tarde: si quedara marcado el de la mañana, la evaluaría contra las
  // 9 y le saldría una llegada tarde que no es.
  //   - Solo turnos de hoy, que todavía no terminaron, sin los que ya fichó
  //     hoy (el doble turno: a las 17 no vuelve a ofrecer el de la mañana).
  //   - Su turno habitual: desde 2 horas antes de la entrada hasta que
  //     termina (si llega 11:30 a su turno de las 9, es llegada tarde).
  //   - Otro turno (viene a cubrir): solo si ficha cerca de su entrada, de 2
  //     horas antes a 1 hora después.
  // Si ninguno encaja, queda "Hora puntual": viene por algo suelto (por
  // ejemplo, una hora a las 15). Se cuentan las horas, sin tardanza ni
  // salida antes de hora.
  let idHorarioSugerido: string | null = null;
  if (siguienteTipo === "ENTRADA" && persona.id_horario) {
    const { data: entradasHoy } = await supabase
      .from("fichajes")
      .select("id_horario, fecha_hora")
      .eq("id_persona", persona.id_persona as string)
      .eq("tipo", "ENTRADA")
      .gte("fecha_hora", `${ahora.fecha}T00:00:00-03:00`);
    const usadosHoy = new Set((entradasHoy ?? []).map((e) => e.id_horario as string | null).filter(Boolean));
    const candidatos = horarios.filter(
      (h) =>
        h.dias_semana.includes(ahora.diaSemanaISO) &&
        !usadosHoy.has(h.id_horario) &&
        (!h.hora_salida || ahora.minutosDelDia < minutosDeHora(h.hora_salida)) &&
        ahora.minutosDelDia >= minutosDeHora(h.hora_entrada) - 120 &&
        (h.id_horario === persona.id_horario || ahora.minutosDelDia <= minutosDeHora(h.hora_entrada) + 60)
    );
    candidatos.sort((a, b) => Math.abs(minutosDeHora(a.hora_entrada) - ahora.minutosDelDia) - Math.abs(minutosDeHora(b.hora_entrada) - ahora.minutosDelDia));
    // Su turno habitual gana si todavía corre y no lo fichó: si llega 11:30 a
    // su turno de las 9, es una llegada tarde, no el turno de la siesta.
    const habitual = candidatos.find((h) => h.id_horario === persona.id_horario);
    idHorarioSugerido = habitual?.id_horario ?? candidatos[0]?.id_horario ?? null;
  }

  let horarioDeHoy: HorarioResumen | null = null;
  if (siguienteTipo === "SALIDA" && ultimoFichaje?.id_horario) {
    horarioDeHoy = horarios.find((h) => h.id_horario === ultimoFichaje.id_horario) ?? null;
  }

  return {
    persona: { nombre: persona.nombre as string, apellido: persona.apellido as string | null },
    sinPersonaVinculada: false,
    siguienteTipo,
    horarios: horarios.map(({ dias_semana: _dias_semana, ...h }) => h),
    idHorarioSugerido,
    horarioDeHoy,
    pideFirma: Boolean(persona.id_horario),
    caja,
  };
}

/** Una firma válida: PNG en base64 y de tamaño razonable (las del recuadro pesan unos pocos KB). */
function firmaValida(firma: string | null | undefined): firma is string {
  return typeof firma === "string" && firma.length < 200_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(firma);
}

export type ResultadoFichaje = {
  error: string | null;
  idFichaje?: string;
  nombre?: string;
  tipo?: "ENTRADA" | "SALIDA";
  estado?: "A_TIEMPO" | "TARDE" | "ANTICIPADA" | "SIN_HORARIO";
  minutos?: number;
  turnoAbiertoLocal?: string | null;
  /**
   * Cómo llegó (solo en la entrada con horario): verde si llegó 5 minutos
   * antes o más, amarillo si llegó justo, rojo si llegó tarde. La racha son
   * los días seguidos llegando 5 minutos antes, contando hoy.
   */
  llegada?: { tono: "verde" | "amarillo" | "rojo"; hora: string; minutosAntes: number; racha: number } | null;
  /** El llamado de atención o apercibimiento para leer y firmar, si llegó tarde. */
  sancion?: { idSancion: string; tipo: "LLAMADO" | "APERCIBIMIENTO"; numero: number; texto: string } | null;
  /** La caja de su local después de fichar la entrada (para abrirla ahí mismo). */
  caja?: CajaFicha | null;
  /** true si no pudo fichar la salida porque tiene su caja abierta. */
  cajaPendiente?: boolean;
};

const ANTES_IDEAL = 5;

/** Días seguidos (hasta hoy) en los que entró 5 minutos antes o más. Los días sin horario no cortan ni suman. */
async function rachaTemprano(supabase: SupabaseClient, idPersona: string) {
  const [{ data: entradas }, { data: horarios }] = await Promise.all([
    supabase.from("fichajes").select("fecha_hora, id_horario").eq("id_persona", idPersona).eq("tipo", "ENTRADA").order("fecha_hora", { ascending: false }).limit(90),
    supabase.from("horarios_trabajo").select("id_horario, hora_entrada"),
  ]);
  const entradaDe = new Map((horarios ?? []).map((h) => [h.id_horario as string, h.hora_entrada as string]));
  // La primera entrada de cada día (vienen de la más nueva a la más vieja).
  const porDia = new Map<string, { minutos: number; idHorario: string | null }>();
  for (const e of entradas ?? []) {
    const arg = fechaHoraArgentina(e.fecha_hora as string);
    porDia.set(arg.fecha, { minutos: arg.minutosDelDia, idHorario: (e.id_horario as string | null) ?? null });
  }
  let racha = 0;
  for (const [, d] of [...porDia.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const hora = d.idHorario ? entradaDe.get(d.idHorario) : undefined;
    if (!hora) continue;
    if (d.minutos <= minutosDeHora(hora) - ANTES_IDEAL) racha += 1;
    else break;
  }
  return racha;
}

async function apercibimientoDesde(supabase: SupabaseClient) {
  const { data } = await supabase.from("configuracion").select("valor").eq("parametro", "APERCIBIMIENTO_DESDE").maybeSingle();
  const n = Number(data?.valor);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : APERCIBIMIENTO_DESDE_DEFECTO;
}

/**
 * Arma y guarda el llamado de atención (o el apercibimiento) por la
 * tardanza recién fichada. Si todavía no se corrió sql/llamados-y-caja.sql,
 * devuelve null y el fichaje sigue como siempre.
 */
async function crearSancion(
  supabase: SupabaseClient,
  persona: Persona,
  idFichaje: string,
  ahora: Date,
  horaHorario: string,
  minutos: number
): Promise<ResultadoFichaje["sancion"]> {
  const arg = fechaHoraArgentina(ahora);
  const periodo = arg.fecha.slice(0, 7);
  const [anio, mes] = periodo.split("-").map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const [{ data: tardanzas }, desde] = await Promise.all([
    supabase
      .from("fichajes")
      .select("id_fichaje, fecha_hora, minutos_diferencia, justificado")
      .eq("id_persona", persona.id_persona as string)
      .eq("tipo", "ENTRADA")
      .eq("estado", "TARDE")
      .gte("fecha_hora", `${periodo}-01T00:00:00-03:00`)
      .lte("fecha_hora", `${periodo}-${String(ultimo).padStart(2, "0")}T23:59:59-03:00`)
      .order("fecha_hora", { ascending: true }),
    apercibimientoDesde(supabase),
  ]);
  const validas = (tardanzas ?? []).filter((t) => !t.justificado);
  const numero = Math.max(1, validas.length);
  const tipo: "LLAMADO" | "APERCIBIMIENTO" = numero >= desde ? "APERCIBIMIENTO" : "LLAMADO";
  const nombre = [persona.nombre, persona.apellido].filter(Boolean).join(" ");
  const datos = {
    empresa: EMISOR.razonSocial,
    ciudad: "Mendoza",
    nombre,
    fecha: arg.fecha,
    horaIngreso: arg.hora,
    horaHorario: horaHorario.slice(0, 5),
    minutos,
    numeroEnMes: numero,
    apercibimientoDesde: desde,
  };

  let texto: string;
  if (tipo === "APERCIBIMIENTO") {
    const anteriores = validas.filter((t) => t.id_fichaje !== idFichaje);
    const { data: previas } = await supabase
      .from("sanciones")
      .select("id_fichaje, tipo, estado")
      .in("id_fichaje", anteriores.length > 0 ? anteriores.map((t) => t.id_fichaje as string) : ["00000000-0000-0000-0000-000000000000"]);
    const tipoPor = new Map((previas ?? []).filter((s) => s.estado === "VIGENTE").map((s) => [s.id_fichaje as string, s.tipo as "LLAMADO" | "APERCIBIMIENTO"]));
    const antecedentes: Antecedente[] = anteriores.map((t) => {
      const a = fechaHoraArgentina(t.fecha_hora as string);
      return { fecha: a.fecha, horaIngreso: a.hora, minutos: (t.minutos_diferencia as number) ?? 0, tipo: tipoPor.get(t.id_fichaje as string) ?? null };
    });
    texto = textoApercibimiento(datos, antecedentes);
  } else texto = textoLlamado(datos);

  const { data, error } = await supabase
    .from("sanciones")
    .insert({
      id_persona: persona.id_persona,
      id_fichaje: idFichaje,
      tipo,
      fecha: arg.fecha,
      periodo,
      numero_en_mes: numero,
      minutos_tarde: minutos,
      hora_ingreso: arg.hora,
      hora_horario: horaHorario.slice(0, 5),
      texto,
    })
    .select("id_sancion")
    .single();
  if (error || !data) return null;
  return { idSancion: data.id_sancion as string, tipo, numero, texto };
}

// El fichaje se registra siempre con la hora del servidor (nunca la del
// dispositivo) — es lo que lo vuelve inalterable: nadie puede "atrasar" el
// reloj de la tablet para marcar que llegó a tiempo.
//
// idHorarioElegido es el que se ve/elige en pantalla para una ENTRADA (null
// si es un día excepcional y no se eligió ninguno — ahí no se evalúa
// tardanza, solo se registra la hora). Para una SALIDA se ignora: siempre
// se usa el mismo horario que quedó guardado en la entrada de hoy, para que
// el par sea coherente.
//
// firma: la que hizo con el dedo en el recuadro. Se exige a quien tiene
// horario fijo (ver pideFirma).
export async function fichar(tipo: "ENTRADA" | "SALIDA", idHorarioElegido: string | null, firma?: string | null): Promise<ResultadoFichaje> {
  const persona = await personaActual();
  if (!persona) return { error: "Tu usuario no está vinculado a ninguna persona — avisale a administración." };
  if (persona.id_horario && !firmaValida(firma)) return { error: "Falta tu firma. Firmá en el recuadro y volvé a confirmar." };

  const supabase = getSupabaseServerClient();
  const ahora = new Date();

  // No se puede fichar la salida con la caja propia abierta: primero el arqueo.
  if (tipo === "SALIDA") {
    const caja = await cajaDeLaPersona(supabase, persona);
    if (caja?.abierta?.esMia) return { error: "Antes de fichar la salida cerrá tu caja con el arqueo.", cajaPendiente: true };
  }

  let idHorarioAUsar: string | null = idHorarioElegido;
  if (tipo === "SALIDA") {
    const hoy = fechaHoraArgentina(ahora).fecha;
    const { data: entradaHoy } = await supabase
      .from("fichajes")
      .select("id_horario, fecha_hora")
      .eq("id_persona", persona.id_persona as string)
      .eq("tipo", "ENTRADA")
      .order("fecha_hora", { ascending: false })
      .limit(1)
      .maybeSingle();
    const esDeHoy = !!entradaHoy && fechaHoraArgentina(entradaHoy.fecha_hora as string).fecha === hoy;
    idHorarioAUsar = esDeHoy ? (entradaHoy!.id_horario as string | null) : null;
  }

  type HorarioFichaje = { hora_entrada: string; hora_salida: string | null; tolerancia_minutos: number };
  let horario = null as HorarioFichaje | null;
  if (idHorarioAUsar) {
    const { data } = await supabase
      .from("horarios_trabajo")
      .select("hora_entrada, hora_salida, tolerancia_minutos")
      .eq("id_horario", idHorarioAUsar)
      .maybeSingle();
    horario = (data ?? null) as HorarioFichaje | null;
  }
  // Seguro: una entrada con un turno que ya terminó (marcó el de la mañana a
  // las 17) no se evalúa. Nunca una llegada tarde por haber elegido mal el turno.
  if (tipo === "ENTRADA" && horario?.hora_salida && fechaHoraArgentina(ahora).minutosDelDia >= minutosDeHora(horario.hora_salida)) {
    horario = null;
  }

  let estado: "A_TIEMPO" | "TARDE" | "ANTICIPADA" | "SIN_HORARIO" = "SIN_HORARIO";
  let minutos = 0;
  let diffEntrada: number | null = null;

  const horaReferencia = horario ? (tipo === "ENTRADA" ? horario.hora_entrada : horario.hora_salida) : null;
  if (horario && horaReferencia) {
    const diffMin = fechaHoraArgentina(ahora).minutosDelDia - minutosDeHora(horaReferencia);
    if (tipo === "ENTRADA") diffEntrada = diffMin;
    if (tipo === "ENTRADA") {
      estado = diffMin > horario.tolerancia_minutos ? "TARDE" : "A_TIEMPO";
      minutos = estado === "TARDE" ? diffMin : 0;
    } else {
      estado = diffMin < -horario.tolerancia_minutos ? "ANTICIPADA" : "A_TIEMPO";
      minutos = estado === "ANTICIPADA" ? Math.abs(diffMin) : 0;
    }
  }

  const fila: Record<string, unknown> = {
    id_persona: persona.id_persona,
    tipo,
    fecha_hora: ahora.toISOString(),
    minutos_diferencia: minutos || null,
    estado,
    id_horario: idHorarioAUsar,
  };
  let { data: fichajeCreado, error } = await supabase
    .from("fichajes")
    .insert(firmaValida(firma) ? { ...fila, firma } : fila)
    .select("id_fichaje")
    .single();
  // Si todavía no se corrió sql/fichajes-firma.sql, se ficha igual sin la
  // firma: la hora nunca se pierde por una columna que falta.
  if (error && /firma/.test(error.message)) {
    ({ data: fichajeCreado, error } = await supabase.from("fichajes").insert(fila).select("id_fichaje").single());
  }
  if (error || !fichajeCreado) return { error: error?.message ?? "No se pudo fichar." };

  // Recordatorio de caja: si esta persona tiene un turno de caja abierto a
  // su nombre, se lo avisamos justo al fichar la salida — es el momento en
  // que más sentido tiene, antes de que se vaya del local.
  let turnoAbiertoLocal: string | null = null;
  if (tipo === "SALIDA") {
    const { data: turno } = await supabase
      .from("turnos")
      .select("id_local")
      .eq("usuario_apertura", persona.nombreSesion)
      .eq("estado", "ABIERTO")
      .maybeSingle();
    if (turno?.id_local) {
      const { data: local } = await supabase.from("locales").select("nombre").eq("id_local", turno.id_local as string).maybeSingle();
      turnoAbiertoLocal = (local?.nombre as string | undefined) ?? "un local";
    }
  }

  // La entrada: cómo llegó, la racha, el llamado si llegó tarde y la caja.
  let llegada: ResultadoFichaje["llegada"] = null;
  let sancion: ResultadoFichaje["sancion"] = null;
  let caja: CajaFicha | null = null;
  if (tipo === "ENTRADA") {
    const idFichaje = fichajeCreado.id_fichaje as string;
    const hora = fechaHoraArgentina(ahora).hora;
    if (diffEntrada !== null && horario) {
      const tono = estado === "TARDE" ? "rojo" : diffEntrada <= -ANTES_IDEAL ? "verde" : "amarillo";
      const [racha, s, c] = await Promise.all([
        tono === "verde" ? rachaTemprano(supabase, persona.id_persona as string) : Promise.resolve(0),
        estado === "TARDE" && persona.id_horario ? crearSancion(supabase, persona, idFichaje, ahora, horario.hora_entrada, minutos) : Promise.resolve(null),
        cajaDeLaPersona(supabase, persona),
      ]);
      llegada = { tono, hora, minutosAntes: Math.max(0, -diffEntrada), racha };
      sancion = s;
      caja = c;
    } else {
      caja = await cajaDeLaPersona(supabase, persona);
    }
  }

  return {
    error: null,
    idFichaje: fichajeCreado.id_fichaje as string,
    nombre: persona.nombre as string,
    tipo,
    estado,
    minutos,
    turnoAbiertoLocal,
    llegada,
    sancion,
    caja,
  };
}

/**
 * La persona firma el llamado de atención (o se niega). Firmar quiere decir
 * que se notificó, no que esté de acuerdo. El motivo que escriba lo revisa
 * administración: por sí solo no anula nada.
 */
export async function firmarSancion(
  idSancion: string,
  datos: { firma?: string | null; seNiega?: boolean; motivo?: string }
): Promise<{ error: string | null }> {
  const persona = await personaActual();
  if (!persona) return { error: "Tu usuario no está vinculado a ninguna persona." };
  if (!datos.seNiega && !firmaValida(datos.firma)) return { error: "Falta tu firma." };

  const supabase = getSupabaseServerClient();
  const { data: sancion } = await supabase.from("sanciones").select("id_persona, id_fichaje, firmado_en, se_nego").eq("id_sancion", idSancion).maybeSingle();
  if (!sancion || sancion.id_persona !== persona.id_persona) return { error: "No se encontró la nota." };
  if (sancion.firmado_en || sancion.se_nego) return { error: null };

  const motivo = (datos.motivo ?? "").trim() || null;
  const { error } = await supabase
    .from("sanciones")
    .update(
      datos.seNiega
        ? { se_nego: true, firmado_en: new Date().toISOString(), motivo }
        : { firma: datos.firma, firmado_en: new Date().toISOString(), motivo }
    )
    .eq("id_sancion", idSancion);
  if (error) return { error: error.message };
  if (motivo && sancion.id_fichaje) await supabase.from("fichajes").update({ motivo }).eq("id_fichaje", sancion.id_fichaje as string);
  return { error: null };
}

// Se llama aparte, después de fichar, para no obligar a escribir el motivo
// antes de que quede registrada la hora — la marcación en sí nunca espera.
export async function guardarMotivoTardanza(idFichaje: string, motivo: string): Promise<{ error: string | null }> {
  const persona = await personaActual();
  if (!persona) return { error: "Tu usuario no está vinculado a ninguna persona." };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("fichajes")
    .update({ motivo: motivo.trim() || null })
    .eq("id_fichaje", idFichaje)
    .eq("id_persona", persona.id_persona as string);
  if (error) return { error: error.message };
  return { error: null };
}

export type AvisoSalida = { debeRecordar: boolean; horaSalida: string | null };

// Se llama desde el layout general (no solo desde Ficha Asistencia) para
// que el aviso le aparezca en cualquier pantalla que esté usando pasada su
// hora de salida — no solo si vuelve a entrar ahí. Solo aplica si la
// entrada de hoy quedó ligada a un horario (si fichó sin elegir ninguno, no
// hay una "hora de salida esperada" contra la cual avisar).
export async function verificarAvisoSalida(): Promise<AvisoSalida> {
  const persona = await personaActual();
  if (!persona) return { debeRecordar: false, horaSalida: null };

  const supabase = getSupabaseServerClient();
  const { data: ultimoFichaje } = await supabase
    .from("fichajes")
    .select("tipo, fecha_hora, id_horario")
    .eq("id_persona", persona.id_persona as string)
    .order("fecha_hora", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ahora = fechaHoraArgentina();
  const yaFichoEntradaHoySinSalida =
    !!ultimoFichaje && fechaHoraArgentina(ultimoFichaje.fecha_hora as string).fecha === ahora.fecha && ultimoFichaje.tipo === "ENTRADA";
  if (!yaFichoEntradaHoySinSalida || !ultimoFichaje?.id_horario) return { debeRecordar: false, horaSalida: null };

  const { data: horario } = await supabase
    .from("horarios_trabajo")
    .select("hora_salida")
    .eq("id_horario", ultimoFichaje.id_horario as string)
    .maybeSingle();
  const horaSalida = horario?.hora_salida as string | undefined;
  if (!horaSalida) return { debeRecordar: false, horaSalida: null };

  const debeRecordar = ahora.minutosDelDia >= minutosDeHora(horaSalida);
  return { debeRecordar, horaSalida: horaSalida.slice(0, 5) };
}
