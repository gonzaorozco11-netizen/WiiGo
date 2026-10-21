"use client";

import { useEffect, useState } from "react";
import PantallazoRrhh from "@/components/PantallazoRrhh";
import FichaPersona from "@/components/FichaPersona";
import { actualizarSueldoBase, actualizarValorHora, actualizarCobraPresentismo } from "@/app/(app)/usuarios/actions";
import { puedeCerrarseAguinaldo, etiquetaSemestre, semestreActual } from "@/lib/aguinaldo";
import { crearHorario, actualizarHorario, desactivarHorario, listarHorarios, type HorarioTrabajo } from "@/app/(app)/organizacion/actions";
import {
  obtenerParametrosPresentismo,
  actualizarParametrosPresentismo,
  listarSaldosVacaciones,
  listarPersonalRrhh,
  type PersonaDeRrhh,
  armarDashboardRrhh,
  type DashboardRrhh,
  listarAdelantos,
  registrarAdelanto,
  anularAdelanto,
  type AdelantoListado,
  listarLicencias,
  crearLicencia,
  eliminarLicencia,
  obtenerNovedadesMes,
  cerrarNomina,
  estimarNomina,
  eliminarCierreNomina,
  pagarNomina,
  obtenerUrlReciboSueldo,
  obtenerAguinaldos,
  cerrarAguinaldo,
  eliminarCierreAguinaldo,
  registrarPagoAguinaldo,
  type FilaAguinaldo,
  listarFeriados,
  crearFeriado,
  eliminarFeriado,
  type SaldoVacaciones,
  type Licencia,
  type NovedadNomina,
  type Feriado,
} from "@/app/(app)/rrhh/actions";
import {
  armarAsistenciaMes,
  sueldosSinPagarAnteriores,
  type AsistenciaMes as AsistenciaDatos,
  type SueldoSinPagar,
} from "@/app/(app)/rrhh/asistencia-actions";
import AsistenciaMes, { SelectorMes, HorarioDeCadaUno } from "@/components/AsistenciaMes";

type UsuarioMin = { id_usuario: string; nombre: string; sueldo_base: number | null };
type PersonaMin = { id_persona: string; nombre: string; apellido: string | null };

/**
 * Las cuatro pantallas de RR.HH., en el orden en que se usan:
 *   Tablero → cómo viene el mes.
 *   Legajos → quién es cada uno (la ficha).
 *   Asistencia → quién vino y cuántas horas hizo; acá se corrige lo que falta.
 *   Sueldos → con eso, el cierre y el pago (adelantos y aguinaldo adentro).
 * Las cuatro comparten el mes elegido (?mes=), así al pasar de una a otra se
 * sigue mirando el mismo.
 */
export type VistaRrhh = "DASHBOARD" | "LEGAJOS" | "ASISTENCIA" | "SUELDOS";

type Sub = "dashboard" | "legajos" | "asistencia" | "reglas" | "nomina" | "adelantos" | "aguinaldo";

/** Qué sub-secciones tiene cada pantalla, y con qué nombre. */
const SUBS: Record<VistaRrhh, { clave: Sub; etiqueta: string }[]> = {
  DASHBOARD: [{ clave: "dashboard", etiqueta: "Tablero" }],
  LEGAJOS: [{ clave: "legajos", etiqueta: "Legajos" }],
  ASISTENCIA: [
    { clave: "asistencia", etiqueta: "El mes" },
    { clave: "reglas", etiqueta: "Reglas" },
  ],
  SUELDOS: [
    { clave: "nomina", etiqueta: "El mes" },
    { clave: "adelantos", etiqueta: "Adelantos" },
    { clave: "aguinaldo", etiqueta: "Aguinaldo" },
  ],
};

const TITULO: Record<VistaRrhh, { h1: string; bajada: string }> = {
  DASHBOARD: {
    h1: "RR.HH.",
    bajada: "Lo que cuesta el equipo, qué parte de lo que gana WiiGo se lleva, lo que rinde cada turno y qué está trabado.",
  },
  LEGAJOS: {
    h1: "Legajos",
    bajada: "Quién trabaja con WiiGo y cómo. Tocá a una persona para ver su ficha: sueldos, aguinaldo, vacaciones, seguro, documentos y notas.",
  },
  ASISTENCIA: {
    h1: "Asistencia",
    bajada: "Quién vino, cuántas horas hizo y qué hay que corregir.",
  },
  SUELDOS: {
    h1: "Sueldos",
    bajada: "El cierre del mes, persona por persona: revisar horas, descontar adelantos, cerrar y pagar.",
  },
};

const RESULTADO_LABEL_NOMINA: Record<NovedadNomina["presentismoResultado"], string> = {
  COMPLETO: "Completo",
  PARCIAL: "Parcial",
  PERDIDO: "Perdido",
};

const TIPO_LICENCIA_LABEL: Record<string, string> = {
  VACACIONES: "Vacaciones",
  MATERNIDAD: "Maternidad",
  EXAMEN: "Examen",
  PARTICULAR: "Particular",
  ENFERMEDAD: "Enfermedad",
  OTRO: "Otro",
};

const DIAS_LABEL: Record<number, string> = { 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb", 7: "Dom" };

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function mesActualISO() {
  // El mes de Argentina, no el de UTC: a las 22 h del último día ya es el mes que viene en UTC.
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7);
}

export default function RrhhApp({
  vista,
  usuarios,
  horariosIniciales,
  personas,
  mesInicial,
  subInicial,
}: {
  vista: VistaRrhh;
  usuarios: UsuarioMin[];
  horariosIniciales: HorarioTrabajo[];
  personas: PersonaMin[];
  mesInicial?: string;
  subInicial?: string;
}) {
  const subs = SUBS[vista];
  const [sub, setSubEstado] = useState<Sub>(subs.find((s) => s.clave === subInicial)?.clave ?? subs[0].clave);
  const [horarios, setHorarios] = useState(horariosIniciales);
  const [periodo, setPeriodoEstado] = useState(mesInicial && /^\d{4}-\d{2}$/.test(mesInicial) ? mesInicial : mesActualISO());
  const [fichaAbierta, setFichaAbierta] = useState<string | null>(null);
  const [vueltaFicha, setVueltaFicha] = useState(0);
  const [licencias, setLicencias] = useState<SaldoVacaciones | null>(null);
  // Cuando algo cambia en la ficha, se vuelve a montar la pantalla de abajo
  // para que muestre los datos nuevos.
  const [version, setVersion] = useState(0);

  /** Deja el mes y la solapa en la dirección, así los links entre pantallas y el "atrás" respetan lo que estabas mirando. */
  function escribirUrl(mes: string, solapa: Sub) {
    const url = new URL(window.location.href);
    url.searchParams.set("mes", mes);
    if (solapa === subs[0].clave) url.searchParams.delete("tab");
    else url.searchParams.set("tab", solapa);
    window.history.replaceState(null, "", url.toString());
  }
  function setPeriodo(p: string) {
    setPeriodoEstado(p);
    escribirUrl(p, sub);
  }
  function setSub(s: Sub) {
    setSubEstado(s);
    escribirUrl(periodo, s);
  }

  function recargarHorarios() {
    listarHorarios().then(setHorarios);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">{TITULO[vista].h1}</h1>
      <p className="text-sm text-neutral-500 mb-4 max-w-2xl">{TITULO[vista].bajada}</p>

      {/* Las sub-secciones solo aparecen si hay más de una: un selector de un
          solo botón ocupa lugar y no elige nada. */}
      {subs.length > 1 && (
        <div className="inline-flex gap-1 bg-neutral-100 rounded-lg p-1 mb-4">
          {subs.map((s) => (
            <button
              key={s.clave}
              onClick={() => setSub(s.clave)}
              className={`text-xs font-bold px-3 py-1.5 rounded-md ${
                sub === s.clave ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"
              }`}
            >
              {s.etiqueta}
            </button>
          ))}
        </div>
      )}

      <div key={version}>
        {sub === "dashboard" && <TabDashboard periodo={periodo} setPeriodo={setPeriodo} />}
        {sub === "legajos" && <TabVacaciones personas={personas} />}
        {sub === "asistencia" && <AsistenciaMes periodo={periodo} setPeriodo={setPeriodo} onAbrirFicha={setFichaAbierta} />}
        {sub === "reglas" && (
          <div className="space-y-4">
            <HorarioDeCadaUno />
            <TabHorarios horarios={horarios} onCambio={recargarHorarios} />
            <BloqueFeriados />
            <ReglasPresentismo />
          </div>
        )}
        {sub === "nomina" && <TabNomina usuarios={usuarios} periodo={periodo} setPeriodo={setPeriodo} onAbrirFicha={setFichaAbierta} />}
        {sub === "adelantos" && <TabAdelantos usuarios={usuarios} periodo={periodo} setPeriodo={setPeriodo} />}
        {sub === "aguinaldo" && <TabAguinaldo />}
      </div>

      {/* La ficha de una persona, abierta desde Asistencia o Sueldos. Legajos
          tiene la suya adentro de la lista. */}
      {fichaAbierta && (
        <FichaPersona
          key={`${fichaAbierta}-${vueltaFicha}`}
          idPersona={fichaAbierta}
          onClose={() => setFichaAbierta(null)}
          onCambio={() => setVersion((v) => v + 1)}
          onAbrirLicencias={(persona) => setLicencias(persona)}
        />
      )}
      {licencias && (
        <ModalLicenciasPersona
          persona={licencias}
          onClose={() => {
            setLicencias(null);
            setVueltaFicha((v) => v + 1);
          }}
          onCambio={() => {
            setVersion((v) => v + 1);
            setVueltaFicha((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

// ===================== TABLERO =====================

function TabDashboard({ periodo, setPeriodo }: { periodo: string; setPeriodo: (p: string) => void }) {
  const [d, setD] = useState<DashboardRrhh | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    armarDashboardRrhh(periodo)
      .then(setD)
      .finally(() => setCargando(false));
  }, [periodo]);

  if (cargando || !d) return <p className="text-sm text-neutral-400 text-center py-10">Cargando...</p>;
  return <PantallazoRrhh d={d} periodo={periodo} setPeriodo={setPeriodo} />;
}

// ===================== NÓMINA =====================

// Sueldos → El mes: una tarjeta por empleado con la cuenta completa y los
// cuatro pasos del cierre (horas, adelantos, cerrar, pagar). El paso que
// sigue va en azul; lo que falta, en naranja. No se puede cerrar con días sin
// salida: esos días cuentan 0 horas y el sueldo saldría de menos.
function TabNomina({
  usuarios,
  periodo,
  setPeriodo,
  onAbrirFicha,
}: {
  usuarios: UsuarioMin[];
  periodo: string;
  setPeriodo: (p: string) => void;
  onAbrirFicha: (idPersona: string) => void;
}) {
  const mes = periodo;
  const [filas, setFilas] = useState<NovedadNomina[]>([]);
  const [asistencia, setAsistencia] = useState<AsistenciaDatos | null>(null);
  const [anteriores, setAnteriores] = useState<SueldoSinPagar[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<string | null>(null);
  const [valorEditSueldo, setValorEditSueldo] = useState("");
  const [valorEditHora, setValorEditHora] = useState("");
  const [valorEditCobra, setValorEditCobra] = useState(true);
  const [guardandoSueldo, setGuardandoSueldo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalCerrar, setModalCerrar] = useState<NovedadNomina | null>(null);
  const [modalPagar, setModalPagar] = useState<NovedadNomina | null>(null);
  const [modalEstimar, setModalEstimar] = useState<NovedadNomina | null>(null);

  function recargar() {
    setCargando(true);
    Promise.all([obtenerNovedadesMes(mes), armarAsistenciaMes(mes), sueldosSinPagarAnteriores(mes)])
      .then(([n, a, ant]) => {
        setFilas(n);
        setAsistencia(a);
        setAnteriores(ant);
      })
      .finally(() => setCargando(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(recargar, [mes]);

  function handleGuardarPagoBase(idUsuario: string) {
    const sueldo = Number(valorEditSueldo.replace(/[^\d.-]/g, "")) || 0;
    const hora = Number(valorEditHora.replace(/[^\d.-]/g, "")) || 0;
    setError(null);
    setGuardandoSueldo(true);
    const fila = filas.find((x) => x.idUsuario === idUsuario);
    Promise.all([
      actualizarSueldoBase(idUsuario, sueldo),
      actualizarValorHora(idUsuario, hora),
      // Solo si cambió: así no exige el SQL nuevo a quien no toca esto.
      fila && fila.cobraPresentismo !== valorEditCobra
        ? actualizarCobraPresentismo(idUsuario, valorEditCobra)
        : Promise.resolve({ error: null as string | null }),
    ])
      .then(([resSueldo, resHora, resCobra]) => {
        if (resSueldo.error || resHora.error || resCobra.error) {
          setError(resSueldo.error ?? resHora.error ?? resCobra.error);
          return;
        }
        setEditando(null);
        recargar();
      })
      .finally(() => setGuardandoSueldo(false));
  }

  function handleDeshacerCierre(f: NovedadNomina) {
    if (!f.cierre) return;
    if (!confirm(`¿Deshacer el cierre de ${f.nombre} — ${mes}? Se anula el gasto de sueldo que generó.`)) return;
    eliminarCierreNomina(f.cierre.id_cierre).then((res) => {
      if (res.error) alert(res.error);
      else recargar();
    });
  }

  function handleVerComprobante(path: string) {
    obtenerUrlReciboSueldo(path).then((url) => window.open(url, "_blank"));
  }

  /**
   * Los totales del mes.
   *
   * De cada persona se usa el neto de su cierre si ya cerró, y si no el monto
   * base como estimación. Mezclarlos es a propósito: el total tiene que dar
   * una idea de todo el mes aunque falten cerrar algunos, y el pie aclara
   * cuántos son estimados.
   */
  const netoDe = (f: NovedadNomina) => (f.cierre ? f.cierre.neto_a_pagar : f.montoBase + f.incentivoPresentismoPreview - f.adelantos);
  const totales = filas.reduce(
    (acc, f) => {
      const monto = netoDe(f);
      acc.total += monto;
      if (f.cierre?.estado === "PAGADO") {
        acc.pagado += monto;
        acc.pagados += 1;
      } else {
        acc.falta += monto;
        if (f.cierre) acc.sinPagar += 1;
        else acc.sinCerrar += 1;
      }
      return acc;
    },
    { total: 0, falta: 0, pagado: 0, sinPagar: 0, sinCerrar: 0, pagados: 0 }
  );

  return (
    <div>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="flex justify-end mb-3">
        <SelectorMes periodo={periodo} setPeriodo={setPeriodo} />
      </div>

      {/* Los tres totales.
          "Falta pagar" junta dos cosas que conviene separar en el pie: lo que
          todavía no cerraste (no sabés el número final) y lo que cerraste pero
          no pagaste (la plata no salió). Son problemas distintos: uno lo
          resolvés vos en dos clicks, el otro depende de tener la plata. */}
      {!cargando && filas.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-2.5 mb-4">
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-neutral-500">Sueldos del mes</p>
            <p className="text-2xl font-extrabold text-neutral-900 tabular-nums">${formatearMonto(totales.total)}</p>
            <p className="text-xs text-neutral-400">
              {filas.length} {filas.length === 1 ? "empleado" : "empleados"}, ya sin adelantos
            </p>
          </div>
          <div
            className={`rounded-xl border px-4 py-3 ${
              totales.falta > 0 ? "border-amber-200 bg-amber-50" : "border-neutral-200 bg-neutral-50"
            }`}
          >
            <p
              className={`text-[10.5px] font-bold uppercase tracking-wide ${
                totales.falta > 0 ? "text-amber-700" : "text-neutral-500"
              }`}
            >
              Falta pagar
            </p>
            <p className={`text-2xl font-extrabold tabular-nums ${totales.falta > 0 ? "text-amber-700" : "text-neutral-400"}`}>
              ${formatearMonto(totales.falta)}
            </p>
            <p className={`text-xs ${totales.falta > 0 ? "text-amber-700/70" : "text-neutral-400"}`}>
              {totales.falta === 0
                ? "Todo pagado"
                : [
                    totales.sinPagar > 0 ? `${totales.sinPagar} sin pagar` : null,
                    totales.sinCerrar > 0 ? `${totales.sinCerrar} sin cerrar` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-emerald-700">Ya pagado</p>
            <p className="text-2xl font-extrabold text-emerald-700 tabular-nums">${formatearMonto(totales.pagado)}</p>
            <p className="text-xs text-emerald-700/70">
              {totales.pagados === 0
                ? "Todavía nadie"
                : `${totales.pagados} ${totales.pagados === 1 ? "empleado" : "empleados"}`}
            </p>
          </div>
        </div>
      )}

      {cargando && filas.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
      ) : (
        <div className="space-y-2.5">
          {usuarios.length === 0 && filas.length === 0 && (
            <p className="text-sm text-neutral-400 text-center py-8 bg-white border border-neutral-200 rounded-xl">
              No hay empleados con sueldo fijo o valor hora cargado.
            </p>
          )}
          {filas.map((f) => {
            const a = asistencia?.filas.find((x) => x.idPersona === f.idPersona);
            const sinSalida = (asistencia?.sinSalida ?? []).filter((s) => s.idPersona === f.idPersona).length;
            const porHora = f.modalidad === "POR_HORA";
            const libre = a?.horario.tipo === "LIBRE";
            const adel = f.cierre ? f.cierre.adelantos : f.adelantos;
            const presentismo = f.cierre ? f.cierre.incentivo_presentismo : f.incentivoPresentismoPreview;
            const base = f.cierre ? f.cierre.sueldo_base : f.montoBase;
            const cerrado = Boolean(f.cierre && !f.cierre.es_estimado);
            const pagado = f.cierre?.estado === "PAGADO" && !f.cierre.es_estimado;
            const trabado = !f.cierre && sinSalida > 0;
            type Paso = { titulo: string; texto: React.ReactNode; tono: "hecho" | "falta" | "ahora" | "nada" };
            const pasos: Paso[] = [
              sinSalida > 0
                ? {
                    titulo: "1. Horas",
                    texto: (
                      <>
                        {sinSalida} {sinSalida === 1 ? "día" : "días"} sin salida ·{" "}
                        <a href={`/rrhh/asistencia?mes=${mes}`} className="underline">
                          corregir
                        </a>
                      </>
                    ),
                    tono: "falta",
                  }
                : a?.horario.tipo === "SIN"
                  ? {
                      // No traba el cierre: es un pendiente, no un error. Pero
                      // mientras no se elija, el presentismo se paga completo.
                      titulo: "1. Horas",
                      texto: (
                        <>
                          horario sin definir ·{" "}
                          <a href={`/rrhh/asistencia?mes=${mes}&tab=reglas`} className="underline">
                            elegir
                          </a>
                        </>
                      ),
                      tono: "falta",
                    }
                  : { titulo: "1. Horas", texto: libre ? "horario libre, no hay que revisar" : porHora ? `${f.horasTrabajadasMes ?? 0} h revisadas` : "sueldo fijo, no hace falta", tono: "hecho" },
              { titulo: "2. Adelantos", texto: adel > 0 ? `$${formatearMonto(adel)} a descontar` : "no tuvo", tono: "hecho" },
              cerrado
                ? { titulo: "3. Cerrar", texto: `cerrado el ${new Date(f.cierre!.fecha_cierre).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}`, tono: "hecho" }
                : f.cierre?.es_estimado
                  ? { titulo: "3. Cerrar", texto: "estimado, falta el cierre real", tono: "falta" }
                  : trabado
                    ? { titulo: "3. Cerrar", texto: "cuando estén las horas", tono: "nada" }
                    : { titulo: "3. Cerrar", texto: "listo para cerrar", tono: "ahora" },
              pagado
                ? { titulo: "4. Pagar", texto: f.cierre?.fecha_pago ? `pagado el ${new Date(f.cierre.fecha_pago).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}` : "pagado", tono: "hecho" }
                : cerrado
                  ? { titulo: "4. Pagar", texto: "listo para pagar", tono: "ahora" }
                  : { titulo: "4. Pagar", texto: "—", tono: "nada" },
            ];
            const claseTono = {
              hecho: "bg-emerald-50 text-emerald-700",
              falta: "bg-amber-50 text-amber-800",
              ahora: "bg-accent-tint text-accent ring-1 ring-accent",
              nada: "bg-neutral-100 text-neutral-500",
            };
            return (
              <div key={f.idUsuario} className="bg-white border border-neutral-200 rounded-xl p-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.6fr)_auto] items-center">
                <div className="min-w-0">
                  <button type="button" onClick={() => onAbrirFicha(f.idPersona)} className="text-[15px] font-semibold text-neutral-900 hover:underline text-left">
                    {f.nombre}
                  </button>
                  <p className="text-xs text-neutral-400">
                    {porHora ? `Por hora $${formatearMonto(f.valorHora ?? 0)}` : `Fijo $${formatearMonto(f.sueldoBase)}`} · {a?.horario.texto ?? ""}
                    {" · "}
                    <button
                      type="button"
                      onClick={() => {
                        setEditando(f.idUsuario);
                        setValorEditSueldo(String(f.sueldoBase));
                        setValorEditHora(String(f.valorHora ?? 0));
                        setValorEditCobra(f.cobraPresentismo);
                      }}
                      className="text-accent hover:underline"
                    >
                      editar sueldo
                    </button>
                  </p>
                  <p className="text-[13px] text-neutral-500 mt-1.5 tabular-nums">
                    {porHora
                      ? `${f.cierre ? "" : `${f.horasTrabajadasMes ?? 0} h × $${formatearMonto(f.valorHora ?? 0)} = `}$${formatearMonto(base)}`
                      : `$${formatearMonto(base)}`}
                    {" + presentismo "}
                    {f.cobraPresentismo ? `$${formatearMonto(presentismo)}${presentismo === 0 && f.presentismoResultado === "PERDIDO" ? " (lo perdió)" : ""}` : "no cobra"}
                    {` − adelantos $${formatearMonto(adel)} = `}
                    <b className="text-neutral-900">${formatearMonto(netoDe(f))}</b>
                  </p>
                  {editando === f.idUsuario && (
                    <div className="mt-2 flex flex-wrap items-end gap-2 bg-neutral-50 rounded-lg p-2.5">
                      <label className="text-[11px] text-neutral-500">
                        Fijo $
                        <input
                          autoFocus
                          value={valorEditSueldo}
                          onChange={(e) => setValorEditSueldo(e.target.value)}
                          className="block w-24 border border-neutral-300 rounded-lg px-2 py-1 text-sm text-right"
                        />
                      </label>
                      <label className="text-[11px] text-neutral-500">
                        Valor hora $
                        <input
                          value={valorEditHora}
                          onChange={(e) => setValorEditHora(e.target.value)}
                          className="block w-24 border border-neutral-300 rounded-lg px-2 py-1 text-sm text-right"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] text-neutral-600 cursor-pointer pb-1.5">
                        <input type="checkbox" checked={valorEditCobra} onChange={(e) => setValorEditCobra(e.target.checked)} className="accent-accent" />
                        Cobra presentismo
                      </label>
                      <button onClick={() => handleGuardarPagoBase(f.idUsuario)} disabled={guardandoSueldo} className="text-xs font-semibold text-white bg-accent rounded-lg px-3 py-1.5">
                        {guardandoSueldo ? "Guardando..." : "Guardar"}
                      </button>
                      <button onClick={() => setEditando(null)} className="text-xs text-neutral-500 px-2 py-1.5">
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {pasos.map((p) => (
                    <div key={p.titulo} className={`rounded-lg px-2.5 py-2 text-[12px] ${claseTono[p.tono]}`}>
                      <b className="block text-[12.5px]">{p.titulo}</b>
                      {p.texto}
                    </div>
                  ))}
                </div>
                <div className="text-right">
                  <span className="block text-xs text-neutral-400">{f.cierre?.es_estimado ? "Estimado" : "A pagar"}</span>
                  <b className="block text-xl tabular-nums text-neutral-900 mb-1.5">${formatearMonto(netoDe(f))}</b>
                  {!f.cierre ? (
                    <div className="flex items-center justify-end gap-2.5">
                      {porHora && (
                        <button onClick={() => setModalEstimar(f)} className="text-xs text-neutral-400 hover:text-accent">
                          Estimar
                        </button>
                      )}
                      <button
                        onClick={() => setModalCerrar(f)}
                        disabled={trabado}
                        title={trabado ? "Primero corregí los días sin salida en Asistencia" : undefined}
                        className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg"
                      >
                        Cerrar sueldo
                      </button>
                    </div>
                  ) : f.cierre.es_estimado ? (
                    <div className="flex items-center justify-end gap-2.5">
                      <button onClick={() => handleDeshacerCierre(f)} className="text-xs text-neutral-400 hover:text-red-600">
                        Deshacer
                      </button>
                      <button
                        onClick={() => setModalCerrar(f)}
                        disabled={sinSalida > 0}
                        className="text-xs font-bold text-white bg-accent hover:bg-accent-dark disabled:opacity-40 px-3 py-1.5 rounded-lg"
                      >
                        Cerrar (real)
                      </button>
                    </div>
                  ) : f.cierre.estado === "PENDIENTE_PAGO" ? (
                    <div className="flex items-center justify-end gap-2.5">
                      <button onClick={() => handleDeshacerCierre(f)} className="text-xs text-neutral-400 hover:text-red-600">
                        Deshacer
                      </button>
                      <button onClick={() => setModalPagar(f)} className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg">
                        Pagar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-2.5">
                      <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">✓ Pagado</span>
                      {f.cierre.comprobante_path && (
                        <button onClick={() => handleVerComprobante(f.cierre!.comprobante_path!)} className="text-xs font-semibold text-accent">
                          Ver comprobante
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Empleados que no pueden cobrar: no aparecen en la nómina hasta que
              tengan usuario y sueldo. Se muestran igual, para que no se olviden. */}
          {(asistencia?.filas ?? [])
            .filter((x) => !filas.some((f) => f.idPersona === x.idPersona))
            .map((x) => (
              <div key={x.idPersona} className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => onAbrirFicha(x.idPersona)} className="text-[15px] font-semibold text-neutral-900 hover:underline text-left">
                    {x.nombre}
                  </button>
                  <p className="text-[13px] text-red-600">No puede cobrar: le falta el usuario vinculado o el sueldo.</p>
                </div>
                <p className="text-[12.5px] rounded-lg px-3 py-2 bg-amber-50 text-amber-800">Antes de cerrar, cargale usuario y sueldo.</p>
                <button type="button" onClick={() => onAbrirFicha(x.idPersona)} className="text-xs font-semibold text-accent border border-neutral-200 rounded-lg px-3 py-1.5">
                  Abrir ficha
                </button>
              </div>
            ))}

          {anteriores.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-xl p-4 text-[13px]">
              <p className="font-semibold text-neutral-900 mb-1.5">Quedó sin pagar de meses anteriores</p>
              <div className="space-y-1">
                {anteriores.map((s) => (
                  <p key={`${s.idPersona}-${s.periodo}`} className="flex flex-wrap items-center gap-2 text-neutral-600">
                    <span>
                      {s.etiquetaMes}: {s.nombre} <b className="text-neutral-900 tabular-nums">${formatearMonto(s.neto)}</b>
                    </span>
                    <button type="button" onClick={() => setPeriodo(s.periodo)} className="text-accent font-semibold hover:underline">
                      Ir a ese mes para pagarlo →
                    </button>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {modalCerrar && (
        <ModalCerrarNomina
          fila={modalCerrar}
          mes={mes}
          onClose={() => setModalCerrar(null)}
          onCerrado={() => {
            setModalCerrar(null);
            recargar();
          }}
        />
      )}

      {modalEstimar && (
        <ModalEstimarNomina
          fila={modalEstimar}
          mes={mes}
          onClose={() => setModalEstimar(null)}
          onEstimado={() => {
            setModalEstimar(null);
            recargar();
          }}
        />
      )}

      {modalPagar && modalPagar.cierre && (
        <ModalPagarNomina
          fila={modalPagar}
          onClose={() => setModalPagar(null)}
          onPagado={() => {
            setModalPagar(null);
            recargar();
          }}
        />
      )}
    </div>
  );
}

// ===================== AGUINALDO =====================

function TabAguinaldo() {
  const [semestre, setSemestre] = useState(semestreActual());
  const [filas, setFilas] = useState<FilaAguinaldo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [montoEdit, setMontoEdit] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [modalPagar, setModalPagar] = useState<FilaAguinaldo | null>(null);

  function recargar() {
    setCargando(true);
    obtenerAguinaldos(semestre).then(setFilas).finally(() => setCargando(false));
  }

  useEffect(recargar, [semestre]);

  function handleCerrar(f: FilaAguinaldo) {
    const monto = Number(montoEdit.replace(/[^\d.-]/g, "")) || 0;
    setError(null);
    setGuardando(true);
    cerrarAguinaldo(f.idPersona, f.idUsuario, semestre, monto)
      .then((res) => {
        if (res.error) setError(res.error);
        else {
          setEditando(null);
          recargar();
        }
      })
      .finally(() => setGuardando(false));
  }

  function handleDeshacer(f: FilaAguinaldo) {
    if (!f.cierre) return;
    if (!confirm(`¿Deshacer el aguinaldo de ${f.nombre}? Se anula el gasto que generó.`)) return;
    eliminarCierreAguinaldo(f.cierre.id_cierre).then((res) => {
      if (res.error) alert(res.error);
      else recargar();
    });
  }

  const [anio, nro] = semestre.split("-").map(Number);
  const habilitado = puedeCerrarseAguinaldo(semestre);

  return (
    <div>
      <p className="text-xs text-neutral-400 mb-3">
        Medio sueldo por semestre, calculado sobre la <strong>mejor remuneración</strong> de esos meses (no el promedio),
        y en proporción a los días trabajados si la persona entró empezado el semestre. El monto es editable antes de
        cerrar. El gasto entra completo en el mes en que lo cerrás, y el pago se puede hacer en una o varias veces.
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="flex items-center gap-2 mb-4">
        <select
          value={semestre}
          onChange={(e) => setSemestre(e.target.value)}
          className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm bg-white"
        >
          {[anio - 1, anio, anio + 1].flatMap((a) => [`${a}-1`, `${a}-2`]).map((s) => (
            <option key={s} value={s}>
              {etiquetaSemestre(s)}
            </option>
          ))}
        </select>
        <span className="text-xs text-neutral-400">{nro === 1 ? "Se paga hasta el 30 de junio" : "Se paga hasta el 18 de diciembre"}</span>
      </div>

      {habilitado ? (
        <p className="text-xs text-neutral-500 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 mb-4">
          Los días se cuentan <strong>hasta hoy</strong>. Vencimiento legal de pago:{" "}
          <strong>{nro === 1 ? "30 de junio" : "18 de diciembre"}</strong> — si lo pagás en cuotas, la última debería
          caer antes de esa fecha.
        </p>
      ) : (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          Este semestre todavía no terminó, así que no se puede cerrar. Vas a poder hacerlo a partir de{" "}
          <strong>{nro === 1 ? `junio de ${anio}` : `diciembre de ${anio}`}</strong>. Mientras tanto podés mirar cómo
          viene el cálculo.
        </p>
      )}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : filas.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">No hay personas activas vinculadas a un usuario.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Empleado</th>
                  <th className="p-3 text-right">Mejor sueldo del semestre</th>
                  <th className="p-3 text-right">Días trabajados</th>
                  <th className="p-3 text-right">Aguinaldo</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.idPersona} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3">
                      {f.nombre}
                      {f.mesesConCierre === 0 && (
                        <span className="block text-[10.5px] text-amber-600">Sin nóminas cerradas en el semestre</span>
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums">${formatearMonto(f.mejorRemuneracion)}</td>
                    <td className="p-3 text-right tabular-nums text-neutral-500">
                      {f.diasTrabajados}
                      <span className="text-neutral-300"> / 180</span>
                      {f.sinFechaIngreso && (
                        <span className="block text-[10.5px] text-amber-600 font-semibold whitespace-normal">
                          Falta la fecha de ingreso — se asumió el semestre completo
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {f.cierre ? (
                        <>
                          <span className="font-bold tabular-nums">${formatearMonto(f.cierre.monto)}</span>
                          {f.totalPagado > 0 && f.saldo > 0 && (
                            <span className="block text-[10.5px] text-amber-600">
                              Pagado ${formatearMonto(f.totalPagado)} · falta ${formatearMonto(f.saldo)}
                            </span>
                          )}
                        </>
                      ) : editando === f.idPersona ? (
                        <input
                          autoFocus
                          value={montoEdit}
                          onChange={(e) => setMontoEdit(e.target.value)}
                          className="w-28 border border-neutral-300 rounded-lg px-2 py-1 text-sm text-right"
                        />
                      ) : (
                        <span className="tabular-nums text-neutral-500">${formatearMonto(f.montoSugerido)}</span>
                      )}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {!f.cierre ? (
                        editando === f.idPersona ? (
                          <div className="flex items-center justify-end gap-2.5">
                            <button onClick={() => setEditando(null)} className="text-xs text-neutral-400">
                              Cancelar
                            </button>
                            <button
                              onClick={() => handleCerrar(f)}
                              disabled={guardando}
                              className="text-xs font-bold text-white bg-accent hover:bg-accent-dark px-3 py-1.5 rounded-lg disabled:opacity-50"
                            >
                              {guardando ? "..." : "Confirmar"}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditando(f.idPersona);
                              setMontoEdit(String(f.montoSugerido));
                            }}
                            disabled={f.montoSugerido <= 0 || !habilitado}
                            title={habilitado ? undefined : "El semestre todavía no terminó"}
                            className="text-xs font-bold text-white bg-accent hover:bg-accent-dark px-3 py-1.5 rounded-lg disabled:opacity-40"
                          >
                            Cerrar aguinaldo
                          </button>
                        )
                      ) : f.cierre.estado === "PENDIENTE_PAGO" ? (
                        <div className="flex items-center justify-end gap-2.5">
                          {f.totalPagado === 0 && (
                            <button onClick={() => handleDeshacer(f)} className="text-xs text-neutral-400 hover:text-red-600">
                              Deshacer
                            </button>
                          )}
                          <button
                            onClick={() => setModalPagar(f)}
                            className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg"
                          >
                            {f.totalPagado > 0 ? "Pagar saldo" : "Pagar"}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">✓ Pagado</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalPagar?.cierre && (
        <ModalPagarAguinaldo
          fila={modalPagar}
          onClose={() => setModalPagar(null)}
          onPagado={() => {
            setModalPagar(null);
            recargar();
          }}
        />
      )}
    </div>
  );
}

function ModalPagarAguinaldo({ fila, onClose, onPagado }: { fila: FilaAguinaldo; onClose: () => void; onPagado: () => void }) {
  const cierre = fila.cierre!;
  const [monto, setMonto] = useState(String(fila.saldo));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    registrarPagoAguinaldo(cierre.id_cierre, new FormData(e.currentTarget))
      .then((res) => {
        if (res.error) setError(res.error);
        else onPagado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <form onSubmit={handleSubmit} className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Pagar aguinaldo</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <p className="text-xs text-neutral-400 -mt-2 mb-1">
          {fila.nombre} · {etiquetaSemestre(cierre.semestre)}
        </p>
        <p className="text-2xl font-extrabold text-neutral-900 tabular-nums">${formatearMonto(fila.saldo)}</p>
        <p className="text-xs text-neutral-400 mb-4">
          {fila.totalPagado > 0
            ? `Saldo pendiente · ya pagaste $${formatearMonto(fila.totalPagado)} de $${formatearMonto(cierre.monto)}`
            : "Podés pagarlo todo junto o en partes."}
        </p>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="mb-3">
          <label className="block text-xs font-medium text-neutral-600 mb-1">Monto de este pago *</label>
          <input
            type="number"
            name="monto"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <p className="text-[10.5px] text-neutral-400 mt-1">Dejalo como está para cancelar todo, o poné menos para pagar una parte.</p>
        </div>

        <div className="mb-3">
          <label className="block text-xs font-medium text-neutral-600 mb-1.5">¿De dónde sale la plata? *</label>
          <div className="flex gap-2">
            <label className="flex-1 flex items-center gap-2 border border-neutral-300 rounded-lg px-3 py-2 text-sm cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent-tint">
              <input type="radio" name="cuenta_pago" value="CAJA_ADMIN" defaultChecked /> Caja Administración
            </label>
            <label className="flex-1 flex items-center gap-2 border border-neutral-300 rounded-lg px-3 py-2 text-sm cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent-tint">
              <input type="radio" name="cuenta_pago" value="TRANSFERENCIA" /> Transferencia
            </label>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-neutral-600 mb-1">Comprobante *</label>
          <input type="file" name="comprobante" required accept="image/*,.pdf" className="w-full text-sm" />
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={guardando} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm">
            {guardando ? "Guardando..." : "Confirmar pago"}
          </button>
        </div>
      </form>
    </div>
  );
}

function BloqueFeriados() {
  const [abierto, setAbierto] = useState(false);
  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [cargando, setCargando] = useState(false);
  const [fecha, setFecha] = useState("");
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function recargar() {
    setCargando(true);
    listarFeriados().then(setFeriados).finally(() => setCargando(false));
  }

  useEffect(() => {
    if (abierto) recargar();
  }, [abierto]);

  function handleAgregar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!fecha || !nombre.trim()) {
      setError("Completá la fecha y el nombre");
      return;
    }
    setGuardando(true);
    crearFeriado(fecha, nombre)
      .then((res) => {
        if (res.error) setError(res.error);
        else {
          setFecha("");
          setNombre("");
          recargar();
        }
      })
      .finally(() => setGuardando(false));
  }

  function handleEliminar(f: Feriado) {
    if (!confirm(`¿Eliminar "${f.nombre}" (${f.fecha}) de la lista de feriados?`)) return;
    eliminarFeriado(f.fecha).then(() => recargar());
  }

  return (
    <div className="relative">
      <button onClick={() => setAbierto((v) => !v)} className="text-xs font-semibold text-accent">
        {abierto ? "▾" : "▸"} Feriados (pago doble por hora)
      </button>

      {abierto && (
        <div className="absolute right-0 z-10 mt-2 w-80 bg-white border border-neutral-200 rounded-xl shadow-lg p-3">
          <p className="text-[10.5px] text-neutral-400 mb-2">
            Los que cobran por hora cobran doble si trabajan un día de esta lista. No afecta a los de sueldo fijo.
          </p>
          {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
          <form onSubmit={handleAgregar} className="flex items-center gap-1.5 mb-2">
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="border border-neutral-300 rounded-lg px-2 py-1 text-xs" />
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre"
              className="flex-1 min-w-0 border border-neutral-300 rounded-lg px-2 py-1 text-xs"
            />
            <button type="submit" disabled={guardando} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark px-2.5 py-1 rounded-lg whitespace-nowrap">
              {guardando ? "..." : "+ Agregar"}
            </button>
          </form>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {cargando ? (
              <p className="text-xs text-neutral-400 text-center py-3">Cargando...</p>
            ) : feriados.length === 0 ? (
              <p className="text-xs text-neutral-400 text-center py-3">No hay feriados cargados.</p>
            ) : (
              feriados.map((f) => (
                <div key={f.fecha} className="flex items-center justify-between text-xs px-1.5 py-1 rounded hover:bg-neutral-50">
                  <span>
                    <span className="text-neutral-400 tabular-nums mr-2">{f.fecha}</span>
                    {f.nombre}
                  </span>
                  <button onClick={() => handleEliminar(f)} className="text-neutral-300 hover:text-red-600">
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModalCerrarNomina({
  fila,
  mes,
  onClose,
  onCerrado,
}: {
  fila: NovedadNomina;
  mes: string;
  onClose: () => void;
  onCerrado: () => void;
}) {
  const [horasExtraMonto, setHorasExtraMonto] = useState("0");
  const [premiosMonto, setPremiosMonto] = useState("0");
  // Arranca destildado para quien no cobra presentismo.
  const [incluirIncentivo, setIncluirIncentivo] = useState(fila.cobraPresentismo);
  const [esFormal, setEsFormal] = useState(false);
  const [aportesEmpleado, setAportesEmpleado] = useState("0");
  const [contribucionesPatronales, setContribucionesPatronales] = useState("0");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const incentivoAplicado = incluirIncentivo ? fila.incentivoPresentismoPreview : 0;
  const bruto = fila.montoBase + incentivoAplicado + (Number(horasExtraMonto) || 0) + (Number(premiosMonto) || 0);
  const netoPreview = esFormal ? bruto - (Number(aportesEmpleado) || 0) - fila.adelantos : bruto - fila.adelantos;
  const costoEmpresaPreview = esFormal ? bruto + (Number(contribucionesPatronales) || 0) : bruto;

  function handleToggleFormal(checked: boolean) {
    setEsFormal(checked);
    if (checked) {
      setAportesEmpleado(String(Math.round(bruto * 0.17)));
      setContribucionesPatronales(String(Math.round(bruto * 0.24)));
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    cerrarNomina(fila.idPersona, fila.idUsuario, mes, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else onCerrado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <form onSubmit={handleSubmit} className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Cerrar nómina</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <p className="text-xs text-neutral-400 -mt-2 mb-4">{fila.nombre} · {mes}</p>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {fila.cierre?.es_estimado && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            Tenías un estimado de ${formatearMonto(fila.cierre.sueldo_base)} cargado — al confirmar, se reemplaza por
            el cálculo real de abajo.
          </p>
        )}

        <div className="bg-neutral-50 rounded-lg p-3 mb-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-500">
              {fila.modalidad === "POR_HORA" ? `Horas fichadas hasta hoy (${fila.horasTrabajadasMes ?? 0} hs × $${formatearMonto(fila.valorHora ?? 0)})` : "Sueldo base"}
            </span>
            <span className="tabular-nums font-medium">${formatearMonto(fila.montoBase)}</span>
          </div>
          {fila.modalidad === "POR_HORA" && (fila.horasFeriadoMes ?? 0) > 0 && (
            <p className="text-[10.5px] text-amber-600">
              Incluye {fila.horasFeriadoMes} hs en feriado, pagadas doble.
            </p>
          )}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-neutral-500 flex items-center gap-1.5">
              <input
                type="checkbox"
                name="incluir_incentivo"
                checked={incluirIncentivo}
                onChange={(e) => setIncluirIncentivo(e.target.checked)}
                className="accent-accent"
              />
              Incentivo presentismo ({RESULTADO_LABEL_NOMINA[fila.presentismoResultado]})
            </span>
            <span className={`tabular-nums font-medium ${!incluirIncentivo ? "line-through text-neutral-300" : ""}`}>
              ${formatearMonto(fila.incentivoPresentismoPreview)}
            </span>
          </label>
          {fila.adelantos > 0 && (
            <div className="flex justify-between text-red-600">
              <span>Adelantos del mes</span>
              <span className="tabular-nums font-medium">-${formatearMonto(fila.adelantos)}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Horas extra ($)</label>
            <input
              type="number"
              name="horas_extra_monto"
              value={horasExtraMonto}
              onChange={(e) => setHorasExtraMonto(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Premios ($)</label>
            <input
              type="number"
              name="premios_monto"
              value={premiosMonto}
              onChange={(e) => setPremiosMonto(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mb-3">
          <label className="block text-xs font-medium text-neutral-600 mb-1">Detalle (opcional)</label>
          <input name="horas_extra_detalle" placeholder="Ej: 8 hs extra sábado 15" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm mb-2" />
          <input name="premios_detalle" placeholder="Ej: premio por objetivo cumplido" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
        </div>

        <label className="flex items-center gap-1.5 text-sm text-neutral-700 mb-2 cursor-pointer">
          <input
            type="checkbox"
            name="es_formal"
            checked={esFormal}
            onChange={(e) => handleToggleFormal(e.target.checked)}
            className="accent-accent"
          />
          Empleo formal (en blanco)
        </label>

        {esFormal && (
          <div className="bg-neutral-50 rounded-lg p-3 mb-3">
            <p className="text-[10.5px] text-neutral-400 mb-2">
              % sugeridos (17% aportes / 24% contribuciones) son aproximados — ajustalos con lo que te confirme tu
              contador según convenio y categoría.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Aportes empleado ($)</label>
                <input
                  type="number"
                  name="aportes_empleado"
                  value={aportesEmpleado}
                  onChange={(e) => setAportesEmpleado(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                />
                <p className="text-[10px] text-neutral-400 mt-0.5">Se descuenta del neto que recibe.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Contribuciones patronales ($)</label>
                <input
                  type="number"
                  name="contribuciones_patronales"
                  value={contribucionesPatronales}
                  onChange={(e) => setContribucionesPatronales(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                />
                <p className="text-[10px] text-neutral-400 mt-0.5">No se descuenta al empleado, es costo empresa.</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between bg-accent-tint rounded-lg px-3 py-2.5 mb-2">
          <span className="text-sm font-semibold text-neutral-700">Neto a pagar</span>
          <span className="text-lg font-extrabold text-accent tabular-nums">${formatearMonto(netoPreview)}</span>
        </div>
        {esFormal && (
          <p className="text-[10.5px] text-neutral-400 mb-2 text-right">Costo total para la empresa: ${formatearMonto(costoEmpresaPreview)}</p>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm">
            {guardando ? "Cerrando..." : "Cerrar nómina"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ModalEstimarNomina({
  fila,
  mes,
  onClose,
  onEstimado,
}: {
  fila: NovedadNomina;
  mes: string;
  onClose: () => void;
  onEstimado: () => void;
}) {
  const [monto, setMonto] = useState(fila.cierre ? String(fila.cierre.sueldo_base) : String(fila.montoBase || ""));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const valor = Number(monto) || 0;
    setGuardando(true);
    estimarNomina(fila.idPersona, fila.idUsuario, mes, valor)
      .then((res) => {
        if (res.error) setError(res.error);
        else onEstimado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <form onSubmit={handleSubmit} className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Estimar nómina</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <p className="text-xs text-neutral-400 -mt-2 mb-4">{fila.nombre} · {mes}</p>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <p className="text-xs text-neutral-500 mb-3">
          Cargá un monto aproximado para verlo reflejado ya en el Estado de Resultados. Sugerido según horas fichadas
          hasta hoy: {fila.horasTrabajadasMes ?? 0} hs × ${formatearMonto(fila.valorHora ?? 0)} = ${formatearMonto(fila.montoBase)}.
          Cuando tengas el mes completo, tocá "Cerrar (real)" y esto se reemplaza solo por el cálculo exacto.
        </p>

        <div className="mb-4">
          <label className="block text-xs font-medium text-neutral-600 mb-1">Monto estimado ($)</label>
          <input
            type="number"
            autoFocus
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm">
            {guardando ? "Guardando..." : "Guardar estimado"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ModalPagarNomina({ fila, onClose, onPagado }: { fila: NovedadNomina; onClose: () => void; onPagado: () => void }) {
  const cierre = fila.cierre!;
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    pagarNomina(cierre.id_cierre, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else onPagado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <form onSubmit={handleSubmit} className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Registrar pago</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <p className="text-xs text-neutral-400 -mt-2 mb-1">{fila.nombre} · {cierre.periodo}</p>
        <p className="text-2xl font-extrabold text-neutral-900 tabular-nums mb-4">${formatearMonto(cierre.neto_a_pagar)}</p>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="mb-3">
          <label className="block text-xs font-medium text-neutral-600 mb-1.5">¿De dónde sale la plata? *</label>
          <div className="flex gap-2">
            <label className="flex-1 flex items-center gap-2 border border-neutral-300 rounded-lg px-3 py-2 text-sm cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent-tint">
              <input type="radio" name="cuenta_pago" value="CAJA_ADMIN" defaultChecked /> Caja Administración
            </label>
            <label className="flex-1 flex items-center gap-2 border border-neutral-300 rounded-lg px-3 py-2 text-sm cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent-tint">
              <input type="radio" name="cuenta_pago" value="TRANSFERENCIA" /> Transferencia
            </label>
          </div>
        </div>

        {/* El flujo pensado: se descarga el recibo ya armado con los datos
            del cierre, se imprime, lo firma el trabajador, y esa copia
            firmada es la que se sube acá. */}
        <div className="bg-accent-tint border border-accent/30 rounded-lg p-3 mb-3">
          <p className="text-xs font-semibold text-neutral-800 mb-1">1. Descargá el recibo y hacelo firmar</p>
          <a
            href={`/rrhh/recibo/${cierre.id_cierre}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-white border border-accent text-accent-dark font-semibold px-3 py-1.5 rounded-lg text-sm"
          >
            📄 Descargar recibo
          </a>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-neutral-600 mb-1">2. Subí el recibo firmado *</label>
          <input type="file" name="comprobante" required accept="image/*,.pdf" className="w-full text-sm" />
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={guardando} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm">
            {guardando ? "Guardando..." : "Confirmar pago"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ===================== HORARIOS =====================

function TabHorarios({ horarios, onCambio }: { horarios: HorarioTrabajo[]; onCambio: () => void }) {
  const [modal, setModal] = useState<"nuevo" | HorarioTrabajo | null>(null);

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900">Horarios de trabajo</h2>
          <p className="text-xs text-neutral-400 max-w-xl">
            Creá horarios con nombre (por ejemplo &ldquo;Turno mañana&rdquo;) y elegí arriba cuál tiene cada uno. No es lo mismo que el turno de caja.
          </p>
        </div>
        <button onClick={() => setModal("nuevo")} className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium">
          + Nuevo horario
        </button>
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        {horarios.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-10">Todavía no hay horarios creados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="p-3">Nombre</th>
                <th className="p-3">Entrada</th>
                <th className="p-3">Salida</th>
                <th className="p-3">Tolerancia</th>
                <th className="p-3">Días</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {horarios.map((h) => (
                <tr key={h.id_horario} className="border-b border-neutral-100 last:border-0">
                  <td className="p-3 font-medium text-neutral-900">{h.nombre}</td>
                  <td className="p-3 text-neutral-500">{h.hora_entrada.slice(0, 5)}</td>
                  <td className="p-3 text-neutral-500">{h.hora_salida ? h.hora_salida.slice(0, 5) : "—"}</td>
                  <td className="p-3 text-neutral-500">{h.tolerancia_minutos} min</td>
                  <td className="p-3 text-neutral-500">{h.dias_semana.map((d) => DIAS_LABEL[d]).join(" ")}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button onClick={() => setModal(h)} className="text-sm text-accent hover:underline mr-3">
                      Editar
                    </button>
                    <button onClick={() => desactivarHorario(h.id_horario).then(onCambio)} className="text-sm text-red-500 hover:text-red-700">
                      Desactivar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <ModalHorario
          horario={modal === "nuevo" ? null : modal}
          onClose={() => setModal(null)}
          onGuardado={() => {
            setModal(null);
            onCambio();
          }}
        />
      )}
    </div>
  );
}

function ModalHorario({ horario, onClose, onGuardado }: { horario: HorarioTrabajo | null; onClose: () => void; onGuardado: () => void }) {
  const isEditing = !!horario;
  const [diasSeleccionados, setDiasSeleccionados] = useState<number[]>(horario?.dias_semana ?? [1, 2, 3, 4, 5]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDia(dia: number) {
    setDiasSeleccionados((prev) => (prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia].sort()));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.set("dias_semana", diasSeleccionados.join(","));
    setGuardando(true);
    (isEditing ? actualizarHorario(horario!.id_horario, formData) : crearHorario(formData))
      .then((res) => {
        if (res.error) setError(res.error);
        else onGuardado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <form onSubmit={handleSubmit} className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">{isEditing ? "Editar horario" : "Nuevo horario"}</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="mb-3">
          <label className="block text-xs font-medium text-neutral-600 mb-1">Nombre *</label>
          <input name="nombre" defaultValue={horario?.nombre ?? ""} required placeholder="Ej: Turno Mañana" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Hora entrada *</label>
            <input type="time" name="hora_entrada" defaultValue={horario?.hora_entrada.slice(0, 5) ?? ""} required className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Hora salida</label>
            <input type="time" name="hora_salida" defaultValue={horario?.hora_salida?.slice(0, 5) ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Tolerancia (min)</label>
            <input type="number" name="tolerancia_minutos" defaultValue={horario?.tolerancia_minutos ?? 5} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-xs font-medium text-neutral-600 mb-1.5">Días que aplica</label>
          <div className="flex gap-1.5 flex-wrap">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDia(d)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                  diasSeleccionados.includes(d) ? "bg-accent-tint border-accent text-accent-dark" : "border-neutral-200 text-neutral-400"
                }`}
              >
                {DIAS_LABEL[d]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm">
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ===================== ADELANTOS =====================
//
// Es una lista de control, no un formulario: cuando alguien te pide plata,
// lo primero que querés saber es cuánto ya se le dio este mes.
//
// El adelanto se sigue pudiendo cargar desde Gastos e Ingresos como siempre;
// esta pantalla agrega el botón sin salir de RR.HH. y, sobre todo, la lista
// — que hasta ahora no existía en ningún lado.

const MEDIO_ADELANTO: { valor: string; etiqueta: string; nota: string }[] = [
  { valor: "EFECTIVO_ADMIN", etiqueta: "Caja Administración", nota: "sale de la caja chica" },
  { valor: "TRANSFERENCIA", etiqueta: "Transferencia", nota: "no toca caja" },
  { valor: "MERCADO_PAGO", etiqueta: "Mercado Pago", nota: "no toca caja" },
];

function TabAdelantos({ usuarios, periodo, setPeriodo }: { usuarios: UsuarioMin[]; periodo: string; setPeriodo: (p: string) => void }) {
  const mes = periodo;
  const setMes = setPeriodo;
  const [filas, setFilas] = useState<AdelantoListado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState(false);

  function recargar() {
    setCargando(true);
    listarAdelantos(mes)
      .then(setFilas)
      .finally(() => setCargando(false));
  }
  useEffect(recargar, [mes]);

  const total = filas.reduce((a, f) => a + f.monto, 0);
  // Por persona: es la pregunta real cuando alguien te pide otro.
  const porPersona = new Map<string, { nombre: string; total: number; veces: number }>();
  for (const f of filas) {
    const acc = porPersona.get(f.idUsuario) ?? { nombre: f.nombre, total: 0, veces: 0 };
    acc.total += f.monto;
    acc.veces += 1;
    porPersona.set(f.idUsuario, acc);
  }

  function handleAnular(f: AdelantoListado) {
    if (f.descontado) {
      alert(
        "Este adelanto ya entró en una nómina cerrada de este mes. Deshacé el cierre en Sueldos antes de anularlo, " +
          "si no el neto que pagaste y el que figura no van a coincidir."
      );
      return;
    }
    const motivo = window.prompt(`Anular el adelanto de ${f.nombre} por $${formatearMonto(f.monto)}.\n\n¿Por qué?`, "Se cargó por error");
    if (motivo === null) return;
    anularAdelanto(f.idGasto, motivo).then((res) => {
      if (res.error) alert(res.error);
      else recargar();
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <SelectorMes periodo={mes} setPeriodo={setMes} />
        <button
          onClick={() => setNuevo(true)}
          className="bg-accent hover:bg-accent-dark text-white text-sm font-semibold px-3.5 py-2 rounded-lg"
        >
          + Registrar adelanto
        </button>
      </div>

      {!cargando && filas.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-2.5 mb-4">
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-neutral-500">Adelantado este mes</p>
            <p className="text-2xl font-extrabold text-neutral-900 tabular-nums">${formatearMonto(total)}</p>
            <p className="text-xs text-neutral-400">
              {filas.length} {filas.length === 1 ? "adelanto" : "adelantos"} a {porPersona.size}{" "}
              {porPersona.size === 1 ? "persona" : "personas"}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-neutral-500">Por persona</p>
            <div className="mt-1 space-y-0.5">
              {[...porPersona.values()]
                .sort((a, b) => b.total - a.total)
                .map((p) => (
                  <div key={p.nombre} className="flex justify-between gap-3 text-[13px] tabular-nums">
                    <span className="text-neutral-700 truncate">
                      {p.nombre}
                      {p.veces > 1 && <span className="text-neutral-400 text-xs"> · {p.veces} veces</span>}
                    </span>
                    <span className="font-semibold whitespace-nowrap">${formatearMonto(p.total)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : filas.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-10">
            Nadie pidió un adelanto este mes.
          </p>
        ) : (
          filas.map((f) => (
            <div
              key={f.idGasto}
              className="flex items-center gap-3 flex-wrap px-4 py-3 border-b border-neutral-100 last:border-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-neutral-900">{f.nombre}</span>
                <span className="block text-[11.5px] text-neutral-400">
                  {new Date(`${f.fecha.slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR")}
                  {f.medioPago && ` · ${MEDIO_PAGO_CORTO[f.medioPago] ?? f.medioPago}`}
                  {f.descripcion && ` · ${f.descripcion}`}
                </span>
              </span>
              {/* Si ya se descontó, esa plata salió del neto de una nómina
                  cerrada: anularlo sin deshacer el cierre deja los números
                  contando historias distintas. */}
              <span
                className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap ${
                  f.descontado ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {f.descontado ? "Ya descontado" : "Se descuenta al cerrar"}
              </span>
              <span className="text-base font-bold tabular-nums whitespace-nowrap">${formatearMonto(f.monto)}</span>
              <button
                onClick={() => handleAnular(f)}
                className="text-[11px] font-semibold text-neutral-400 hover:text-red-600"
              >
                Anular
              </button>
            </div>
          ))
        )}
      </div>

      {nuevo && (
        <ModalAdelanto
          usuarios={usuarios}
          onClose={() => setNuevo(false)}
          onGuardado={() => {
            setNuevo(false);
            recargar();
          }}
        />
      )}
    </div>
  );
}

const MEDIO_PAGO_CORTO: Record<string, string> = {
  EFECTIVO_ADMIN: "caja administración",
  EFECTIVO_TURNO: "efectivo del turno",
  TRANSFERENCIA: "transferencia",
  MERCADO_PAGO: "Mercado Pago",
};

function ModalAdelanto({
  usuarios,
  onClose,
  onGuardado,
}: {
  usuarios: UsuarioMin[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [idUsuario, setIdUsuario] = useState("");
  const [monto, setMonto] = useState("");
  const [medioPago, setMedioPago] = useState("EFECTIVO_ADMIN");
  const [descripcion, setDescripcion] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleGuardar() {
    setError(null);
    setGuardando(true);
    registrarAdelanto({ idUsuario, monto: Number(monto) || 0, medioPago, descripcion, fecha })
      .then((res) => {
        if (res.error) setError(res.error);
        else onGuardado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-200">
          <h2 className="text-lg font-semibold text-neutral-900">Registrar adelanto</h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Se descuenta solo del neto cuando cierres la nómina del mes.
          </p>
        </div>

        <div className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className="block text-[10.5px] font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
              A quién
            </label>
            <select
              value={idUsuario}
              onChange={(e) => setIdUsuario(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">Elegí a alguien…</option>
              {usuarios.map((u) => (
                <option key={u.id_usuario} value={u.id_usuario}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
                Cuánto
              </label>
              <input
                type="number"
                min={0}
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm text-right tabular-nums font-semibold"
              />
            </div>
            <div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
                Cuándo
              </label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10.5px] font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
              De dónde sale
            </label>
            <div className="grid grid-cols-1 gap-2">
              {MEDIO_ADELANTO.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  onClick={() => setMedioPago(m.valor)}
                  className={`text-left border rounded-lg px-3 py-2 text-[13px] font-semibold ${
                    medioPago === m.valor
                      ? "border-accent bg-accent-tint text-accent"
                      : "border-neutral-300 text-neutral-600 hover:border-neutral-400"
                  }`}
                >
                  {m.etiqueta}
                  <span className="block text-[10.5px] font-normal opacity-70">{m.nota}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10.5px] font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
              Nota <span className="font-normal normal-case tracking-normal">(opcional)</span>
            </label>
            <input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Adelanto de sueldo"
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-2.5">
          <button
            onClick={onClose}
            disabled={guardando}
            className="flex-1 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleGuardar}
            disabled={guardando || !idUsuario || !(Number(monto) > 0)}
            className="flex-1 rounded-lg bg-accent hover:bg-accent-dark px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== REGLAS DEL PRESENTISMO =====================
//
// Las reglas con las que se calcula el presentismo de cada mes. El resultado
// de cada persona ya no tiene pantalla propia: sale de la grilla de
// Asistencia (columna Presentismo) y se cobra en Sueldos.

function ReglasPresentismo() {
  const [params, setParams] = useState<Record<string, number> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; error: boolean } | null>(null);

  useEffect(() => {
    obtenerParametrosPresentismo().then(setParams);
  }, []);

  function handleGuardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    setMensaje(null);
    actualizarParametrosPresentismo(formData)
      .then((res) => {
        if (res.error) setMensaje({ texto: res.error, error: true });
        else {
          setMensaje({ texto: "Reglas guardadas.", error: false });
          obtenerParametrosPresentismo().then(setParams);
        }
      })
      .finally(() => setGuardando(false));
  }

  const campos: { nombre: string; etiqueta: string; ayuda?: string }[] = [
    { nombre: "PRESENTISMO_PORCENTAJE_INCENTIVO", etiqueta: "% del sueldo que es el presentismo", ayuda: "Completo cobra todo esto, parcial la mitad, perdido nada." },
    { nombre: "PRESENTISMO_TARDANZAS_PARA_PARCIAL", etiqueta: "Con esta cantidad de tardanzas o más, lo cobra a medias" },
    { nombre: "PRESENTISMO_MAX_TARDANZAS", etiqueta: "Con más de esta cantidad de tardanzas, lo pierde" },
    { nombre: "PRESENTISMO_MAX_FALTAS", etiqueta: "Con esta cantidad de faltas o más, lo pierde" },
    { nombre: "PRESENTISMO_MAX_SALIDAS_ANTICIPADAS", etiqueta: "Con más de esta cantidad de salidas antes de hora, lo pierde" },
  ];

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4">
      <h2 className="text-[15px] font-semibold text-neutral-900">Reglas del presentismo</h2>
      <p className="text-xs text-neutral-400 mb-3 max-w-xl">
        Solo se aplican a quien tiene horario fijo y cobra presentismo. Los feriados, las licencias y el día de hoy no cuentan como falta.
      </p>
      {!params ? (
        <p className="text-sm text-neutral-400">Cargando...</p>
      ) : (
        <form onSubmit={handleGuardar} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {campos.map((c) => (
            <div key={c.nombre}>
              <label className="block text-xs font-medium text-neutral-600 mb-1">{c.etiqueta}</label>
              <input type="number" name={c.nombre} defaultValue={params[c.nombre]} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
              {c.ayuda && <p className="text-[10.5px] text-neutral-400 mt-1">{c.ayuda}</p>}
            </div>
          ))}
          <div className="sm:col-span-2 flex items-center justify-end gap-3">
            {mensaje && <span className={`text-xs ${mensaje.error ? "text-red-600" : "text-emerald-700"}`}>{mensaje.texto}</span>}
            <button type="submit" disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-4 py-1.5 rounded-lg text-sm">
              {guardando ? "Guardando..." : "Guardar reglas"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ===================== VACACIONES Y LICENCIAS =====================

function anioActual() {
  return new Date().getFullYear();
}

/**
 * Personal: quién trabaja con WiiGo y cómo.
 *
 * Separado por cómo trabaja cada uno, no por sucursal: los empleados (fichan,
 * cobran por nómina, tienen vacaciones y aguinaldo), los servicios
 * tercerizados (facturan por mes) y los socios. Antes estaban todos juntos y
 * a los tercerizados y al socio se les marcaba "No puede cobrar" en rojo,
 * aunque no van en la nómina: la pantalla decía "5 personas no pueden
 * cobrar" cuando era una sola.
 *
 * Tocar a alguien abre su ficha al costado (FichaPersona).
 */
function TabVacaciones({ personas }: { personas: PersonaMin[] }) {
  void personas;
  const anio = anioActual();
  const [gente, setGente] = useState<PersonaDeRrhh[]>([]);
  const [saldos, setSaldos] = useState<SaldoVacaciones[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modalPersona, setModalPersona] = useState<SaldoVacaciones | null>(null);
  const [fichaAbierta, setFichaAbierta] = useState<string | null>(null);
  const [vueltaFicha, setVueltaFicha] = useState(0);

  function recargar() {
    setCargando(true);
    Promise.all([listarPersonalRrhh(), listarSaldosVacaciones(anio)])
      .then(([g, s]) => {
        setGente(g);
        setSaldos(s);
      })
      .finally(() => setCargando(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(recargar, []);

  const saldoPorPersona = new Map(saldos.map((s) => [s.idPersona, s]));
  const empleados = gente.filter((p) => p.tipo === "EMPLEADO");
  const externos = gente.filter((p) => p.tipo === "EXTERNO");
  const socios = gente.filter((p) => p.tipo !== "EMPLEADO" && p.tipo !== "EXTERNO");
  const noCobran = empleados.filter((p) => p.problema === "NO_COBRA" || p.problema === "SIN_SUELDO");
  const completos = empleados.filter((p) => p.faltantes.length === 0).length;
  const diasDisponibles = empleados.reduce((a, p) => a + Math.max(saldoPorPersona.get(p.idPersona)?.diasDisponibles ?? 0, 0), 0);
  const hoyMs = Date.now();
  const diasHasta = (iso: string | null) => (iso ? Math.round((Date.parse(`${iso}T12:00:00`) - hoyMs) / 86400000) : null);
  const finPrueba = (ingreso: string | null) => {
    if (!ingreso) return null;
    const [a, m, d] = ingreso.split("-").map(Number);
    return new Date(Date.UTC(a, m - 1 + 6, d)).toISOString().slice(0, 10);
  };

  const iniciales = (nombre: string) =>
    nombre
      .split(" ")
      .slice(0, 2)
      .map((x) => x[0]?.toUpperCase() ?? "")
      .join("");
  const cerrarFicha = () => setFichaAbierta(null);

  if (cargando && gente.length === 0) return <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>;
  if (gente.length === 0) {
    return <p className="text-sm text-neutral-400 text-center py-8">Todavía no hay personas activas. Se cargan en Equipo → Organización.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Resumen en una línea */}
      <div className="grid sm:grid-cols-3 gap-2.5">
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">El equipo</p>
          <p className="text-lg font-bold text-neutral-900">
            {empleados.length} {empleados.length === 1 ? "empleado" : "empleados"}
          </p>
          <p className="text-xs text-neutral-500">
            {externos.length} {externos.length === 1 ? "servicio tercerizado" : "servicios tercerizados"} · {socios.length}{" "}
            {socios.length === 1 ? "socio" : "socios"}
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">Legajos completos</p>
          <p className="text-lg font-bold text-neutral-900">
            {completos} de {empleados.length}
          </p>
          <p className="text-xs text-neutral-500">usuario, sueldo, ingreso, DNI y CUIL</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">Vacaciones {anio}</p>
          <p className="text-lg font-bold text-neutral-900">{diasDisponibles} días</p>
          <p className="text-xs text-neutral-500">por tomar entre todos los empleados</p>
        </div>
      </div>

      {/* El único aviso que cuesta plata: un empleado que no aparece al
          cerrar la nómina. Solo empleados: tercerizados y socios no cobran
          por nómina. */}
      {noCobran.length > 0 && (
        <p className="text-[13.5px] rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-neutral-800">
          <b className="text-red-700">
            {noCobran.map((p) => p.nombre).join(", ")} {noCobran.length === 1 ? "no puede cobrar" : "no pueden cobrar"}.
          </b>{" "}
          Les falta el usuario vinculado o el sueldo, así que no aparecen al cerrar la nómina. Se arregla en Equipo → Usuarios y en Sueldos.
        </p>
      )}

      {/* Empleados */}
      <div className="flex items-baseline justify-between gap-2 pt-2">
        <h3 className="text-[15px] font-semibold text-neutral-900 flex items-center gap-2">
          <i className="inline-block w-2.5 h-2.5 rounded-[3px] bg-accent" /> Empleados
        </h3>
        <p className="text-xs text-neutral-500">Fichan, cobran por nómina y tienen vacaciones y aguinaldo</p>
      </div>
      {empleados.length === 0 && <p className="text-sm text-neutral-400">No hay empleados cargados.</p>}
      {empleados.map((p) => {
        const saldo = saldoPorPersona.get(p.idPersona);
        const cobra =
          (p.valorHora ?? 0) > 0 ? `Por hora $${formatearMonto(p.valorHora ?? 0)}` : (p.sueldoBase ?? 0) > 0 ? `Fijo $${formatearMonto(p.sueldoBase ?? 0)}` : null;
        const prueba = diasHasta(finPrueba(p.fechaIngreso));
        const seguro = diasHasta(p.seguroVence);
        const sinCobrar = p.problema === "NO_COBRA" || p.problema === "SIN_SUELDO";
        const chequeos = [
          { label: "Usuario", ok: Boolean(p.idUsuario) },
          { label: "Sueldo", ok: Boolean(cobra) },
          { label: "Ingreso", ok: Boolean(p.fechaIngreso) },
          { label: "DNI", ok: p.tieneDni },
          { label: "CUIL", ok: p.tieneCuil },
        ];
        return (
          <button
            key={p.idPersona}
            type="button"
            onClick={() => setFichaAbierta(p.idPersona)}
            className="w-full text-left border border-neutral-200 rounded-xl bg-white px-4 py-3.5 hover:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="flex items-center gap-3">
              <span
                className={`shrink-0 w-[42px] h-[42px] rounded-full grid place-items-center text-sm font-bold ${
                  sinCobrar ? "bg-red-50 text-red-700" : "bg-accent-tint text-accent"
                }`}
              >
                {iniciales(p.nombre)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-neutral-900">
                  {p.nombre}
                  {p.puesto && <span className="font-normal text-neutral-400 text-[13px] ml-1.5">{p.puesto}</span>}
                </span>
                <span className="flex flex-wrap gap-1.5 mt-1">
                  {cobra ? (
                    <span className={`text-[11.5px] font-semibold rounded-full px-2 py-0.5 ${(p.valorHora ?? 0) > 0 ? "bg-accent-tint text-accent" : "bg-violet-50 text-violet-700"}`}>
                      {cobra}
                    </span>
                  ) : (
                    <span className="text-[11.5px] font-semibold rounded-full px-2 py-0.5 bg-neutral-100 text-neutral-500">Sin sueldo cargado</span>
                  )}
                  <span className="text-[11.5px] rounded-full px-2 py-0.5 bg-neutral-100 text-neutral-600">{p.horario ?? "Horario sin definir"}</span>
                  {p.fechaIngreso && (
                    <span className="text-[11.5px] rounded-full px-2 py-0.5 bg-neutral-100 text-neutral-600">
                      Desde {new Date(`${p.fechaIngreso}T12:00:00`).toLocaleDateString("es-AR", { month: "short", year: "numeric" })}
                    </span>
                  )}
                  {prueba !== null && prueba >= 0 && prueba <= 30 && (
                    <span className="text-[11.5px] font-semibold rounded-full px-2 py-0.5 bg-amber-50 text-amber-700">Termina la prueba en {prueba} días</span>
                  )}
                  {seguro !== null && seguro <= 30 && (
                    <span className="text-[11.5px] font-semibold rounded-full px-2 py-0.5 bg-amber-50 text-amber-700">
                      {seguro < 0 ? "Seguro vencido" : `Seguro vence en ${seguro} días`}
                    </span>
                  )}
                </span>
              </span>
              <span className="text-right shrink-0">
                {saldo ? (
                  <>
                    <span className={`block text-xl font-extrabold leading-tight tabular-nums ${saldo.diasDisponibles < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {saldo.diasDisponibles} días
                    </span>
                    <span className="block text-[11px] text-neutral-400">de vacaciones de {saldo.diasLegales}</span>
                  </>
                ) : (
                  <span className="block text-[11px] text-neutral-400 max-w-[110px]">sin fecha de ingreso, no se calculan</span>
                )}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-2.5 border-t border-dashed border-neutral-200 text-[12.5px] pl-[54px]">
              <span className="text-neutral-400 font-semibold">Legajo</span>
              {chequeos.map((c) => (
                <span key={c.label} className={c.ok ? "text-emerald-700" : "text-red-600 font-semibold"}>
                  {c.ok ? "✓" : "✗"} {c.label}
                </span>
              ))}
              <span className="ml-auto text-accent font-semibold">Ver ficha →</span>
            </span>
          </button>
        );
      })}

      {/* Tercerizados */}
      {externos.length > 0 && (
        <>
          <div className="flex items-baseline justify-between gap-2 pt-3">
            <h3 className="text-[15px] font-semibold text-neutral-900 flex items-center gap-2">
              <i className="inline-block w-2.5 h-2.5 rounded-[3px] bg-neutral-400" /> Servicios tercerizados
            </h3>
            <p className="text-xs text-neutral-500">Facturan por mes. No fichan ni tienen nómina</p>
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            {externos.map((p) => (
              <button
                key={p.idPersona}
                type="button"
                onClick={() => setFichaAbierta(p.idPersona)}
                className="w-full text-left flex items-center gap-3 px-4 py-3 border-t border-neutral-100 first:border-0 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="w-9 h-9 rounded-full bg-neutral-100 text-neutral-500 grid place-items-center text-xs font-bold shrink-0">{iniciales(p.nombre)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-neutral-900">{p.nombre}</span>
                  <span className="block text-xs text-neutral-400">{p.puesto ?? "Servicio tercerizado"}</span>
                </span>
                <span className="text-xs text-accent font-semibold">Ver ficha →</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Socios */}
      {socios.length > 0 && (
        <>
          <div className="flex items-baseline justify-between gap-2 pt-3">
            <h3 className="text-[15px] font-semibold text-neutral-900 flex items-center gap-2">
              <i className="inline-block w-2.5 h-2.5 rounded-[3px] bg-violet-500" /> Socios
            </h3>
            <p className="text-xs text-neutral-500">No tienen sueldo ni legajo laboral</p>
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            {socios.map((p) => (
              <button
                key={p.idPersona}
                type="button"
                onClick={() => setFichaAbierta(p.idPersona)}
                className="w-full text-left flex items-center gap-3 px-4 py-3 border-t border-neutral-100 first:border-0 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="w-9 h-9 rounded-full bg-neutral-100 text-neutral-500 grid place-items-center text-xs font-bold shrink-0">{iniciales(p.nombre)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-neutral-900">{p.nombre}</span>
                  <span className="block text-xs text-neutral-400">{p.puesto ?? "Socio"}</span>
                </span>
                <span className="text-xs text-accent font-semibold">Ver ficha →</span>
              </button>
            ))}
          </div>
        </>
      )}

      {fichaAbierta && (
        <FichaPersona
          key={`${fichaAbierta}-${vueltaFicha}`}
          idPersona={fichaAbierta}
          onClose={cerrarFicha}
          onCambio={recargar}
          onAbrirLicencias={(persona) => setModalPersona(persona)}
        />
      )}

      {modalPersona && (
        <ModalLicenciasPersona
          persona={modalPersona}
          onClose={() => {
            setModalPersona(null);
            setVueltaFicha((v) => v + 1);
          }}
          onCambio={() => {
            recargar();
            setVueltaFicha((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function ModalLicenciasPersona({ persona, onClose, onCambio }: { persona: SaldoVacaciones; onClose: () => void; onCambio: () => void }) {
  const [licencias, setLicencias] = useState<Licencia[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function recargar() {
    setCargando(true);
    listarLicencias(persona.idPersona)
      .then(setLicencias)
      .finally(() => setCargando(false));
  }

  useEffect(recargar, [persona.idPersona]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.set("id_persona", persona.idPersona);
    setGuardando(true);
    crearLicencia(formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else {
          setMostrarForm(false);
          recargar();
          onCambio();
        }
      })
      .finally(() => setGuardando(false));
  }

  function handleEliminar(l: Licencia) {
    if (!confirm(`¿Eliminar esta licencia (${TIPO_LICENCIA_LABEL[l.tipo] ?? l.tipo}, ${l.fecha_desde} a ${l.fecha_hasta})?`)) return;
    eliminarLicencia(l.id_licencia).then(() => {
      recargar();
      onCambio();
    });
  }

  function formatearFecha(fecha: string) {
    return new Date(`${fecha}T00:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Licencias</h2>
            <p className="text-xs text-neutral-400">{persona.nombre}</p>
          </div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {!mostrarForm ? (
          <button onClick={() => setMostrarForm(true)} className="bg-accent hover:bg-accent-dark text-white font-medium px-3.5 py-1.5 rounded-lg text-sm mb-4">
            + Cargar licencia
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="bg-accent-tint border border-accent rounded-lg p-3 mb-4">
            {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Tipo</label>
                <select name="tipo" className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm bg-white" defaultValue="VACACIONES">
                  {Object.entries(TIPO_LICENCIA_LABEL).map(([valor, label]) => (
                    <option key={valor} value={valor}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end pb-1.5">
                <label className="flex items-center gap-1.5 text-xs text-neutral-700 cursor-pointer">
                  <input type="checkbox" name="con_goce_sueldo" defaultChecked /> Con goce de sueldo
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Desde</label>
                <input type="date" name="fecha_desde" required className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Hasta</label>
                <input type="date" name="fecha_hasta" required className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-neutral-600 mb-1">Motivo (opcional)</label>
                <input name="motivo" className="w-full border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setMostrarForm(false)} className="text-xs font-semibold text-neutral-500 px-2">
                Cancelar
              </button>
              <button type="submit" disabled={guardando} className="bg-accent text-white text-xs font-bold px-3 py-1.5 rounded-md disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </form>
        )}

        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : licencias.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">Todavía no cargaste ninguna licencia para esta persona.</p>
        ) : (
          <div className="space-y-2">
            {licencias.map((l) => (
              <div key={l.id_licencia} className="border border-neutral-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <span className="text-sm font-semibold text-neutral-800">{TIPO_LICENCIA_LABEL[l.tipo] ?? l.tipo}</span>
                  <span className="text-xs text-neutral-400 ml-2">
                    {formatearFecha(l.fecha_desde)} → {formatearFecha(l.fecha_hasta)}
                  </span>
                  {!l.con_goce_sueldo && <span className="text-[10px] font-bold text-red-600 bg-red-50 rounded-full px-2 py-0.5 ml-2">Sin goce de sueldo</span>}
                  {l.motivo && <p className="text-xs text-neutral-400 mt-0.5">{l.motivo}</p>}
                </div>
                <button onClick={() => handleEliminar(l)} className="text-xs font-semibold text-red-500 hover:text-red-700">
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
