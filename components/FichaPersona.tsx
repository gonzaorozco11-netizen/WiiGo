"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ModalLegajo from "@/components/ModalLegajo";
import {
  obtenerFichaPersona,
  actualizarFichaPersona,
  agregarNotaPersona,
  eliminarNotaPersona,
  type FichaPersona as Ficha,
} from "@/app/(app)/rrhh/ficha-actions";
import { obtenerUrlDocumentoLegajo } from "@/app/(app)/organizacion/actions";

// La ficha de una persona: se abre al costado de la lista de Personal, con
// pestañas una al lado de la otra (pedido de Gonzalo: nada de todo apilado).
// Cada pestaña es una pregunta: quién es y cómo trabaja, qué cobró, sus
// vacaciones, qué la cubre y a quién llamar, sus papeles, y qué pasó con ella.

type Pestana = "resumen" | "sueldos" | "vacaciones" | "seguro" | "datos" | "notas";

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-AR")}`;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fecha = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const nombreMes = (periodo: string) => {
  const [a, m] = periodo.split("-").map(Number);
  return `${MESES[m - 1].charAt(0).toUpperCase() + MESES[m - 1].slice(1)} ${a}`;
};
const DOCUMENTOS = [
  { clave: "DNI", label: "DNI" },
  { clave: "CONTRATO", label: "Contrato" },
  { clave: "ALTA_AFIP", label: "Alta temprana AFIP" },
  { clave: "APTO_MEDICO", label: "Apto médico" },
  { clave: "CBU", label: "CBU" },
  { clave: "POLIZA_SEGURO", label: "Póliza de seguro" },
];
const TIPO_LIC: Record<string, string> = {
  VACACIONES: "Vacaciones",
  MATERNIDAD: "Maternidad",
  EXAMEN: "Examen",
  PARTICULAR: "Particular",
  ENFERMEDAD: "Enfermedad",
  OTRO: "Otra licencia",
};
const TIPO_PERSONA: Record<string, string> = { EMPLEADO: "Empleado", EXTERNO: "Servicio tercerizado", SOCIO: "Socio" };

function diasHasta(iso: string | null) {
  if (!iso) return null;
  return Math.round((Date.parse(`${iso.slice(0, 10)}T12:00:00`) - Date.now()) / 86400000);
}
function antiguedad(ingreso: string | null) {
  if (!ingreso) return null;
  const [a, m, d] = ingreso.split("-").map(Number);
  const hoy = new Date();
  let meses = (hoy.getFullYear() - a) * 12 + (hoy.getMonth() + 1 - m);
  if (hoy.getDate() < d) meses -= 1;
  if (meses < 1) return "menos de 1 mes";
  if (meses < 12) return `${meses} ${meses === 1 ? "mes" : "meses"}`;
  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  return `${anios} ${anios === 1 ? "año" : "años"}${resto ? ` y ${resto} ${resto === 1 ? "mes" : "meses"}` : ""}`;
}

const card = "bg-white border border-neutral-200 rounded-xl p-4";
const titulo = "text-[11px] font-bold uppercase tracking-wider text-neutral-400";
const linkChico = "text-xs font-semibold text-accent hover:underline";

function Dato({ etiqueta, valor, falta, tono }: { etiqueta: string; valor: string | null; falta?: boolean; tono?: "ojo" }) {
  return (
    <div className="min-w-0">
      <span className="block text-[11.5px] text-neutral-400">{etiqueta}</span>
      <span
        className={`block text-[13.5px] ${
          falta ? "font-semibold text-red-600" : tono === "ojo" ? "font-semibold text-amber-700" : valor ? "font-medium text-neutral-900" : "text-neutral-400"
        }`}
      >
        {falta ? "Falta" : valor ?? "No cargado"}
      </span>
    </div>
  );
}

function Chip({ texto, tono }: { texto: string; tono: "bien" | "ojo" | "mal" | "gris" }) {
  const clase = {
    bien: "bg-emerald-50 text-emerald-700",
    ojo: "bg-amber-50 text-amber-700",
    mal: "bg-red-50 text-red-700",
    gris: "bg-neutral-100 text-neutral-500",
  }[tono];
  return <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap ${clase}`}>{texto}</span>;
}

export default function FichaPersona({
  idPersona,
  onClose,
  onCambio,
  onAbrirLicencias,
}: {
  idPersona: string;
  onClose: () => void;
  /** Algo cambió (datos, licencias): la lista de atrás se recarga. */
  onCambio: () => void;
  /** Abre el modal de vacaciones y licencias que ya existe en RR.HH. */
  onAbrirLicencias: (persona: { idPersona: string; nombre: string; fechaIngreso: string; diasLegales: number; diasTomados: number; diasDisponibles: number }) => void;
}) {
  const [f, setF] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>("resumen");
  const [editando, setEditando] = useState(false);
  const [legajo, setLegajo] = useState(false);

  const cargar = useCallback(() => {
    setError(null);
    obtenerFichaPersona(idPersona)
      .then(setF)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo abrir la ficha."));
  }, [idPersona]);

  useEffect(() => {
    setPestana("resumen");
    cargar();
  }, [cargar]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => e.key === "Escape" && !editando && !legajo && onClose();
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onClose, editando, legajo]);

  const esEmpleado = f?.tipo === "EMPLEADO";
  const esExterno = f?.tipo === "EXTERNO";
  const pestanas: { clave: Pestana; label: string }[] = !f
    ? []
    : esEmpleado
      ? [
          { clave: "resumen", label: "Resumen" },
          { clave: "sueldos", label: "Sueldos" },
          { clave: "vacaciones", label: "Vacaciones" },
          { clave: "seguro", label: "Seguro y contacto" },
          { clave: "datos", label: "Datos y documentos" },
          { clave: "notas", label: "Notas" },
        ]
      : esExterno
        ? [
            { clave: "resumen", label: "Resumen" },
            { clave: "sueldos", label: "Honorarios" },
            { clave: "seguro", label: "Contacto y pago" },
            { clave: "datos", label: "Datos y documentos" },
            { clave: "notas", label: "Notas" },
          ]
        : [
            { clave: "resumen", label: "Resumen" },
            { clave: "datos", label: "Datos y documentos" },
            { clave: "notas", label: "Notas" },
          ];

  const iniciales = (f?.nombre ?? "")
    .split(" ")
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Ficha de la persona">
      <button type="button" className="absolute inset-0 bg-black/35" aria-label="Cerrar ficha" onClick={onClose} />
      <aside className="relative w-full max-w-[720px] h-full bg-neutral-50 shadow-2xl flex flex-col">
        {/* Cabecera fija con las pestañas */}
        <div className="bg-white border-b border-neutral-200 px-5 pt-5">
          <div className="flex items-center gap-3.5">
            <span className="w-12 h-12 rounded-full bg-accent-tint text-accent grid place-items-center font-bold shrink-0">{iniciales || "·"}</span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-neutral-900 truncate">{f?.nombre ?? "Cargando…"}</h2>
              {f && (
                <p className="text-[13px] text-neutral-500 truncate">
                  {[f.puesto, TIPO_PERSONA[f.tipo] ?? f.tipo, f.local].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto w-9 h-9 rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50 shrink-0"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
          <div className="flex gap-1 mt-4 overflow-x-auto -mb-px" role="tablist">
            {pestanas.map((p) => (
              <button
                key={p.clave}
                type="button"
                role="tab"
                aria-selected={pestana === p.clave}
                onClick={() => setPestana(p.clave)}
                className={`px-3 py-2 text-sm font-semibold whitespace-nowrap border-b-2 ${
                  pestana === p.clave ? "border-accent text-accent" : "border-transparent text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          {!f && !error && <p className="text-sm text-neutral-400 text-center py-10">Cargando…</p>}
          {f && f.faltaSql && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Para guardar el acuerdo, el seguro, el contacto de emergencia y las notas falta correr <b>sql/personas-ficha.sql</b> en Supabase.
            </p>
          )}

          {f && pestana === "resumen" && <PestanaResumen f={f} onEditar={() => setEditando(true)} />}
          {f && pestana === "sueldos" && (esExterno ? <PestanaHonorarios f={f} /> : <PestanaSueldos f={f} />)}
          {f && pestana === "vacaciones" && (
            <PestanaVacaciones
              f={f}
              onCargar={() =>
                f.vacaciones &&
                f.datos.fechaIngreso &&
                onAbrirLicencias({
                  idPersona: f.idPersona,
                  nombre: f.nombre,
                  fechaIngreso: f.datos.fechaIngreso,
                  diasLegales: f.vacaciones.legales,
                  diasTomados: f.vacaciones.tomados,
                  diasDisponibles: f.vacaciones.disponibles,
                })
              }
            />
          )}
          {f && pestana === "seguro" && <PestanaSeguro f={f} onEditar={() => setEditando(true)} />}
          {f && pestana === "datos" && <PestanaDatos f={f} onEditar={() => setLegajo(true)} />}
          {f && pestana === "notas" && <PestanaNotas f={f} onCambio={cargar} />}
        </div>
      </aside>

      {f && editando && (
        <ModalEditarFicha
          f={f}
          onClose={() => setEditando(false)}
          onGuardado={() => {
            setEditando(false);
            cargar();
            onCambio();
          }}
        />
      )}
      {f && legajo && (
        <ModalLegajo
          persona={f.personaLegajo}
          onClose={() => {
            setLegajo(false);
            cargar();
            onCambio();
          }}
          onGuardado={() => {
            setLegajo(false);
            cargar();
            onCambio();
          }}
        />
      )}
    </div>
  );
}

// ---------- Resumen ----------
function PestanaResumen({ f, onEditar }: { f: Ficha; onEditar: () => void }) {
  const esEmpleado = f.tipo === "EMPLEADO";
  const u = f.usuario;
  const cobra =
    u && (u.valorHora ?? 0) > 0
      ? `Por hora ${pesos(u.valorHora ?? 0)}`
      : u && (u.sueldoBase ?? 0) > 0
        ? `Fijo ${pesos(u.sueldoBase ?? 0)}`
        : null;
  const prueba = diasHasta(f.finPrueba);
  const seguro = diasHasta(f.extra.seguroVence);
  const avisos: { texto: string; tono: "ojo" | "mal" }[] = [];
  if (esEmpleado && !u) avisos.push({ texto: "No puede cobrar: no tiene usuario vinculado. Se arregla en Equipo → Usuarios.", tono: "mal" });
  else if (esEmpleado && !cobra) avisos.push({ texto: "No puede cobrar: no tiene sueldo ni valor hora cargado. Se carga en Sueldos.", tono: "mal" });
  if (prueba !== null && prueba >= 0 && prueba <= 30) avisos.push({ texto: `El período de prueba termina en ${prueba} días (${fecha(f.finPrueba)}).`, tono: "ojo" });
  if (seguro !== null && seguro < 0) avisos.push({ texto: `El seguro de accidentes personales venció el ${fecha(f.extra.seguroVence)}.`, tono: "mal" });
  else if (seguro !== null && seguro <= 30) avisos.push({ texto: `El seguro de accidentes personales vence en ${seguro} días.`, tono: "ojo" });
  if (esEmpleado && !f.extra.enBlanco && !f.extra.seguroVence)
    avisos.push({ texto: "No está registrado y no tiene seguro de accidentes personales cargado: si se lastima trabajando, no lo cubre nada.", tono: "ojo" });

  return (
    <>
      {avisos.map((a, i) => (
        <p
          key={i}
          className={`text-[13px] rounded-lg px-3 py-2 border ${
            a.tono === "mal" ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-900"
          }`}
        >
          {a.texto}
        </p>
      ))}

      {esEmpleado && (
        <div className="grid grid-cols-3 gap-2.5">
          <div className={card}>
            <p className={titulo}>Antigüedad</p>
            <p className="text-lg font-bold text-neutral-900 mt-1">{antiguedad(f.datos.fechaIngreso) ?? "—"}</p>
            <p className="text-xs text-neutral-500">{f.datos.fechaIngreso ? `desde el ${fecha(f.datos.fechaIngreso)}` : "sin fecha de ingreso"}</p>
          </div>
          <div className={card}>
            <p className={titulo}>Cobra</p>
            <p className="text-lg font-bold text-neutral-900 mt-1 tabular-nums">{cobra ?? "—"}</p>
            <p className="text-xs text-neutral-500">{u?.cobraPresentismo ? "con presentismo" : u ? "sin presentismo" : "sin usuario"}</p>
          </div>
          <div className={card}>
            <p className={titulo}>Vacaciones</p>
            <p className="text-lg font-bold text-emerald-700 mt-1">{f.vacaciones ? `${f.vacaciones.disponibles} días` : "—"}</p>
            <p className="text-xs text-neutral-500">{f.vacaciones ? `disponibles de ${f.vacaciones.legales}` : "sin fecha de ingreso"}</p>
          </div>
        </div>
      )}

      <section className={card}>
        <div className="flex items-baseline justify-between mb-3">
          <p className={titulo}>Cómo trabaja</p>
          <button type="button" onClick={onEditar} className={linkChico}>
            Editar
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
          <Dato etiqueta="Puesto" valor={f.puesto} />
          <Dato etiqueta="Tipo" valor={TIPO_PERSONA[f.tipo] ?? f.tipo} />
          {esEmpleado && (
            <>
              <Dato etiqueta="Horario" valor={f.horario ?? "Sin horario asignado"} />
              <Dato etiqueta="Cómo cobra" valor={cobra} />
              <Dato etiqueta="Presentismo" valor={u ? (u.cobraPresentismo ? "Cobra" : "No cobra") : null} />
              <Dato etiqueta="Usuario del sistema" valor={u ? "Sí" : null} falta={!u} />
              <Dato etiqueta="Relación" valor={f.extra.enBlanco ? "Registrado" : "Sin registrar"} />
              <Dato
                etiqueta="Período de prueba"
                valor={f.finPrueba ? (prueba !== null && prueba < 0 ? `Terminó el ${fecha(f.finPrueba)}` : `Hasta el ${fecha(f.finPrueba)}`) : null}
                tono={prueba !== null && prueba >= 0 ? "ojo" : undefined}
              />
              <Dato etiqueta="Próxima revisión de sueldo" valor={f.extra.revisionSueldo ? fecha(f.extra.revisionSueldo) : null} />
              <Dato etiqueta="Convenio colectivo" valor={f.datos.convenio} />
            </>
          )}
        </div>
        {esEmpleado && (
          <p className="text-[11.5px] text-neutral-400 mt-3">
            El sueldo y el presentismo se cambian en <Link href="/rrhh/sueldos" className="text-accent">Sueldos</Link>; el puesto y el horario, en{" "}
            <Link href="/organizacion" className="text-accent">Organización</Link>.
          </p>
        )}
      </section>

      <section className={card}>
        <div className="flex items-baseline justify-between mb-2">
          <p className={titulo}>El acuerdo</p>
          <button type="button" onClick={onEditar} className={linkChico}>
            {f.extra.acuerdo ? "Editar" : "Cargar"}
          </button>
        </div>
        {f.extra.acuerdo ? (
          <p className="text-[13.5px] text-neutral-800 whitespace-pre-line">{f.extra.acuerdo}</p>
        ) : (
          <p className="text-[13px] text-neutral-500 bg-neutral-50 rounded-lg px-3 py-2.5">
            Todavía no está cargado. Va lo que arreglaron en palabras simples (días, horario, cuánto cobra, cada cuánto se revisa), para que no
            dependa de la memoria de nadie. El contrato firmado se sube en Datos y documentos.
          </p>
        )}
      </section>
    </>
  );
}

// ---------- Sueldos ----------
function PestanaSueldos({ f }: { f: Ficha }) {
  const estado = {
    PAGADO: { texto: "Pagado", tono: "bien" as const },
    SIN_PAGAR: { texto: "Sin pagar", tono: "ojo" as const },
    ESTIMADO: { texto: "Estimado", tono: "ojo" as const },
    SIN_CERRAR: { texto: "Sin cerrar", tono: "gris" as const },
  };
  const maximo = Math.max(...f.pagos.map((p) => p.neto), 1);
  const ordenados = [...f.pagos].reverse();
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <div className={card}>
          <p className={titulo}>Cobrado en el año</p>
          <p className="text-xl font-bold text-neutral-900 tabular-nums mt-1">{pesos(f.cobradoEnElAnio)}</p>
        </div>
        <div className={card}>
          <p className={titulo}>Se le debe</p>
          <p className={`text-xl font-bold tabular-nums mt-1 ${f.seLeDebe > 0 ? "text-amber-700" : "text-neutral-900"}`}>{pesos(f.seLeDebe)}</p>
          <p className="text-xs text-neutral-500">sueldos cerrados sin pagar</p>
        </div>
      </div>

      <section className={card}>
        <div className="flex items-baseline justify-between mb-2">
          <p className={titulo}>Lo que cobró, mes a mes</p>
          <Link href="/rrhh/sueldos" className={linkChico}>
            Ir a Sueldos
          </Link>
        </div>
        {f.pagos.length === 0 ? (
          <p className="text-sm text-neutral-400 py-3">Todavía no tiene sueldos cargados.</p>
        ) : (
          <>
            <div className="flex items-end gap-2 h-20 mb-3" aria-label="Neto de cada mes">
              {ordenados.map((p) => (
                <div key={p.periodo} className="flex-1 h-full flex flex-col justify-end items-center gap-1 text-[10.5px] text-neutral-400">
                  <span
                    className={`block w-full max-w-[40px] rounded-t ${p.estado === "SIN_CERRAR" || p.estado === "ESTIMADO" ? "bg-accent/30" : "bg-accent/70"}`}
                    style={{ height: `${Math.max((p.neto / maximo) * 100, 3)}%` }}
                    title={`${nombreMes(p.periodo)}: ${pesos(p.neto)}`}
                  />
                  {MESES[Number(p.periodo.slice(5, 7)) - 1].slice(0, 3)}
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
                    <th className="text-left pb-2 pr-2">Mes</th>
                    <th className="text-right pb-2 px-2">Sueldo</th>
                    <th className="text-right pb-2 px-2">Presentismo</th>
                    <th className="text-right pb-2 px-2">Extras</th>
                    <th className="text-right pb-2 px-2">Adelantos</th>
                    <th className="text-right pb-2 px-2">Neto</th>
                    <th className="pb-2 pl-2" />
                  </tr>
                </thead>
                <tbody>
                  {f.pagos.map((p) => (
                    <tr key={p.periodo} className="border-b border-neutral-100 last:border-0">
                      <td className="py-2 pr-2 whitespace-nowrap">{nombreMes(p.periodo)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{pesos(p.sueldo)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{p.presentismo ? pesos(p.presentismo) : "—"}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{p.extras ? pesos(p.extras) : "—"}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{p.adelantos ? `-${pesos(p.adelantos)}` : "—"}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold">{pesos(p.neto)}</td>
                      <td className="py-2 pl-2">
                        <Chip texto={estado[p.estado].texto} tono={estado[p.estado].tono} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className={card}>
        <div className="flex items-baseline justify-between mb-2">
          <p className={titulo}>Aguinaldo</p>
          <Link href="/rrhh/sueldos" className={linkChico}>
            Ir a Aguinaldo
          </Link>
        </div>
        {f.aguinaldos.length === 0 ? (
          <p className="text-sm text-neutral-400 py-2">Sin aguinaldo para mostrar: hace falta que tenga usuario y sueldos cerrados.</p>
        ) : (
          <div className="space-y-2.5">
            {f.aguinaldos.map((a) => (
              <div key={a.semestre} className="flex items-start justify-between gap-3 border-b border-neutral-100 last:border-0 pb-2.5 last:pb-0">
                <div>
                  <p className="text-[13.5px] font-semibold text-neutral-900">{a.etiqueta}</p>
                  <p className="text-xs text-neutral-500">
                    {a.estado === "NO_CORRESPONDE"
                      ? a.motivo
                      : a.estado === "EN_CURSO"
                        ? `Lleva acumulado ${pesos(a.acumulado)} · al cierre, unos ${pesos(a.alCierre)} · vence el ${fecha(a.vence)}`
                        : a.cerrado !== null
                          ? `${pesos(a.cerrado)} · pagado ${pesos(a.pagado)}${a.saldo > 0 ? ` · falta ${pesos(a.saldo)}` : ""} · vencía el ${fecha(a.vence)}`
                          : `Unos ${pesos(a.alCierre)} · sin cerrar · vencía el ${fecha(a.vence)}`}
                  </p>
                </div>
                <Chip
                  texto={{ PAGADO: "Pagado", POR_PAGAR: "Por pagar", EN_CURSO: "En curso", NO_CORRESPONDE: "No corresponde" }[a.estado]}
                  tono={a.estado === "PAGADO" ? "bien" : a.estado === "POR_PAGAR" ? "ojo" : "gris"}
                />
              </div>
            ))}
          </div>
        )}
        <p className="text-[11.5px] text-neutral-400 mt-2">Medio sueldo del mejor mes del semestre, proporcional a los días trabajados.</p>
      </section>
    </>
  );
}

function PestanaHonorarios({ f }: { f: Ficha }) {
  const total = f.honorarios.reduce((a, h) => a + h.monto, 0);
  return (
    <section className={card}>
      <div className="flex items-baseline justify-between mb-2">
        <p className={titulo}>Honorarios pagados, último año</p>
        <Link href="/gastos-ingresos" className={linkChico}>
          Ir a Gastos
        </Link>
      </div>
      {f.honorarios.length === 0 ? (
        <p className="text-[13px] text-neutral-500 bg-neutral-50 rounded-lg px-3 py-2.5">
          No hay honorarios cargados a su nombre. Cargalos como gasto recurrente en la categoría &ldquo;Honorarios Profesionales&rdquo; con su nombre
          en la descripción, por ejemplo &ldquo;{f.nombre} - {f.puesto ?? "Servicio"}&rdquo;.
        </p>
      ) : (
        <>
          <table className="w-full text-[13px]">
            <tbody>
              {f.honorarios.map((h, i) => (
                <tr key={i} className="border-b border-neutral-100 last:border-0">
                  <td className="py-2 pr-2">{nombreMes(h.periodo)}</td>
                  <td className="py-2 px-2 text-neutral-500">{h.detalle}</td>
                  <td className="py-2 pl-2 text-right tabular-nums font-semibold">{pesos(h.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-neutral-500 mt-2">
            Total del último año: <b className="text-neutral-900">{pesos(total)}</b>
          </p>
        </>
      )}
    </section>
  );
}

// ---------- Vacaciones ----------
function PestanaVacaciones({ f, onCargar }: { f: Ficha; onCargar: () => void }) {
  const v = f.vacaciones;
  const hoy = new Date().toISOString().slice(0, 10);
  return (
    <>
      {v ? (
        <div className="grid grid-cols-3 gap-2.5">
          <div className={card}>
            <p className={titulo}>Le corresponden</p>
            <p className="text-lg font-bold text-neutral-900 mt-1">{v.legales} días</p>
            <p className="text-xs text-neutral-500">en {v.anio}, por ley</p>
          </div>
          <div className={card}>
            <p className={titulo}>Tomados</p>
            <p className="text-lg font-bold text-neutral-900 mt-1">{v.tomados} días</p>
          </div>
          <div className={card}>
            <p className={titulo}>Por tomar</p>
            <p className={`text-lg font-bold mt-1 ${v.disponibles < 0 ? "text-red-600" : "text-emerald-700"}`}>{v.disponibles} días</p>
            <p className="text-xs text-neutral-500">hasta el {fecha(v.hasta)}</p>
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Sin fecha de ingreso no se pueden calcular las vacaciones. Se carga en Datos y documentos.
        </p>
      )}

      <section className={card}>
        <div className="flex items-baseline justify-between mb-2">
          <p className={titulo}>Vacaciones y licencias</p>
          {v && (
            <button type="button" onClick={onCargar} className={linkChico}>
              Cargar vacaciones o licencia
            </button>
          )}
        </div>
        {f.licencias.length === 0 ? (
          <p className="text-sm text-neutral-400 py-2">No tiene vacaciones ni licencias cargadas.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[10.5px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
                <th className="text-left pb-2 pr-2">Qué</th>
                <th className="text-left pb-2 px-2">Desde</th>
                <th className="text-left pb-2 px-2">Hasta</th>
                <th className="text-right pb-2 px-2">Días</th>
                <th className="pb-2 pl-2" />
              </tr>
            </thead>
            <tbody>
              {f.licencias.map((l) => {
                const dias = Math.round((Date.parse(`${l.fecha_hasta}T12:00:00`) - Date.parse(`${l.fecha_desde}T12:00:00`)) / 86400000) + 1;
                const tomada = l.fecha_hasta < hoy;
                const enCurso = l.fecha_desde <= hoy && l.fecha_hasta >= hoy;
                return (
                  <tr key={l.id_licencia} className="border-b border-neutral-100 last:border-0">
                    <td className="py-2 pr-2">
                      {TIPO_LIC[l.tipo] ?? l.tipo}
                      {!l.con_goce_sueldo && <span className="text-xs text-neutral-400"> · sin goce</span>}
                    </td>
                    <td className="py-2 px-2">{fecha(l.fecha_desde)}</td>
                    <td className="py-2 px-2">{fecha(l.fecha_hasta)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{dias}</td>
                    <td className="py-2 pl-2">
                      <Chip texto={enCurso ? "En curso" : tomada ? "Tomada" : "Programada"} tono={enCurso ? "ojo" : tomada ? "gris" : "bien"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-[11.5px] text-neutral-400 mt-2">Por ley las vacaciones se dan entre el 1/10 y el 30/04, avisando con 45 días de anticipación.</p>
      </section>
    </>
  );
}

// ---------- Seguro y contacto ----------
function PestanaSeguro({ f, onEditar }: { f: Ficha; onEditar: () => void }) {
  const esEmpleado = f.tipo === "EMPLEADO";
  const vence = diasHasta(f.extra.seguroVence);
  return (
    <>
      {esEmpleado && (
        <section className={card}>
          <div className="flex items-baseline justify-between mb-3">
            <p className={titulo}>Seguro y salud</p>
            <button type="button" onClick={onEditar} className={linkChico}>
              Editar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-3">
            <Dato
              etiqueta="Seguro de accidentes personales"
              valor={f.extra.seguroCompania}
              falta={!f.extra.enBlanco && !f.extra.seguroCompania && !f.extra.seguroVence}
            />
            <Dato etiqueta="Póliza" valor={f.extra.seguroPoliza} />
            <Dato
              etiqueta="Vence"
              valor={f.extra.seguroVence ? `${fecha(f.extra.seguroVence)}${vence !== null && vence < 0 ? " · vencido" : ""}` : null}
              tono={vence !== null && vence <= 30 ? "ojo" : undefined}
            />
            <Dato etiqueta="ART" valor={f.extra.enBlanco ? f.extra.art : "Solo si está registrado"} />
            <Dato etiqueta="Obra social" valor={f.extra.obraSocial} />
          </div>
          {!f.extra.enBlanco && (
            <p className="text-[11.5px] text-neutral-400 mt-3">
              Sin registrar no tiene ART: el seguro de accidentes personales es lo que lo cubre si se lastima trabajando. La póliza se sube en
              Datos y documentos.
            </p>
          )}
        </section>
      )}

      <section className={card}>
        <div className="flex items-baseline justify-between mb-3">
          <p className={titulo}>Contacto de emergencia y pago</p>
          <button type="button" onClick={onEditar} className={linkChico}>
            Editar
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
          <Dato etiqueta="Contacto de emergencia" valor={f.extra.contactoNombre ? `${f.extra.contactoNombre}${f.extra.contactoRelacion ? ` (${f.extra.contactoRelacion})` : ""}` : null} />
          <Dato etiqueta="Teléfono del contacto" valor={f.extra.contactoTelefono} />
          <Dato etiqueta="CBU o alias para pagarle" valor={f.extra.cbuAlias} />
          <Dato etiqueta="Banco" valor={f.extra.banco} />
        </div>
      </section>
    </>
  );
}

// ---------- Datos y documentos ----------
function PestanaDatos({ f, onEditar }: { f: Ficha; onEditar: () => void }) {
  const esEmpleado = f.tipo === "EMPLEADO";
  const abrir = (path: string) => obtenerUrlDocumentoLegajo(path).then((url) => window.open(url, "_blank"));
  return (
    <>
      <section className={card}>
        <div className="flex items-baseline justify-between mb-3">
          <p className={titulo}>Datos personales</p>
          <button type="button" onClick={onEditar} className={linkChico}>
            Editar datos y documentos
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
          <Dato etiqueta="DNI" valor={f.datos.dni} falta={esEmpleado && !f.datos.dni} />
          <Dato etiqueta="CUIL" valor={f.datos.cuil} falta={esEmpleado && !f.datos.cuil} />
          <Dato etiqueta="Fecha de nacimiento" valor={f.datos.fechaNacimiento ? fecha(f.datos.fechaNacimiento) : null} />
          <Dato etiqueta="Fecha de ingreso" valor={f.datos.fechaIngreso ? fecha(f.datos.fechaIngreso) : null} falta={esEmpleado && !f.datos.fechaIngreso} />
          <Dato etiqueta="Teléfono" valor={f.datos.telefono} />
          <Dato etiqueta="Email" valor={f.datos.email} />
          <div className="col-span-2">
            <Dato etiqueta="Domicilio" valor={f.datos.domicilio} />
          </div>
        </div>
      </section>

      <section className={card}>
        <div className="flex items-baseline justify-between mb-3">
          <p className={titulo}>Documentos</p>
          <button type="button" onClick={onEditar} className={linkChico}>
            Subir
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {DOCUMENTOS.map((d) => {
            const subidos = f.documentos.filter((x) => x.tipo === d.clave);
            return (
              <div key={d.clave} className={`rounded-lg px-3 py-2.5 border ${subidos.length ? "border-neutral-200" : "border-dashed border-neutral-300"}`}>
                <p className="text-[13px] font-semibold text-neutral-800">{d.label}</p>
                {subidos.length ? (
                  <button type="button" onClick={() => abrir(subidos[0].path)} className="text-xs text-emerald-700 hover:underline text-left truncate w-full">
                    Ver · subido el {fecha(subidos[0].fecha)}
                  </button>
                ) : (
                  <p className="text-xs text-neutral-400">Falta subir</p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

// ---------- Notas ----------
function PestanaNotas({ f, onCambio }: { f: Ficha; onCambio: () => void }) {
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function agregar() {
    setError(null);
    setGuardando(true);
    agregarNotaPersona(f.idPersona, texto)
      .then((r) => {
        if (r.error) setError(r.error);
        else {
          setTexto("");
          onCambio();
        }
      })
      .finally(() => setGuardando(false));
  }
  function borrar(idNota: string) {
    if (!confirm("¿Borrar esta nota?")) return;
    eliminarNotaPersona(idNota).then(onCambio);
  }
  return (
    <section className={card}>
      <p className={`${titulo} mb-2`}>Notas</p>
      <p className="text-xs text-neutral-500 mb-2">Un aumento, un llamado de atención, una felicitación, un cambio de horario: queda con fecha y quién lo anotó.</p>
      <textarea
        id="nota-nueva"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        placeholder="Escribí la nota…"
        className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={agregar}
          disabled={guardando || !texto.trim()}
          className="bg-accent hover:bg-accent-dark disabled:opacity-40 text-white text-sm font-semibold px-4 py-1.5 rounded-lg"
        >
          {guardando ? "Guardando…" : "Agregar nota"}
        </button>
      </div>
      <div className="mt-3 space-y-2.5">
        {f.notas.length === 0 && <p className="text-sm text-neutral-400">Todavía no hay notas.</p>}
        {f.notas.map((n) => (
          <div key={n.idNota} className="border-t border-neutral-100 pt-2.5">
            <p className="text-[13.5px] text-neutral-800 whitespace-pre-line">{n.texto}</p>
            <p className="text-[11.5px] text-neutral-400 mt-0.5 flex gap-2">
              {new Date(n.fecha).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}
              {n.usuario && <span>· {n.usuario}</span>}
              <button type="button" onClick={() => borrar(n.idNota)} className="ml-auto text-red-400 hover:text-red-600">
                Borrar
              </button>
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Editar los datos nuevos ----------
function ModalEditarFicha({ f, onClose, onGuardado }: { f: Ficha; onClose: () => void; onGuardado: () => void }) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esEmpleado = f.tipo === "EMPLEADO";
  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    actualizarFichaPersona(f.idPersona, new FormData(e.currentTarget))
      .then((r) => (r.error ? setError(r.error) : onGuardado()))
      .finally(() => setGuardando(false));
  }
  const campo = "w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm";
  const label = "block text-xs font-medium text-neutral-600 mb-1";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form onSubmit={enviar} className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Ficha de {f.nombre}</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}

        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-2">El acuerdo</p>
        <textarea
          id="acuerdo"
          name="acuerdo"
          defaultValue={f.extra.acuerdo ?? ""}
          rows={4}
          placeholder={"Ej: lunes a sábado de 9 a 13 h.\n$5.500 la hora + presentismo.\nSe revisa el valor hora cada 3 meses."}
          className={campo}
        />
        {esEmpleado && (
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <label className="flex items-center gap-2 text-sm text-neutral-700 sm:col-span-2">
              <input type="checkbox" id="en_blanco" name="en_blanco" defaultChecked={f.extra.enBlanco} className="accent-accent" />
              Está registrado (en blanco)
            </label>
            <div>
              <label className={label} htmlFor="revision_sueldo">Próxima revisión de sueldo</label>
              <input type="date" id="revision_sueldo" name="revision_sueldo" defaultValue={f.extra.revisionSueldo ?? ""} className={campo} />
            </div>
          </div>
        )}

        {esEmpleado && (
          <>
            <p className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-2 mt-5">Seguro y salud</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="seguro_ap_compania">Seguro de accidentes personales (compañía)</label>
                <input id="seguro_ap_compania" name="seguro_ap_compania" defaultValue={f.extra.seguroCompania ?? ""} className={campo} />
              </div>
              <div>
                <label className={label} htmlFor="seguro_ap_poliza">Número de póliza</label>
                <input id="seguro_ap_poliza" name="seguro_ap_poliza" defaultValue={f.extra.seguroPoliza ?? ""} className={campo} />
              </div>
              <div>
                <label className={label} htmlFor="seguro_ap_vence">Vence</label>
                <input type="date" id="seguro_ap_vence" name="seguro_ap_vence" defaultValue={f.extra.seguroVence ?? ""} className={campo} />
              </div>
              <div>
                <label className={label} htmlFor="art">ART (si está registrado)</label>
                <input id="art" name="art" defaultValue={f.extra.art ?? ""} className={campo} />
              </div>
              <div className="sm:col-span-2">
                <label className={label} htmlFor="obra_social">Obra social</label>
                <input id="obra_social" name="obra_social" defaultValue={f.extra.obraSocial ?? ""} className={campo} />
              </div>
            </div>
          </>
        )}

        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-2 mt-5">Contacto de emergencia y pago</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="contacto_emergencia_nombre">Contacto de emergencia</label>
            <input id="contacto_emergencia_nombre" name="contacto_emergencia_nombre" defaultValue={f.extra.contactoNombre ?? ""} className={campo} />
          </div>
          <div>
            <label className={label} htmlFor="contacto_emergencia_relacion">Relación</label>
            <input id="contacto_emergencia_relacion" name="contacto_emergencia_relacion" defaultValue={f.extra.contactoRelacion ?? ""} placeholder="Ej: madre" className={campo} />
          </div>
          <div>
            <label className={label} htmlFor="contacto_emergencia_telefono">Teléfono del contacto</label>
            <input id="contacto_emergencia_telefono" name="contacto_emergencia_telefono" defaultValue={f.extra.contactoTelefono ?? ""} className={campo} />
          </div>
          <div>
            <label className={label} htmlFor="cbu_alias">CBU o alias para pagarle</label>
            <input id="cbu_alias" name="cbu_alias" defaultValue={f.extra.cbuAlias ?? ""} className={campo} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="banco">Banco</label>
            <input id="banco" name="banco" defaultValue={f.extra.banco ?? ""} className={campo} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose} className="text-sm text-neutral-500 px-3 py-2">
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg">
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}
