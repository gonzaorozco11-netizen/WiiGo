"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { fechaHoraArgentina } from "@/lib/horarios";
import {
  pagoPorHoraDelMes,
  calcularPresentismoMes,
  obtenerParametrosPresentismo,
  listarSaldosVacaciones,
  listarLicencias,
  obtenerAguinaldos,
  type Licencia,
} from "@/app/(app)/rrhh/actions";
import type { PersonaConPuestos } from "@/app/(app)/organizacion/actions";

// La ficha de una persona en RR.HH. → Personal: todo lo de ella en un solo
// lugar. Junta lo que vive en varias pantallas (el legajo de Organización,
// el sueldo y los cierres de Sueldos, el aguinaldo, las vacaciones) y suma
// lo que no existía: el acuerdo, el seguro, el contacto de emergencia, dónde
// pagarle y las notas (sql/personas-ficha.sql).
//
// Si ese SQL todavía no se corrió, la ficha se ve igual: los datos nuevos
// salen vacíos y guardarlos avisa que falta.

async function requireAcceso() {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return "No tenés permiso para hacer esto.";
  return null;
}

const FALTA_SQL = "Falta correr sql/personas-ficha.sql en Supabase para poder guardar esto.";
const quitarTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type MesDePago = {
  periodo: string;
  sueldo: number;
  presentismo: number;
  extras: number;
  adelantos: number;
  neto: number;
  estado: "PAGADO" | "SIN_PAGAR" | "ESTIMADO" | "SIN_CERRAR";
};

export type FichaPersona = {
  idPersona: string;
  nombre: string;
  tipo: "EMPLEADO" | "EXTERNO" | "SOCIO" | string;
  puesto: string | null;
  local: string | null;
  horario: string | null;
  /** Para abrir el formulario del legajo de Organización tal cual. */
  personaLegajo: PersonaConPuestos;
  datos: {
    dni: string | null;
    cuil: string | null;
    fechaNacimiento: string | null;
    domicilio: string | null;
    telefono: string | null;
    email: string | null;
    fechaIngreso: string | null;
    convenio: string | null;
  };
  extra: {
    acuerdo: string | null;
    enBlanco: boolean;
    revisionSueldo: string | null;
    seguroCompania: string | null;
    seguroPoliza: string | null;
    seguroVence: string | null;
    art: string | null;
    obraSocial: string | null;
    contactoNombre: string | null;
    contactoTelefono: string | null;
    contactoRelacion: string | null;
    cbuAlias: string | null;
    banco: string | null;
  };
  /** Falta correr sql/personas-ficha.sql: los datos nuevos no se pueden guardar. */
  faltaSql: boolean;
  usuario: { tiene: boolean; sueldoBase: number | null; valorHora: number | null; cobraPresentismo: boolean } | null;
  /** Fin del período de prueba (6 meses desde el ingreso), solo empleados. */
  finPrueba: string | null;
  pagos: MesDePago[];
  cobradoEnElAnio: number;
  seLeDebe: number;
  aguinaldos: {
    semestre: string;
    etiqueta: string;
    vence: string;
    acumulado: number;
    alCierre: number;
    cerrado: number | null;
    pagado: number;
    saldo: number;
    estado: "PAGADO" | "POR_PAGAR" | "EN_CURSO" | "NO_CORRESPONDE";
    motivo: string | null;
  }[];
  vacaciones: { anio: number; legales: number; tomados: number; disponibles: number; hasta: string } | null;
  licencias: Licencia[];
  documentos: { tipo: string; nombre: string; fecha: string; path: string }[];
  notas: { idNota: string; fecha: string; texto: string; usuario: string | null }[];
  honorarios: { periodo: string; monto: number; detalle: string | null }[];
};

function sumarMeses(fechaISO: string, meses: number) {
  const [a, m, d] = fechaISO.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1 + meses, d));
  return f.toISOString().slice(0, 10);
}

export async function obtenerFichaPersona(idPersona: string): Promise<FichaPersona> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const hoy = fechaHoraArgentina().fecha;
  const anio = Number(hoy.slice(0, 4));
  const mes = Number(hoy.slice(5, 7));
  const periodoActual = hoy.slice(0, 7);
  const semActual = `${anio}-${mes <= 6 ? 1 : 2}`;
  const semAnterior = mes <= 6 ? `${anio - 1}-2` : `${anio}-1`;

  const { data: p, error } = await supabase.from("personas").select("*").eq("id_persona", idPersona).maybeSingle();
  if (error) throw new Error(friendlyDbError(error));
  if (!p) throw new Error("No se encontró a esa persona.");
  const faltaSql = !("acuerdo" in p);

  const [usuarioRes, asignacionesRes, horarioRes, localRes, documentosRes, notasRes, cierresRes] = await Promise.all([
    supabase.from("usuarios").select("id_usuario, nombre, sueldo_base, valor_hora, estado").eq("id_persona", idPersona).eq("estado", "ACTIVO").maybeSingle(),
    supabase.from("persona_puestos").select("id_puesto, es_principal, puestos(nombre, id_area, areas(nombre))").eq("id_persona", idPersona),
    p.id_horario
      ? supabase.from("horarios_trabajo").select("nombre, hora_entrada, hora_salida").eq("id_horario", p.id_horario).maybeSingle()
      : Promise.resolve({ data: null }),
    p.id_local ? supabase.from("locales").select("nombre").eq("id_local", p.id_local).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("documentos_legajo").select("tipo, nombre_archivo, fecha_subida, path").eq("id_persona", idPersona).order("fecha_subida", { ascending: false }),
    supabase.from("persona_notas").select("id_nota, fecha, texto, usuario").eq("id_persona", idPersona).order("fecha", { ascending: false }),
    supabase.from("nomina_cierres").select("*").eq("id_persona", idPersona).order("periodo", { ascending: false }).limit(12),
  ]);

  const usuario = usuarioRes.data;

  type Asig = { id_puesto: string; es_principal: boolean; puestos: { nombre: string; id_area: string; areas: { nombre: string } | null } | null };
  const asignaciones = ((asignacionesRes.data ?? []) as unknown as Asig[]).filter((a) => a.puestos);
  const principal = asignaciones.find((a) => a.es_principal) ?? asignaciones[0];
  const hhmm = (t: string | null | undefined) => (t ?? "").slice(0, 5).replace(/^0/, "");
  const h = horarioRes.data as { nombre: string; hora_entrada: string; hora_salida: string } | null;

  const esEmpleado = p.tipo === "EMPLEADO";

  // Lo que sale de otras pantallas, todo a la vez: de a uno, la ficha
  // tardaba ocho segundos en abrir.
  const conNomina = esEmpleado && Boolean(usuario);
  // El mes en curso sin cerrar se estima solo para esta persona: la nómina
  // entera (obtenerNovedadesMes) calcula horas y presentismo de todo el
  // equipo y hacía tardar la ficha diez segundos.
  const cierreDelMes = (cierresRes.data ?? []).some((c) => c.periodo === periodoActual);
  const valorHora = (usuario?.valor_hora as number | null) ?? 0;
  const [estimadoMes, presentismoMes, parametros, aguinaldoActual, aguinaldoAnterior, saldos, licenciasLista, cobraRes, adelantosRes] = await Promise.all([
    conNomina && !cierreDelMes && valorHora > 0 ? pagoPorHoraDelMes(idPersona, periodoActual, valorHora) : Promise.resolve(null),
    conNomina && !cierreDelMes ? calcularPresentismoMes(periodoActual) : Promise.resolve([]),
    conNomina && !cierreDelMes ? obtenerParametrosPresentismo() : Promise.resolve(null),
    conNomina ? obtenerAguinaldos(semActual) : Promise.resolve([]),
    conNomina ? obtenerAguinaldos(semAnterior) : Promise.resolve([]),
    esEmpleado ? listarSaldosVacaciones(anio) : Promise.resolve([]),
    esEmpleado ? listarLicencias(idPersona) : Promise.resolve([] as Licencia[]),
    // Columna de sql/usuarios-cobra-presentismo.sql: si falta, cobra como siempre.
    usuario
      ? supabase.from("usuarios").select("cobra_presentismo").eq("id_usuario", usuario.id_usuario).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    conNomina && !cierreDelMes
      ? supabase
          .from("gastos")
          .select("monto")
          .eq("anulado", false)
          .eq("id_usuario_adelanto", usuario?.id_usuario as string)
          .gte("fecha", `${periodoActual}-01T00:00:00-03:00`)
      : Promise.resolve({ data: [] as { monto: number }[] }),
  ]);
  const cobraPresentismo = cobraRes.error || !cobraRes.data ? true : (cobraRes.data as { cobra_presentismo: boolean | null }).cobra_presentismo !== false;
  const aguinaldoPorSemestre = new Map([
    [semActual, aguinaldoActual],
    [semAnterior, aguinaldoAnterior],
  ]);

  // ---------- Pagos mes a mes ----------
  const pagos: MesDePago[] = ((cierresRes.data ?? []) as Record<string, unknown>[]).map((c) => ({
    periodo: c.periodo as string,
    sueldo: (c.sueldo_base as number) ?? 0,
    presentismo: (c.incentivo_presentismo as number) ?? 0,
    extras: ((c.horas_extra_monto as number) ?? 0) + ((c.premios_monto as number) ?? 0),
    adelantos: (c.adelantos as number) ?? 0,
    neto: (c.neto_a_pagar as number) ?? 0,
    estado: c.es_estimado ? "ESTIMADO" : c.estado === "PAGADO" ? "PAGADO" : "SIN_PAGAR",
  }));
  if (conNomina && !cierreDelMes) {
    // Misma cuenta que Sueldos: pago base (horas × valor hora, o el fijo) más
    // el presentismo que viene ganando, menos los adelantos del mes.
    const base = valorHora > 0 ? (estimadoMes?.montoBase ?? 0) : ((usuario?.sueldo_base as number | null) ?? 0);
    const resultado = presentismoMes.find((x) => x.idPersona === idPersona)?.resultado ?? "COMPLETO";
    const factor = resultado === "COMPLETO" ? 1 : resultado === "PARCIAL" ? 0.5 : 0;
    const presentismo = cobraPresentismo && parametros ? Math.round(base * (parametros.PRESENTISMO_PORCENTAJE_INCENTIVO / 100) * factor) : 0;
    const adelantos = (adelantosRes.data ?? []).reduce((a, g) => a + ((g.monto as number) ?? 0), 0);
    if (base > 0) {
      pagos.unshift({ periodo: periodoActual, sueldo: base, presentismo, extras: 0, adelantos, neto: base + presentismo - adelantos, estado: "SIN_CERRAR" });
    }
  }
  const cobradoEnElAnio = pagos.filter((x) => x.estado === "PAGADO" && x.periodo.startsWith(String(anio))).reduce((a, x) => a + x.neto, 0);
  const seLeDebe = pagos.filter((x) => x.estado === "SIN_PAGAR").reduce((a, x) => a + x.neto, 0);

  // ---------- Aguinaldo: este semestre y el anterior ----------
  const aguinaldos: FichaPersona["aguinaldos"] = [];
  if (conNomina) {
    for (const sem of [semActual, semAnterior]) {
      const fila = (aguinaldoPorSemestre.get(sem) ?? []).find((f) => f.idPersona === idPersona);
      const [a, n] = sem.split("-").map(Number);
      const etiqueta = `${n === 1 ? "1.º" : "2.º"} semestre ${a}`;
      const vence = n === 1 ? `${a}-06-30` : `${a}-12-18`;
      const finSem = n === 1 ? `${a}-06-30` : `${a}-12-31`;
      const inicioSem = n === 1 ? `${a}-01-01` : `${a}-07-01`;
      if (!fila) continue;
      const ingreso = p.fecha_ingreso as string | null;
      if (ingreso && ingreso > finSem) {
        aguinaldos.push({ semestre: sem, etiqueta, vence, acumulado: 0, alCierre: 0, cerrado: null, pagado: 0, saldo: 0, estado: "NO_CORRESPONDE", motivo: "Todavía no trabajaba" });
        continue;
      }
      if (fila.mejorRemuneracion === 0 && !fila.cierre) {
        aguinaldos.push({ semestre: sem, etiqueta, vence, acumulado: 0, alCierre: 0, cerrado: null, pagado: 0, saldo: 0, estado: "NO_CORRESPONDE", motivo: "No tiene sueldos cerrados en ese semestre" });
        continue;
      }
      // Al cierre del semestre: la misma cuenta pero con todos los días hasta
      // el último del semestre (el sistema, para cerrar, cuenta hasta hoy).
      const arranque = ingreso && ingreso > inicioSem ? ingreso : inicioSem;
      const diasAlCierre = Math.min(180, Math.round((Date.parse(`${finSem}T12:00:00Z`) - Date.parse(`${arranque}T12:00:00Z`)) / 86400000) + 1);
      const alCierre = Math.round((fila.mejorRemuneracion / 2) * (diasAlCierre / 180));
      const cerrado = fila.cierre ? Math.round((fila.cierre.monto as number) ?? 0) : null;
      const estado: FichaPersona["aguinaldos"][number]["estado"] = fila.cierre
        ? fila.saldo <= 0.5
          ? "PAGADO"
          : "POR_PAGAR"
        : hoy <= finSem
          ? "EN_CURSO"
          : "POR_PAGAR";
      aguinaldos.push({
        semestre: sem,
        etiqueta,
        vence,
        acumulado: Math.round(fila.montoSugerido),
        alCierre,
        cerrado,
        pagado: Math.round(fila.totalPagado),
        saldo: Math.round(fila.saldo),
        estado,
        motivo: null,
      });
    }
  }

  // ---------- Vacaciones y licencias ----------
  let vacaciones: FichaPersona["vacaciones"] = null;
  const licencias: Licencia[] = licenciasLista;
  if (esEmpleado) {
    const s = saldos.find((x) => x.idPersona === idPersona);
    // Por ley se dan entre el 1/10 y el 30/04 del año siguiente.
    if (s) vacaciones = { anio, legales: s.diasLegales, tomados: s.diasTomados, disponibles: s.diasDisponibles, hasta: `${anio + 1}-04-30` };
  }

  // ---------- Honorarios (tercerizados) ----------
  let honorarios: FichaPersona["honorarios"] = [];
  if (p.tipo === "EXTERNO") {
    const { data: cats } = await supabase.from("categorias_gasto").select("id_categoria, nombre");
    const ids = (cats ?? []).filter((c) => quitarTildes(c.nombre as string).startsWith("honorario")).map((c) => c.id_categoria as string);
    if (ids.length) {
      const { data: gastos } = await supabase
        .from("gastos")
        .select("fecha, descripcion, monto, neto")
        .in("id_categoria", ids)
        .eq("anulado", false)
        .gte("fecha", `${anio - 1}-${String(mes).padStart(2, "0")}-01T00:00:00-03:00`)
        .order("fecha", { ascending: false });
      const nombre = quitarTildes([p.nombre, p.apellido].filter(Boolean).join(" "));
      const apellido = quitarTildes((p.apellido as string) ?? "");
      honorarios = (gastos ?? [])
        .filter((g) => {
          const d = quitarTildes((g.descripcion as string) ?? "");
          return d.includes(nombre) || (apellido.length >= 3 && d.includes(apellido));
        })
        .map((g) => ({
          periodo: fechaHoraArgentina(g.fecha as string).fecha.slice(0, 7),
          monto: Math.round(((g.neto as number | null) ?? (g.monto as number)) || 0),
          detalle: (g.descripcion as string) ?? null,
        }));
    }
  }

  const val = (k: string) => ((p as Record<string, unknown>)[k] as string | null | undefined) ?? null;

  return {
    idPersona,
    nombre: [p.nombre, p.apellido].filter(Boolean).join(" "),
    tipo: p.tipo as string,
    puesto: principal?.puestos?.nombre ?? null,
    local: (localRes.data as { nombre: string } | null)?.nombre ?? null,
    horario: h ? `${h.nombre} · ${hhmm(h.hora_entrada)} a ${hhmm(h.hora_salida)} h` : null,
    personaLegajo: {
      ...(p as unknown as PersonaConPuestos),
      asignaciones: asignaciones.map((a) => ({
        idPuesto: a.id_puesto,
        nombrePuesto: a.puestos?.nombre ?? "",
        idArea: a.puestos?.id_area ?? "",
        nombreArea: a.puestos?.areas?.nombre ?? "",
        esPrincipal: a.es_principal,
      })),
    },
    datos: {
      dni: val("dni"),
      cuil: val("cuil"),
      fechaNacimiento: val("fecha_nacimiento"),
      domicilio: val("domicilio"),
      telefono: val("telefono"),
      email: val("email"),
      fechaIngreso: val("fecha_ingreso"),
      convenio: val("convenio_colectivo"),
    },
    extra: {
      acuerdo: val("acuerdo"),
      enBlanco: (p as Record<string, unknown>).en_blanco === true,
      revisionSueldo: val("revision_sueldo"),
      seguroCompania: val("seguro_ap_compania"),
      seguroPoliza: val("seguro_ap_poliza"),
      seguroVence: val("seguro_ap_vence"),
      art: val("art"),
      obraSocial: val("obra_social"),
      contactoNombre: val("contacto_emergencia_nombre"),
      contactoTelefono: val("contacto_emergencia_telefono"),
      contactoRelacion: val("contacto_emergencia_relacion"),
      cbuAlias: val("cbu_alias"),
      banco: val("banco"),
    },
    faltaSql,
    usuario: usuario
      ? { tiene: true, sueldoBase: (usuario.sueldo_base as number | null) ?? null, valorHora: (usuario.valor_hora as number | null) ?? null, cobraPresentismo }
      : null,
    finPrueba: esEmpleado && p.fecha_ingreso ? sumarMeses(p.fecha_ingreso as string, 6) : null,
    pagos,
    cobradoEnElAnio: Math.round(cobradoEnElAnio),
    seLeDebe: Math.round(seLeDebe),
    aguinaldos,
    vacaciones,
    licencias,
    documentos: (documentosRes.data ?? []).map((d) => ({
      tipo: d.tipo as string,
      nombre: d.nombre_archivo as string,
      fecha: d.fecha_subida as string,
      path: d.path as string,
    })),
    notas: notasRes.error
      ? []
      : (notasRes.data ?? []).map((n) => ({ idNota: n.id_nota as string, fecha: n.fecha as string, texto: n.texto as string, usuario: (n.usuario as string) ?? null })),
    honorarios,
  };
}

// Los datos nuevos de la ficha: el acuerdo, si está registrado, la próxima
// revisión de sueldo, el seguro, la cobertura, el contacto de emergencia y
// dónde pagarle. Lo personal (DNI, domicilio…) sigue en el legajo.
export async function actualizarFichaPersona(idPersona: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };
  const texto = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("personas")
    .update({
      acuerdo: texto("acuerdo"),
      en_blanco: formData.get("en_blanco") === "on",
      revision_sueldo: texto("revision_sueldo"),
      seguro_ap_compania: texto("seguro_ap_compania"),
      seguro_ap_poliza: texto("seguro_ap_poliza"),
      seguro_ap_vence: texto("seguro_ap_vence"),
      art: texto("art"),
      obra_social: texto("obra_social"),
      contacto_emergencia_nombre: texto("contacto_emergencia_nombre"),
      contacto_emergencia_telefono: texto("contacto_emergencia_telefono"),
      contacto_emergencia_relacion: texto("contacto_emergencia_relacion"),
      cbu_alias: texto("cbu_alias"),
      banco: texto("banco"),
    })
    .eq("id_persona", idPersona);
  if (error) return { error: /column|schema cache/i.test(error.message) ? FALTA_SQL : friendlyDbError(error) };
  revalidatePath("/rrhh/personal");
  return { error: null };
}

export async function agregarNotaPersona(idPersona: string, texto: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };
  if (!texto.trim()) return { error: "Escribí la nota." };
  const sesion = await obtenerSesionConPermisos();
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("persona_notas").insert({ id_persona: idPersona, texto: texto.trim(), usuario: sesion?.nombre ?? null });
  if (error) return { error: /persona_notas|schema cache/i.test(error.message) ? FALTA_SQL : friendlyDbError(error) };
  return { error: null };
}

export async function eliminarNotaPersona(idNota: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("persona_notas").delete().eq("id_nota", idNota);
  if (error) return { error: friendlyDbError(error) };
  return { error: null };
}
