"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { fechaHoraArgentina } from "@/lib/horarios";
import { obtenerNovedadesMes } from "@/app/(app)/rrhh/actions";

// Pagos del equipo (Gonzalo, 2026-11-12): todo lo que se le paga a la gente
// en una sola lista, empleados y tercerizados, con lo pagado y lo que falta.
//
// No duplica nada de lo que ya existía:
//   - Empleados: el sueldo sigue en usuarios (sueldo_base / valor_hora) y el
//     cierre y el pago en nomina_cierres (Sueldos → El mes). Acá se ve en qué
//     está cada uno y se va al cierre.
//   - Tercerizados: el gasto fijo mensual sigue siendo un gasto recurrente de
//     «Honorarios» (así lo ve también Gastos e Ingresos), y cada pago es un
//     gasto, ahora atado a la persona y al mes que paga, con su factura.
//   - pagos_equipo guarda las respuestas de «cómo le pagás» (sql/pagos-equipo.sql).
// Sin ese SQL todo se ve igual, pero no se pueden guardar las respuestas.

async function requireAcceso() {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return "No tenés permiso para hacer esto.";
  return null;
}

const quitarTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const FALTA_SQL = "Para guardar esto falta correr sql/pagos-equipo.sql en Supabase (una sola vez).";
const MEDIOS = ["TRANSFERENCIA", "EFECTIVO_ADMIN", "MERCADO_PAGO"] as const;

export type MedioPagoEquipo = (typeof MEDIOS)[number];
type Tono = "bien" | "ojo" | "mal" | "gris";

/** Las respuestas de «cómo le pagás», con valores por defecto si todavía no se contestaron. */
export type ConfigPago = {
  cargada: boolean;
  modalidad: "EMPLEADO" | "FACTURA";
  frecuencia: "MENSUAL" | "UNICA";
  montoFijo: boolean;
  /** Lo que se le paga a quien factura (el sueldo de los empleados va en `valor`). */
  monto: number | null;
  cobraPor: "HORA" | "MES";
  valor: number | null;
  cobraPresentismo: boolean;
  diaPago: number | null;
  medioHabitual: MedioPagoEquipo | null;
  empezo: boolean;
  fechaIngreso: string | null;
  alias: string | null;
};

export type FilaPago = {
  idPersona: string;
  nombre: string;
  puesto: string | null;
  grupo: "POR_HORA" | "SUELDO_FIJO" | "FACTURA" | "NO_EMPEZO" | "SIN_CARGAR";
  detalle: string;
  monto: number | null;
  montoNota: string | null;
  estado: { texto: string; tono: Tono };
  /** Qué hace el botón: pagar acá (honorarios), ir al cierre de sueldo, o contestar las preguntas. */
  accion: "PAGAR_HONORARIO" | "SUELDOS" | "CARGAR" | null;
  pagado: {
    fecha: string;
    medio: string;
    monto: number;
    comprobantePath: string | null;
    facturaPath: string | null;
    /** Recibo de sueldo firmado (null: no corresponde, porque factura). */
    firmado: boolean | null;
    idCierre: string | null;
    /** El gasto del pago de honorarios (para subirle la factura después). */
    idGasto: string | null;
  } | null;
  config: ConfigPago;
  tieneUsuario: boolean;
};

export type PagosEquipoMes = {
  periodo: string;
  etiquetaMes: string;
  esMesActual: boolean;
  filas: FilaPago[];
  resumen: {
    /** Lo que ya se gastó este mes: sueldos (lo que llevan o el cierre) y honorarios pagados. */
    gastado: number;
    sueldos: number;
    honorarios: number;
    porPagar: number;
    /** En lo que va del año, hasta este mes. */
    enElAnio: number;
  };
  /** Honorarios fijos que no son de nadie (por ejemplo, uno repetido). */
  sueltos: { idRecurrente: string; descripcion: string; monto: number }[];
  faltaSql: boolean;
};

async function categoriasHonorarios(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const { data } = await supabase.from("categorias_gasto").select("id_categoria, nombre, estado, tipo_default");
  return (data ?? []).filter((c) => quitarTildes(c.nombre as string).startsWith("honorario"));
}

/** Si la descripción de un gasto o un recurrente es de esta persona (lo de antes: por el nombre). */
function esDe(descripcion: string | null, nombre: string, apellido: string | null) {
  const d = quitarTildes(descripcion ?? "");
  const claves = [quitarTildes(nombre), quitarTildes(apellido ?? "")].filter((k) => k.length >= 3);
  return claves.some((k) => d.includes(k));
}

function textoMedio(m: string | null) {
  if (m === "TRANSFERENCIA") return "transferencia";
  if (m === "EFECTIVO_ADMIN" || m === "CAJA_ADMIN") return "efectivo";
  if (m === "MERCADO_PAGO") return "Mercado Pago";
  return m ?? "—";
}

export async function armarPagosEquipo(periodoPedido?: string): Promise<PagosEquipoMes> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const ahora = fechaHoraArgentina();
  const periodoActual = ahora.fecha.slice(0, 7);
  const periodo = periodoPedido && /^\d{4}-\d{2}$/.test(periodoPedido) ? periodoPedido : periodoActual;
  const [anio, mes] = periodo.split("-").map(Number);
  const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const desdeMes = `${periodo}-01T00:00:00-03:00`;
  const hastaMes = `${periodo}-${String(diasDelMes).padStart(2, "0")}T23:59:59-03:00`;
  const finMes = `${periodo}-${String(diasDelMes).padStart(2, "0")}`;
  const esMesActual = periodo === periodoActual;
  const mesSiguiente = MESES[mes % 12];

  const [personasRes, usuariosRes, configRes, asignacionesRes, puestosRes, cats, novedades] = await Promise.all([
    supabase.from("personas").select("*").eq("estado", "ACTIVO").in("tipo", ["EMPLEADO", "EXTERNO"]).order("nombre", { ascending: true }),
    supabase.from("usuarios").select("*").eq("estado", "ACTIVO").not("id_persona", "is", null),
    supabase.from("pagos_equipo").select("*"),
    supabase.from("persona_puestos").select("id_persona, id_puesto, es_principal"),
    supabase.from("puestos").select("id_puesto, nombre"),
    categoriasHonorarios(supabase),
    // Incluye los empleados que no empezaron también: acá se los muestra igual, aparte.
    obtenerNovedadesMes(periodo, { incluirSinEmpezar: true }),
  ]);
  const faltaSql = Boolean(configRes.error);
  const configPor = new Map(((configRes.data ?? []) as Record<string, unknown>[]).map((c) => [c.id_persona as string, c]));
  const usuarioPor = new Map(((usuariosRes.data ?? []) as Record<string, unknown>[]).map((u) => [u.id_persona as string, u]));
  const nombrePuesto = new Map((puestosRes.data ?? []).map((p) => [p.id_puesto as string, p.nombre as string]));
  const puestoPor = new Map<string, string>();
  for (const a of asignacionesRes.data ?? []) {
    const n = nombrePuesto.get(a.id_puesto as string);
    if (n && (a.es_principal || !puestoPor.has(a.id_persona as string))) puestoPor.set(a.id_persona as string, n);
  }
  const novedadPor = new Map(novedades.map((n) => [n.idPersona, n]));
  const idsCats = cats.map((c) => c.id_categoria as string);

  // Honorarios: los recurrentes activos y los pagos del mes (los nuevos, por
  // persona y mes; los de antes, por el nombre y la fecha).
  type Gasto = Record<string, unknown>;
  const [recRes, gastosMesRes, gastosPeriodoRes] = idsCats.length
    ? await Promise.all([
        supabase.from("gastos_recurrentes").select("*").in("id_categoria", idsCats).eq("activo", true),
        supabase.from("gastos").select("*").in("id_categoria", idsCats).eq("anulado", false).gte("fecha", desdeMes).lte("fecha", hastaMes),
        faltaSql ? Promise.resolve({ data: [] as Gasto[] }) : supabase.from("gastos").select("*").eq("periodo", periodo).eq("anulado", false),
      ])
    : [{ data: [] as Gasto[] }, { data: [] as Gasto[] }, { data: [] as Gasto[] }];
  const recurrentes = (recRes.data ?? []) as Gasto[];
  const gastosDelMes = [
    ...((gastosPeriodoRes.data ?? []) as Gasto[]),
    // Los de antes no tienen persona ni mes: entran por la fecha.
    ...((gastosMesRes.data ?? []) as Gasto[]).filter((g) => !g.periodo),
  ];
  const recurrentesUsados = new Set<string>();
  const gastosUsados = new Set<string>();

  const filas: FilaPago[] = [];
  for (const p of (personasRes.data ?? []) as Record<string, unknown>[]) {
    const idPersona = p.id_persona as string;
    const nombre = [p.nombre, p.apellido].filter(Boolean).join(" ");
    const cfg = configPor.get(idPersona);
    const u = usuarioPor.get(idPersona);
    const ingreso = (p.fecha_ingreso as string | null) ?? null;
    const alias = ((p as Record<string, unknown>).cbu_alias as string | null | undefined) ?? null;
    const puesto = puestoPor.get(idPersona) ?? null;
    const empezo = cfg ? cfg.empezo !== false : true;
    const esExterno = p.tipo === "EXTERNO";

    if (!esExterno) {
      // ---------- Empleados ----------
      const valorHora = Number(u?.valor_hora ?? 0);
      const sueldo = Number(u?.sueldo_base ?? 0);
      const porHora = valorHora > 0;
      const config: ConfigPago = {
        cargada: Boolean(cfg),
        modalidad: "EMPLEADO",
        frecuencia: "MENSUAL",
        montoFijo: !porHora,
        monto: null,
        cobraPor: porHora ? "HORA" : "MES",
        valor: porHora ? valorHora : sueldo || null,
        cobraPresentismo: u ? u.cobra_presentismo !== false : true,
        diaPago: (cfg?.dia_pago as number | null) ?? null,
        medioHabitual: ((cfg?.medio_habitual as MedioPagoEquipo | null) ?? null),
        empezo,
        fechaIngreso: ingreso,
        alias,
      };
      const cuando = config.diaPago ? `se paga el día ${config.diaPago}` : "se paga el 4.º día hábil";
      const base = { idPersona, nombre, puesto, config, tieneUsuario: Boolean(u) };
      if (!empezo || (ingreso && ingreso > finMes)) {
        filas.push({
          ...base,
          grupo: "NO_EMPEZO",
          detalle: [puesto, porHora ? `${pesos(valorHora)} la hora` : sueldo ? `sueldo fijo ${pesos(sueldo)}` : null, ingreso && ingreso > finMes ? `empieza el ${ingreso.split("-").reverse().join("/")}` : "arranca cuando lo contrates"].filter(Boolean).join(" · "),
          monto: null,
          montoNota: null,
          estado: { texto: "Todavía no empezó", tono: "gris" },
          accion: null,
          pagado: null,
        });
        continue;
      }
      if (!u || (!porHora && !sueldo)) {
        filas.push({
          ...base,
          grupo: "SIN_CARGAR",
          detalle: [puesto, !u ? "le falta el usuario para poder pagarle el sueldo" : "todavía no cargaste cuánto cobra"].filter(Boolean).join(" · "),
          monto: null,
          montoNota: null,
          estado: { texto: "Sin cargar", tono: "ojo" },
          accion: "CARGAR",
          pagado: null,
        });
        continue;
      }
      const nov = novedadPor.get(idPersona);
      const cierre = nov?.cierre && !nov.cierre.es_estimado ? nov.cierre : null;
      const lleva = nov ? nov.montoBase + nov.incentivoPresentismoPreview : null;
      const detalle = [puesto, porHora ? `${pesos(valorHora)} la hora` : `sueldo fijo ${pesos(sueldo)}`, cuando].filter(Boolean).join(" · ");
      let estado: FilaPago["estado"];
      let accion: FilaPago["accion"] = null;
      if (cierre?.estado === "PAGADO") estado = { texto: "Pagado ✓", tono: "bien" };
      else if (cierre) {
        estado = { texto: "Cerrado, falta pagar", tono: "ojo" };
        accion = "SUELDOS";
      } else if (esMesActual) estado = { texto: `Se paga en ${mesSiguiente}`, tono: "gris" };
      else {
        estado = { texto: "Falta cerrar y pagar", tono: "mal" };
        accion = "SUELDOS";
      }
      const c = cierre as (typeof cierre & { firma?: string | null }) | null;
      filas.push({
        ...base,
        grupo: porHora ? "POR_HORA" : "SUELDO_FIJO",
        detalle,
        monto: cierre ? cierre.neto_a_pagar : lleva,
        montoNota: cierre ? (cierre.estado === "PAGADO" ? "pagado" : "a pagar") : esMesActual ? "lleva hasta hoy" : "sin cerrar",
        estado,
        accion,
        pagado:
          c && c.estado === "PAGADO"
            ? {
                fecha: c.fecha_pago ? fechaHoraArgentina(c.fecha_pago).fecha : "",
                medio: textoMedio(c.cuenta_pago),
                monto: c.neto_a_pagar,
                comprobantePath: c.comprobante_path,
                facturaPath: null,
                firmado: Boolean(c.firma),
                idCierre: c.id_cierre,
                idGasto: null,
              }
            : null,
      });
      continue;
    }

    // ---------- Tercerizados (te facturan) ----------
    const idRec = (cfg?.id_recurrente as string | null) ?? null;
    const rec = recurrentes.find((r) => (idRec ? r.id_recurrente === idRec : esDe(r.descripcion as string | null, p.nombre as string, p.apellido as string | null)));
    if (rec) recurrentesUsados.add(rec.id_recurrente as string);
    const frecuencia = ((cfg?.frecuencia as "MENSUAL" | "UNICA" | null) ?? "MENSUAL");
    const montoFijo = cfg ? cfg.monto_fijo !== false : true;
    const monto = (cfg?.monto as number | null) ?? (rec ? Number(rec.monto_estimado ?? 0) || null : null);
    const diaPago = (cfg?.dia_pago as number | null) ?? (rec ? (rec.dia_mes as number | null) : null);
    const config: ConfigPago = {
      cargada: Boolean(cfg),
      modalidad: "FACTURA",
      frecuencia,
      montoFijo,
      monto,
      cobraPor: "MES",
      valor: null,
      cobraPresentismo: false,
      diaPago,
      medioHabitual: ((cfg?.medio_habitual as MedioPagoEquipo | null) ?? null),
      empezo,
      fechaIngreso: ingreso,
      alias,
    };
    const base = { idPersona, nombre, puesto, config, tieneUsuario: Boolean(u) };
    if (!empezo) {
      filas.push({ ...base, grupo: "NO_EMPEZO", detalle: [puesto, monto ? pesos(monto) : null, "arranca cuando lo contrates"].filter(Boolean).join(" · "), monto: null, montoNota: null, estado: { texto: "Todavía no empezó", tono: "gris" }, accion: null, pagado: null });
      continue;
    }
    if (!cfg && !rec) {
      filas.push({ ...base, grupo: "SIN_CARGAR", detalle: [puesto, "todavía no cargaste cuánto le pagás"].filter(Boolean).join(" · "), monto: null, montoNota: null, estado: { texto: "Sin cargar", tono: "ojo" }, accion: "CARGAR", pagado: null });
      continue;
    }
    const pago = gastosDelMes.find((g) => !gastosUsados.has(g.id_gasto as string) && (g.id_persona ? g.id_persona === idPersona : esDe(g.descripcion as string | null, p.nombre as string, p.apellido as string | null)));
    if (pago) gastosUsados.add(pago.id_gasto as string);
    const montoPago = pago ? Number(pago.neto ?? pago.monto ?? 0) : null;
    let estado: FilaPago["estado"];
    if (pago) estado = { texto: "Pagado ✓", tono: "bien" };
    else if (frecuencia === "UNICA") estado = { texto: "Por pagar", tono: "ojo" };
    else if (!esMesActual) estado = { texto: "Sin pagar", tono: "mal" };
    else if (diaPago && Number(ahora.fecha.slice(8, 10)) > diaPago) {
      const atraso = Number(ahora.fecha.slice(8, 10)) - diaPago;
      estado = { texto: `Atrasado ${atraso} ${atraso === 1 ? "día" : "días"}`, tono: "mal" };
    } else estado = { texto: diaPago ? `Se paga el día ${diaPago}` : "Por pagar", tono: diaPago ? "gris" : "ojo" };
    filas.push({
      ...base,
      grupo: "FACTURA",
      detalle: [
        puesto,
        frecuencia === "UNICA" ? "una sola vez" : montoFijo ? "monto fijo" : "monto variable",
        frecuencia === "MENSUAL" && diaPago ? `el día ${diaPago}` : null,
        config.medioHabitual ? textoMedio(config.medioHabitual) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      monto: montoPago ?? monto,
      montoNota: pago ? "pagado" : montoFijo ? null : "variable",
      estado,
      accion: pago ? null : "PAGAR_HONORARIO",
      pagado: pago
        ? {
            fecha: fechaHoraArgentina(pago.fecha as string).fecha,
            medio: textoMedio(pago.medio_pago as string | null),
            monto: montoPago ?? 0,
            comprobantePath: (pago.comprobante_path as string | null) ?? null,
            facturaPath: (pago.factura_path as string | null) ?? null,
            firmado: null,
            idCierre: null,
            idGasto: pago.id_gasto as string,
          }
        : null,
    });
  }

  // Los honorarios fijos que no son de nadie (como «Sueldo contador», que
  // parece repetido con el de Agustín): se muestran aparte para asignarlos o darlos de baja.
  const sueltos = recurrentes
    .filter((r) => !recurrentesUsados.has(r.id_recurrente as string))
    .map((r) => ({ idRecurrente: r.id_recurrente as string, descripcion: (r.descripcion as string) ?? "Honorarios", monto: Number(r.monto_estimado ?? 0) }));

  // ---------- El resumen ----------
  const empleados = filas.filter((f) => f.grupo === "POR_HORA" || f.grupo === "SUELDO_FIJO");
  const costoEmpleado = (f: FilaPago) => {
    const n = novedadPor.get(f.idPersona);
    const c = n?.cierre && !n.cierre.es_estimado ? n.cierre : null;
    if (c) return (c.sueldo_base ?? 0) + (c.incentivo_presentismo ?? 0) + (c.horas_extra_monto ?? 0) + (c.premios_monto ?? 0);
    return n ? n.montoBase + n.incentivoPresentismoPreview : 0;
  };
  const sueldos = empleados.reduce((a, f) => a + costoEmpleado(f), 0);
  const honorarios = filas.reduce((a, f) => a + (f.grupo === "FACTURA" && f.pagado ? f.pagado.monto : 0), 0)
    // Pagos de honorarios del mes que no son de nadie de la lista.
    + gastosDelMes.filter((g) => !gastosUsados.has(g.id_gasto as string) && idsCats.includes(g.id_categoria as string)).reduce((a, g) => a + Number(g.neto ?? g.monto ?? 0), 0);
  const porPagar = filas.reduce((a, f) => a + (f.pagado || f.grupo === "NO_EMPEZO" || f.grupo === "SIN_CARGAR" ? 0 : f.monto ?? 0), 0);

  // En lo que va del año: los sueldos cerrados de los meses anteriores, este
  // mes como viene, y los honorarios pagados del año.
  const [cierresAnio, honorariosAnio] = await Promise.all([
    supabase.from("nomina_cierres").select("sueldo_base, incentivo_presentismo, horas_extra_monto, premios_monto").eq("es_estimado", false).gte("periodo", `${anio}-01`).lt("periodo", periodo),
    idsCats.length
      ? supabase.from("gastos").select("neto, monto").in("id_categoria", idsCats).eq("anulado", false).gte("fecha", `${anio}-01-01T00:00:00-03:00`).lt("fecha", desdeMes)
      : Promise.resolve({ data: [] as { neto: number | null; monto: number }[] }),
  ]);
  const enElAnio =
    (cierresAnio.data ?? []).reduce((a, c) => a + Number(c.sueldo_base ?? 0) + Number(c.incentivo_presentismo ?? 0) + Number(c.horas_extra_monto ?? 0) + Number(c.premios_monto ?? 0), 0) +
    (honorariosAnio.data ?? []).reduce((a, g) => a + Number(g.neto ?? g.monto ?? 0), 0) +
    sueldos +
    honorarios;

  const orden: Record<FilaPago["grupo"], number> = { POR_HORA: 0, SUELDO_FIJO: 1, FACTURA: 2, SIN_CARGAR: 3, NO_EMPEZO: 4 };
  filas.sort((a, b) => orden[a.grupo] - orden[b.grupo] || a.nombre.localeCompare(b.nombre));

  return {
    periodo,
    etiquetaMes: `${MESES[mes - 1].charAt(0).toUpperCase()}${MESES[mes - 1].slice(1)} ${anio}`,
    esMesActual,
    filas,
    resumen: {
      gastado: Math.round(sueldos + honorarios),
      sueldos: Math.round(sueldos),
      honorarios: Math.round(honorarios),
      porPagar: Math.round(porPagar),
      enElAnio: Math.round(enElAnio),
    },
    sueltos,
    faltaSql,
  };
}

// ===================== GUARDAR LAS RESPUESTAS =====================

export type RespuestasPago = {
  modalidad: "EMPLEADO" | "FACTURA";
  frecuencia: "MENSUAL" | "UNICA";
  montoFijo: boolean;
  monto: number | null;
  cobraPor: "HORA" | "MES";
  valor: number | null;
  cobraPresentismo: boolean;
  diaPago: number | null;
  medioHabitual: MedioPagoEquipo | null;
  empezo: boolean;
  fechaIngreso: string | null;
  alias: string | null;
};

export async function guardarConfigPago(idPersona: string, r: RespuestasPago): Promise<{ error: string | null; aviso?: string }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  // Que lo que llega tenga sentido antes de tocar nada.
  if (r.diaPago !== null && (!Number.isInteger(r.diaPago) || r.diaPago < 1 || r.diaPago > 31)) return { error: "El día de pago tiene que ser entre 1 y 31." };
  if (r.medioHabitual !== null && !MEDIOS.includes(r.medioHabitual)) return { error: "Elegí cómo le pagás." };
  if (r.fechaIngreso && !/^\d{4}-\d{2}-\d{2}$/.test(r.fechaIngreso)) return { error: "La fecha de ingreso no está bien." };
  if (r.empezo) {
    if (r.modalidad === "EMPLEADO" && !(Number(r.valor) > 0)) return { error: r.cobraPor === "HORA" ? "Poné cuánto cobra la hora." : "Poné el sueldo del mes." };
    if (r.modalidad === "FACTURA" && r.montoFijo && !(Number(r.monto) > 0)) return { error: "Poné cuánto le pagás." };
  }

  try {
    const supabase = getSupabaseServerClient();
    const sesion = await obtenerSesionConPermisos();
    const { data: persona } = await supabase.from("personas").select("*").eq("id_persona", idPersona).maybeSingle();
    if (!persona) return { error: "No se encontró a la persona." };
    const nombre = [persona.nombre, persona.apellido].filter(Boolean).join(" ");
    const { data: previa, error: errorPrevia } = await supabase.from("pagos_equipo").select("*").eq("id_persona", idPersona).maybeSingle();
    if (errorPrevia) return { error: FALTA_SQL };

    // Empleado o te factura: es lo que decide si ficha y cobra sueldo.
    const tipo = r.modalidad === "FACTURA" ? "EXTERNO" : "EMPLEADO";
    const cambiosPersona: Record<string, unknown> = {};
    if (persona.tipo !== tipo) cambiosPersona.tipo = tipo;
    if (r.fechaIngreso !== undefined && r.fechaIngreso !== (persona.fecha_ingreso ?? null) && r.modalidad === "EMPLEADO") cambiosPersona.fecha_ingreso = r.fechaIngreso;
    if (Object.keys(cambiosPersona).length) {
      const { error } = await supabase.from("personas").update(cambiosPersona).eq("id_persona", idPersona);
      if (error) return { error: friendlyDbError(error) };
    }
    // El alias es opcional y la columna puede no estar (sql/personas-ficha.sql).
    if (r.alias !== null && r.alias !== ((persona as Record<string, unknown>).cbu_alias ?? null)) {
      await supabase.from("personas").update({ cbu_alias: r.alias.trim().slice(0, 80) || null }).eq("id_persona", idPersona);
    }

    let aviso: string | undefined;
    let idRecurrente = (previa?.id_recurrente as string | null) ?? null;

    if (r.modalidad === "EMPLEADO") {
      // El sueldo sigue viviendo en el usuario, que es de donde lo lee Sueldos.
      const { data: usuario } = await supabase.from("usuarios").select("id_usuario").eq("id_persona", idPersona).eq("estado", "ACTIVO").maybeSingle();
      if (usuario && r.valor !== null && Number(r.valor) > 0) {
        const cambios: Record<string, unknown> =
          r.cobraPor === "HORA" ? { valor_hora: Number(r.valor) } : { valor_hora: 0, sueldo_base: Number(r.valor) };
        const { error } = await supabase.from("usuarios").update(cambios).eq("id_usuario", usuario.id_usuario as string);
        if (error) return { error: friendlyDbError(error) };
        await supabase.from("usuarios").update({ cobra_presentismo: r.cobraPresentismo }).eq("id_usuario", usuario.id_usuario as string);
      } else if (!usuario) {
        aviso = `${nombre} no tiene usuario: para pagarle el sueldo hay que crearle uno en Usuarios.`;
      }
      // Si antes facturaba, su gasto fijo deja de correr.
      if (idRecurrente) await supabase.from("gastos_recurrentes").update({ activo: false }).eq("id_recurrente", idRecurrente);
      idRecurrente = null;
    } else {
      // Te factura todos los meses: es un gasto fijo de Honorarios (lo ve también Gastos e Ingresos).
      const cats = await categoriasHonorarios(supabase);
      const cat = cats.find((c) => c.estado === "ACTIVA") ?? cats[0];
      if (!idRecurrente) {
        // El que ya estaba cargado a mano con su nombre (lo de antes), si hay.
        const { data: recs } = cats.length
          ? await supabase.from("gastos_recurrentes").select("*").in("id_categoria", cats.map((c) => c.id_categoria as string)).eq("activo", true)
          : { data: [] };
        idRecurrente = ((recs ?? []).find((x) => esDe(x.descripcion as string | null, persona.nombre as string, persona.apellido as string | null))?.id_recurrente as string | undefined) ?? null;
      }
      const activo = r.frecuencia === "MENSUAL" && r.empezo;
      if (idRecurrente) {
        const { error } = await supabase
          .from("gastos_recurrentes")
          .update({ monto_estimado: Number(r.monto ?? 0), dia_mes: r.diaPago ?? 1, activo })
          .eq("id_recurrente", idRecurrente);
        if (error) return { error: friendlyDbError(error) };
      } else if (activo) {
        if (!cat) return { error: "No hay una categoría de gastos «Honorarios»: creala en Gastos e Ingresos." };
        const { data: otro } = await supabase.from("gastos_recurrentes").select("id_local").in("id_categoria", cats.map((c) => c.id_categoria as string)).limit(1).maybeSingle();
        const { data: nuevo, error } = await supabase
          .from("gastos_recurrentes")
          .insert({
            id_categoria: cat.id_categoria,
            descripcion: `Honorarios ${nombre}`,
            monto_estimado: Number(r.monto ?? 0),
            dia_mes: r.diaPago ?? 1,
            id_local: (otro?.id_local as string | null) ?? null,
            lleva_iva: false,
            activo: true,
          })
          .select("id_recurrente")
          .single();
        if (error) return { error: friendlyDbError(error) };
        idRecurrente = nuevo.id_recurrente as string;
      }
    }

    const fila = {
      id_persona: idPersona,
      modalidad: r.modalidad,
      frecuencia: r.modalidad === "EMPLEADO" ? "MENSUAL" : r.frecuencia,
      monto_fijo: r.modalidad === "EMPLEADO" ? r.cobraPor === "MES" : r.montoFijo,
      monto: r.modalidad === "FACTURA" ? r.monto : null,
      dia_pago: r.diaPago,
      medio_habitual: r.medioHabitual,
      empezo: r.empezo,
      id_recurrente: idRecurrente,
      actualizado_en: new Date().toISOString(),
      actualizado_por: sesion?.nombre ?? null,
    };
    const { error } = await supabase.from("pagos_equipo").upsert(fila, { onConflict: "id_persona" });
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/rrhh");
    revalidatePath("/gastos-ingresos");
    return { error: null, aviso };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo guardar" };
  }
}

// ===================== PAGAR HONORARIOS =====================

/**
 * Registra el pago a alguien que factura: un gasto de Honorarios atado a la
 * persona y al mes que paga, con el comprobante de la transferencia y su
 * factura (que es su recibo). En efectivo sale de Caja Administración.
 */
export async function pagarHonorario(idPersona: string, periodo: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const monto = Number(String(formData.get("monto") ?? "").replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."));
  const medio = String(formData.get("medio") ?? "") as MedioPagoEquipo;
  const fecha = String(formData.get("fecha") ?? "") || fechaHoraArgentina().fecha;
  if (!(monto > 0)) return { error: "Poné cuánto le pagaste." };
  if (!MEDIOS.includes(medio)) return { error: "Elegí cómo le pagaste." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: "La fecha no está bien." };
  if (!/^\d{4}-\d{2}$/.test(periodo)) return { error: "El mes no está bien." };

  try {
    const supabase = getSupabaseServerClient();
    const sesion = await obtenerSesionConPermisos();
    const { data: persona } = await supabase.from("personas").select("nombre, apellido").eq("id_persona", idPersona).maybeSingle();
    if (!persona) return { error: "No se encontró a la persona." };
    const nombre = [persona.nombre, persona.apellido].filter(Boolean).join(" ");
    const cats = await categoriasHonorarios(supabase);
    const cat = cats.find((c) => c.estado === "ACTIVA") ?? cats[0];
    if (!cat) return { error: "No hay una categoría de gastos «Honorarios»: creala en Gastos e Ingresos." };
    const { data: cfg } = await supabase.from("pagos_equipo").select("id_recurrente").eq("id_persona", idPersona).maybeSingle();
    const idRecurrente = (cfg?.id_recurrente as string | null) ?? null;
    const { data: rec } = idRecurrente ? await supabase.from("gastos_recurrentes").select("id_local, ultimo_mes_cargado").eq("id_recurrente", idRecurrente).maybeSingle() : { data: null };

    const [a, m] = periodo.split("-").map(Number);
    const fila = {
      id_local: (rec?.id_local as string | null) ?? null,
      id_categoria: cat.id_categoria,
      tipo: (cat.tipo_default as string | null) ?? "FIJO",
      medio_pago: medio,
      monto,
      neto: monto,
      iva: 0,
      // El nombre en la descripción también sirve para lo de antes (que busca por nombre).
      descripcion: `Honorarios ${nombre} — ${MESES[m - 1]} ${a}`,
      usuario: sesion?.nombre ?? null,
      fecha: `${fecha}T12:00:00-03:00`,
    };
    let { data: gasto, error } = await supabase.from("gastos").insert({ ...fila, id_persona: idPersona, periodo }).select("id_gasto").single();
    if (error && /id_persona|periodo|column|schema cache/.test(error.message)) {
      // Sin sql/pagos-equipo.sql: se guarda igual, reconocible por el nombre.
      ({ data: gasto, error } = await supabase.from("gastos").insert(fila).select("id_gasto").single());
    }
    if (error || !gasto) return { error: error ? friendlyDbError(error) : "No se pudo registrar el pago." };

    const subir = async (campo: string, sufijo: string, columna: string) => {
      const archivo = formData.get(campo) as File | null;
      if (!archivo || archivo.size === 0) return;
      const ext = archivo.name.split(".").pop() ?? "pdf";
      const path = `${gasto!.id_gasto}${sufijo}.${ext}`;
      const { error: e } = await supabase.storage.from("comprobantes-gasto").upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
      // Si falla la subida el pago queda igual: la plata ya se movió.
      if (!e) await supabase.from("gastos").update({ [columna]: path }).eq("id_gasto", gasto!.id_gasto);
    };
    await subir("comprobante", "", "comprobante_path");
    await subir("factura", "-factura", "factura_path");

    if (medio === "EFECTIVO_ADMIN") {
      await supabase.from("movimientos_caja_admin").insert({
        tipo: "EGRESO_GASTO",
        monto: -monto,
        id_gasto: gasto.id_gasto,
        descripcion: fila.descripcion,
        usuario: sesion?.nombre ?? null,
      });
    }
    // Gastos e Ingresos no lo vuelve a pedir este mes.
    if (idRecurrente && periodo === fechaHoraArgentina().fecha.slice(0, 7) && ((rec?.ultimo_mes_cargado as string | null) ?? "") < periodo) {
      await supabase.from("gastos_recurrentes").update({ ultimo_mes_cargado: periodo }).eq("id_recurrente", idRecurrente);
    }

    revalidatePath("/rrhh");
    revalidatePath("/gastos-ingresos");
    revalidatePath("/tesoreria");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar el pago" };
  }
}

/** La factura que llegó después del pago. */
export async function subirFacturaPago(idGasto: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };
  const archivo = formData.get("factura") as File | null;
  if (!archivo || archivo.size === 0) return { error: "Elegí el archivo de la factura." };
  const supabase = getSupabaseServerClient();
  const ext = archivo.name.split(".").pop() ?? "pdf";
  const path = `${idGasto}-factura.${ext}`;
  const { error: e } = await supabase.storage.from("comprobantes-gasto").upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
  if (e) return { error: e.message };
  const { error } = await supabase.from("gastos").update({ factura_path: path }).eq("id_gasto", idGasto);
  if (error) return { error: /factura_path|column|schema cache/.test(error.message) ? FALTA_SQL : friendlyDbError(error) };
  revalidatePath("/rrhh");
  return { error: null };
}

/** El link para ver un comprobante o una factura de un pago de honorarios. */
export async function urlArchivoPago(path: string): Promise<string> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.storage.from("comprobantes-gasto").createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// ===================== HONORARIOS SUELTOS =====================

/** Un honorario fijo que no es de nadie (por ejemplo, uno repetido): deja de correr. */
export async function darDeBajaHonorarioSuelto(idRecurrente: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("gastos_recurrentes").update({ activo: false }).eq("id_recurrente", idRecurrente);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/rrhh");
  revalidatePath("/gastos-ingresos");
  return { error: null };
}
