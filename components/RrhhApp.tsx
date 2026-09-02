"use client";

import { useEffect, useState } from "react";
import { actualizarSueldoBase, actualizarValorHora } from "@/app/(app)/usuarios/actions";
import { crearHorario, actualizarHorario, desactivarHorario, listarHorarios, type HorarioTrabajo } from "@/app/(app)/organizacion/actions";
import {
  obtenerParametrosPresentismo,
  actualizarParametrosPresentismo,
  calcularPresentismoMes,
  listarPlanillaHoraria,
  listarFichajesPendientesSalida,
  completarSalidaManual,
  listarSaldosVacaciones,
  listarLicencias,
  crearLicencia,
  eliminarLicencia,
  obtenerNovedadesMes,
  cerrarNomina,
  estimarNomina,
  eliminarCierreNomina,
  pagarNomina,
  obtenerUrlReciboSueldo,
  listarFeriados,
  crearFeriado,
  eliminarFeriado,
  type PresentismoFila,
  type FilaPlanilla,
  type FichajePendiente,
  type SaldoVacaciones,
  type Licencia,
  type NovedadNomina,
  type Feriado,
} from "@/app/(app)/rrhh/actions";

type UsuarioMin = { id_usuario: string; nombre: string; sueldo_base: number | null };
type PersonaMin = { id_persona: string; nombre: string; apellido: string | null };
type Tab = "nomina" | "horarios" | "presentismo" | "vacaciones";

const RESULTADO_BADGE_NOMINA: Record<NovedadNomina["presentismoResultado"], string> = {
  COMPLETO: "bg-emerald-100 text-emerald-700",
  PARCIAL: "bg-amber-100 text-amber-700",
  PERDIDO: "bg-red-100 text-red-700",
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
  return new Date().toISOString().slice(0, 7);
}

export default function RrhhApp({
  usuarios,
  horariosIniciales,
  personas,
}: {
  usuarios: UsuarioMin[];
  horariosIniciales: HorarioTrabajo[];
  personas: PersonaMin[];
}) {
  const [tab, setTab] = useState<Tab>("nomina");
  const [horarios, setHorarios] = useState(horariosIniciales);

  function recargarHorarios() {
    listarHorarios().then(setHorarios);
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">RR.HH.</h1>
      <p className="text-sm text-neutral-500 mb-4 max-w-2xl">
        Sueldos, horarios de trabajo, presentismo, licencias y cierre de nómina. Todavía no maneja roles jerárquicos
        (eso queda para una fase siguiente).
      </p>

      <div className="inline-flex gap-1 bg-neutral-100 rounded-lg p-1 mb-4">
        {(
          [
            ["nomina", "💰 Nómina"],
            ["horarios", "🕐 Horarios"],
            ["presentismo", "📋 Presentismo"],
            ["vacaciones", "🌴 Vacaciones"],
          ] as [Tab, string][]
        ).map(([valor, etiqueta]) => (
          <button
            key={valor}
            onClick={() => setTab(valor)}
            className={`text-xs font-bold px-3 py-1.5 rounded-md ${tab === valor ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"}`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {tab === "nomina" && <TabNomina usuarios={usuarios} />}
      {tab === "horarios" && <TabHorarios horarios={horarios} onCambio={recargarHorarios} />}
      {tab === "presentismo" && <TabPresentismo />}
      {tab === "vacaciones" && <TabVacaciones personas={personas} />}
    </div>
  );
}

// ===================== NÓMINA =====================

function TabNomina({ usuarios }: { usuarios: UsuarioMin[] }) {
  const [mes, setMes] = useState(mesActualISO());
  const [filas, setFilas] = useState<NovedadNomina[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<string | null>(null);
  const [valorEditSueldo, setValorEditSueldo] = useState("");
  const [valorEditHora, setValorEditHora] = useState("");
  const [guardandoSueldo, setGuardandoSueldo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalCerrar, setModalCerrar] = useState<NovedadNomina | null>(null);
  const [modalPagar, setModalPagar] = useState<NovedadNomina | null>(null);
  const [modalEstimar, setModalEstimar] = useState<NovedadNomina | null>(null);

  function recargar() {
    setCargando(true);
    obtenerNovedadesMes(mes).then(setFilas).finally(() => setCargando(false));
  }

  useEffect(recargar, [mes]);

  function handleGuardarPagoBase(idUsuario: string) {
    const sueldo = Number(valorEditSueldo.replace(/[^\d.-]/g, "")) || 0;
    const hora = Number(valorEditHora.replace(/[^\d.-]/g, "")) || 0;
    setError(null);
    setGuardandoSueldo(true);
    Promise.all([actualizarSueldoBase(idUsuario, sueldo), actualizarValorHora(idUsuario, hora)])
      .then(([resSueldo, resHora]) => {
        if (resSueldo.error || resHora.error) {
          setError(resSueldo.error ?? resHora.error);
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

  return (
    <div>
      <p className="text-xs text-neutral-400 mb-3">
        Cerrá la nómina por persona apenas sepas el monto (no hace falta esperar a fin de mes) — calcula el incentivo
        de presentismo hasta ese momento y genera el gasto devengado en el Estado de Resultados. Si algo cambia
        después, "Deshacé" el cierre y volvé a cerrar antes de pagar. En los que cobran por hora, el pago base sale
        de sus horas trabajadas (Planilla horaria) × el valor hora que le cargues.
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
        <BloqueFeriados />
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : usuarios.length === 0 || filas.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">No hay usuarios activos con sueldo fijo o valor hora cargado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Empleado</th>
                  <th className="p-3 text-right">Pago base</th>
                  <th className="p-3">Presentismo</th>
                  <th className="p-3 text-right">Adelantos</th>
                  <th className="p-3 text-right">Nómina</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.idUsuario} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3">{f.nombre}</td>
                    <td className="p-3 text-right tabular-nums">
                      {editando === f.idUsuario ? (
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-neutral-400">Fijo $</span>
                            <input
                              autoFocus
                              value={valorEditSueldo}
                              onChange={(e) => setValorEditSueldo(e.target.value)}
                              className="w-20 border border-neutral-300 rounded-lg px-2 py-1 text-sm text-right"
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-neutral-400">Valor hora $</span>
                            <input
                              value={valorEditHora}
                              onChange={(e) => setValorEditHora(e.target.value)}
                              className="w-20 border border-neutral-300 rounded-lg px-2 py-1 text-sm text-right"
                            />
                          </div>
                          <button onClick={() => handleGuardarPagoBase(f.idUsuario)} disabled={guardandoSueldo} className="text-xs font-semibold text-accent">
                            {guardandoSueldo ? "Guardando..." : "Guardar"}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditando(f.idUsuario);
                            setValorEditSueldo(String(f.sueldoBase));
                            setValorEditHora(String(f.valorHora ?? 0));
                          }}
                          className="hover:underline decoration-dotted text-right"
                          title="Editar sueldo fijo / valor hora"
                        >
                          {f.modalidad === "POR_HORA" ? (
                            <>
                              <div>${formatearMonto(f.montoBase)}</div>
                              <div className="text-[10.5px] text-neutral-400 font-normal">
                                {f.horasTrabajadasMes ?? 0} hs × ${formatearMonto(f.valorHora ?? 0)}
                              </div>
                            </>
                          ) : (
                            `$${formatearMonto(f.sueldoBase)}`
                          )}
                        </button>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${RESULTADO_BADGE_NOMINA[f.presentismoResultado]}`}>
                        {RESULTADO_LABEL_NOMINA[f.presentismoResultado]}
                      </span>
                      <span className="text-[10.5px] text-neutral-400 ml-1.5">
                        +${formatearMonto(f.cierre ? f.cierre.incentivo_presentismo : f.incentivoPresentismoPreview)}
                      </span>
                    </td>
                    <td className="p-3 text-right tabular-nums text-red-600">
                      {(f.cierre ? f.cierre.adelantos : f.adelantos) > 0 ? `-$${formatearMonto(f.cierre ? f.cierre.adelantos : f.adelantos)}` : "—"}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {!f.cierre ? (
                        <span className="text-neutral-300 text-xs">Sin cerrar</span>
                      ) : f.cierre.es_estimado ? (
                        <span className="text-amber-700 tabular-nums">
                          <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 px-1.5 py-0.5 rounded mr-1">Estimado</span>
                          ${formatearMonto(f.cierre.neto_a_pagar)}
                        </span>
                      ) : (
                        <span className="font-bold tabular-nums">${formatearMonto(f.cierre.neto_a_pagar)}</span>
                      )}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {!f.cierre ? (
                        <div className="flex items-center justify-end gap-2.5">
                          {f.modalidad === "POR_HORA" && (
                            <button onClick={() => setModalEstimar(f)} className="text-xs text-neutral-400 hover:text-accent">
                              Estimar
                            </button>
                          )}
                          <button onClick={() => setModalCerrar(f)} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark px-3 py-1.5 rounded-lg">
                            Cerrar nómina
                          </button>
                        </div>
                      ) : f.cierre.es_estimado ? (
                        <div className="flex items-center justify-end gap-2.5">
                          <button onClick={() => handleDeshacerCierre(f)} className="text-xs text-neutral-400 hover:text-red-600">
                            Deshacer
                          </button>
                          <button onClick={() => setModalCerrar(f)} className="text-xs font-bold text-white bg-accent hover:bg-accent-dark px-3 py-1.5 rounded-lg">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
  const [incluirIncentivo, setIncluirIncentivo] = useState(true);
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
      <p className="text-xs text-neutral-400 mb-3">
        "Horario de trabajo" a propósito — no es lo mismo que un "turno" de caja. Creá horarios con nombre (ej. "Turno
        Mañana") y asignaselos a cada persona desde Organización.
      </p>
      <div className="flex justify-end mb-3">
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

// ===================== PRESENTISMO =====================

function TabPresentismo() {
  const [mes, setMes] = useState(mesActualISO());
  const [filas, setFilas] = useState<PresentismoFila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [params, setParams] = useState<Record<string, number> | null>(null);
  const [guardandoConfig, setGuardandoConfig] = useState(false);
  const [modalPlanilla, setModalPlanilla] = useState<PresentismoFila | null>(null);
  const [pendientes, setPendientes] = useState<FichajePendiente[]>([]);
  const [cargandoPendientes, setCargandoPendientes] = useState(true);

  function recargar() {
    setCargando(true);
    calcularPresentismoMes(mes).then(setFilas).finally(() => setCargando(false));
  }

  function recargarPendientes() {
    setCargandoPendientes(true);
    listarFichajesPendientesSalida().then(setPendientes).finally(() => setCargandoPendientes(false));
  }

  useEffect(recargar, [mes]);
  useEffect(recargarPendientes, []);
  useEffect(() => {
    obtenerParametrosPresentismo().then(setParams);
  }, []);

  function handleGuardarConfig(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setGuardandoConfig(true);
    actualizarParametrosPresentismo(formData)
      .then((res) => {
        if (!res.error) {
          obtenerParametrosPresentismo().then(setParams);
          recargar();
        }
      })
      .finally(() => setGuardandoConfig(false));
  }

  const RESULTADO_BADGE: Record<PresentismoFila["resultado"], string> = {
    COMPLETO: "bg-emerald-100 text-emerald-700",
    PARCIAL: "bg-amber-100 text-amber-700",
    PERDIDO: "bg-red-100 text-red-700",
  };

  return (
    <div>
      {!cargandoPendientes && pendientes.length > 0 && (
        <FichajesPendientesSalida
          pendientes={pendientes}
          onCompletado={() => {
            recargarPendientes();
            recargar();
          }}
        />
      )}

      <p className="text-xs text-neutral-400 mb-3">
        Solo cuenta tardanzas y faltas detectadas por fichaje — todavía no distingue ausencias autorizadas (eso llega
        con Vacaciones y Licencias). Revisá manualmente antes de aplicarlo a un pago.
      </p>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
        <button onClick={() => setMostrarConfig((v) => !v)} className="text-xs font-semibold text-accent">
          {mostrarConfig ? "▾" : "▸"} Configurar umbrales
        </button>
      </div>

      {mostrarConfig && params && (
        <form onSubmit={handleGuardarConfig} className="bg-white border border-neutral-200 rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Más de esta cantidad de tardanzas → pérdida total</label>
            <input type="number" name="PRESENTISMO_MAX_TARDANZAS" defaultValue={params.PRESENTISMO_MAX_TARDANZAS} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Esta cantidad de faltas (o más) → pérdida total</label>
            <input type="number" name="PRESENTISMO_MAX_FALTAS" defaultValue={params.PRESENTISMO_MAX_FALTAS} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Más de esta cantidad de salidas anticipadas → pérdida total</label>
            <input type="number" name="PRESENTISMO_MAX_SALIDAS_ANTICIPADAS" defaultValue={params.PRESENTISMO_MAX_SALIDAS_ANTICIPADAS} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Esta cantidad de tardanzas (o más) → pérdida parcial</label>
            <input type="number" name="PRESENTISMO_TARDANZAS_PARA_PARCIAL" defaultValue={params.PRESENTISMO_TARDANZAS_PARA_PARCIAL} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">% del sueldo que es el incentivo de presentismo</label>
            <input type="number" name="PRESENTISMO_PORCENTAJE_INCENTIVO" defaultValue={params.PRESENTISMO_PORCENTAJE_INCENTIVO} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm" />
            <p className="text-[10.5px] text-neutral-400 mt-1">Completo cobra el 100% de esto, Parcial la mitad, Perdido nada.</p>
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button type="submit" disabled={guardandoConfig} className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-medium px-4 py-1.5 rounded-lg text-sm">
              {guardandoConfig ? "Guardando..." : "Guardar umbrales"}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : filas.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">No hay personas con horario asignado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="p-3">Empleado</th>
                <th className="p-3 text-right">Tardanzas</th>
                <th className="p-3 text-right">Faltas</th>
                <th className="p-3 text-right">Salidas anticipadas</th>
                <th className="p-3">Presentismo</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.idPersona} className="border-b border-neutral-100 last:border-0">
                  <td className="p-3">{f.nombre}</td>
                  <td className="p-3 text-right tabular-nums">{f.tardanzas}</td>
                  <td className="p-3 text-right tabular-nums">{f.faltas}</td>
                  <td className="p-3 text-right tabular-nums">{f.salidasAnticipadas}</td>
                  <td className="p-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${RESULTADO_BADGE[f.resultado]}`}>
                      {f.resultado === "COMPLETO" ? "Completo" : f.resultado === "PARCIAL" ? "Parcial" : "Perdido"}
                    </span>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button onClick={() => setModalPlanilla(f)} className="text-xs font-semibold text-accent">
                      Planilla horaria →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalPlanilla && <ModalPlanillaHoraria fila={modalPlanilla} mes={mes} onClose={() => setModalPlanilla(null)} />}
    </div>
  );
}

function FichajesPendientesSalida({ pendientes, onCompletado }: { pendientes: FichajePendiente[]; onCompletado: () => void }) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [guardandoClave, setGuardandoClave] = useState<string | null>(null);

  function clave(p: FichajePendiente) {
    return `${p.idPersona}|${p.fecha}`;
  }

  function formatearFecha(fecha: string) {
    return new Date(`${fecha}T00:00:00`).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
  }

  function handleCompletar(p: FichajePendiente) {
    const hora = valores[clave(p)];
    if (!hora) return;
    setGuardandoClave(clave(p));
    completarSalidaManual(p.idPersona, p.fecha, hora)
      .then((res) => {
        if (res.error) alert(res.error);
        else onCompletado();
      })
      .finally(() => setGuardandoClave(null));
  }

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
      <h2 className="text-sm font-bold text-red-800 mb-1">⚠️ Fichajes sin salida ({pendientes.length})</h2>
      <p className="text-xs text-red-700 mb-3">Fichó entrada esos días pero nunca la salida. Cargá la hora real en que se fue.</p>
      <div className="space-y-2">
        {pendientes.map((p) => (
          <div key={clave(p)} className="bg-white border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2.5 flex-wrap">
            <span className="text-sm font-medium text-neutral-800 flex-1 min-w-[160px]">
              {p.nombre} <span className="text-neutral-400 font-normal capitalize">· {formatearFecha(p.fecha)}</span>
            </span>
            <span className="text-xs text-neutral-400">Entrada {p.horaEntrada}</span>
            <input
              type="time"
              value={valores[clave(p)] ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, [clave(p)]: e.target.value }))}
              className="border border-neutral-300 rounded-lg px-2 py-1 text-sm"
            />
            <button
              onClick={() => handleCompletar(p)}
              disabled={!valores[clave(p)] || guardandoClave === clave(p)}
              className="text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 px-3 py-1.5 rounded-lg"
            >
              {guardandoClave === clave(p) ? "..." : "Cargar salida"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModalPlanillaHoraria({ fila, mes, onClose }: { fila: PresentismoFila; mes: string; onClose: () => void }) {
  const [dias, setDias] = useState<FilaPlanilla[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    listarPlanillaHoraria(fila.idPersona, mes)
      .then(setDias)
      .finally(() => setCargando(false));
  }, [fila.idPersona, mes]);

  const diasTrabajados = dias.filter((d) => d.horaEntrada).length;
  const horasTotales = dias.reduce((acc, d) => acc + (d.horasTrabajadas ?? 0), 0);

  function formatearFecha(fecha: string) {
    return new Date(`${fecha}T00:00:00`).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Planilla horaria</h2>
            <p className="text-xs text-neutral-400">
              {fila.nombre} · {new Date(`${mes}-01T00:00:00`).toLocaleDateString("es-AR", { month: "long", year: "numeric" })}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2.5 my-4">
              <div className="bg-accent-tint rounded-lg px-3 py-2.5 text-center">
                <p className="text-lg font-extrabold text-accent tabular-nums">{diasTrabajados}</p>
                <p className="text-[10px] font-semibold uppercase text-neutral-500">Días trabajados</p>
              </div>
              <div className="bg-accent-tint rounded-lg px-3 py-2.5 text-center">
                <p className="text-lg font-extrabold text-accent tabular-nums">{horasTotales.toFixed(1)}</p>
                <p className="text-[10px] font-semibold uppercase text-neutral-500">Horas totales</p>
              </div>
              <div className="bg-accent-tint rounded-lg px-3 py-2.5 text-center">
                <p className="text-lg font-extrabold text-accent tabular-nums">{fila.tardanzas}</p>
                <p className="text-[10px] font-semibold uppercase text-neutral-500">Tardanzas</p>
              </div>
            </div>

            {dias.length === 0 ? (
              <p className="text-sm text-neutral-400 text-center py-8">No hay fichajes en este mes.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-[10.5px] font-bold uppercase tracking-wide text-neutral-400">
                      <th className="py-2 pr-2">Fecha</th>
                      <th className="py-2 pr-2">Hora de ingreso</th>
                      <th className="py-2 pr-2">Hora de salida</th>
                      <th className="py-2 pr-2 text-right">Total hs</th>
                      <th className="py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dias.map((d) => {
                      const badges: { label: string; clases: string }[] = [];
                      if (!d.horaEntrada) badges.push({ label: "Sin fichaje", clases: "bg-neutral-100 text-neutral-400" });
                      else {
                        badges.push(d.tardanza ? { label: "Tardanza", clases: "bg-amber-100 text-amber-700" } : { label: "A tiempo", clases: "bg-emerald-100 text-emerald-700" });
                        if (!d.horaSalida) badges.push({ label: "Sin salida", clases: "bg-red-100 text-red-700" });
                        else if (d.salidaAnticipada) badges.push({ label: "Salida anticipada", clases: "bg-red-100 text-red-700" });
                      }
                      return (
                        <tr key={d.fecha} className="border-b border-dashed border-neutral-100 last:border-0">
                          <td className="py-2 pr-2 font-bold text-neutral-800 capitalize whitespace-nowrap">{formatearFecha(d.fecha)}</td>
                          <td className={`py-2 pr-2 tabular-nums ${d.tardanza ? "font-bold text-amber-600" : "text-neutral-500"}`}>{d.horaEntrada ?? "—"}</td>
                          <td className={`py-2 pr-2 tabular-nums ${d.salidaAnticipada || (d.horaEntrada && !d.horaSalida) ? "font-bold text-red-600" : "text-neutral-500"}`}>{d.horaSalida ?? "—"}</td>
                          <td className="py-2 pr-2 text-right font-bold text-neutral-800 tabular-nums whitespace-nowrap">{d.horasTrabajadas != null ? `${d.horasTrabajadas} hs` : "—"}</td>
                          <td className="py-2">
                            <span className="flex gap-1 flex-wrap">
                              {badges.map((b) => (
                                <span key={b.label} className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${b.clases}`}>
                                  {b.label}
                                </span>
                              ))}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ===================== VACACIONES Y LICENCIAS =====================

function anioActual() {
  return new Date().getFullYear();
}

function TabVacaciones({ personas }: { personas: PersonaMin[] }) {
  const [anio, setAnio] = useState(anioActual());
  const [saldos, setSaldos] = useState<SaldoVacaciones[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modalPersona, setModalPersona] = useState<SaldoVacaciones | null>(null);

  function recargar() {
    setCargando(true);
    listarSaldosVacaciones(anio).then(setSaldos).finally(() => setCargando(false));
  }

  useEffect(recargar, [anio]);

  return (
    <div>
      <p className="text-xs text-neutral-400 mb-3">
        Días legales según antigüedad (Art. 150/151 LCT) — no suma días extra que tu convenio colectivo pudiera dar
        por encima del mínimo. Vos cargás la licencia ya definida, no hay pantalla de solicitud para el empleado.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => setAnio((a) => a - 1)} className="px-2 py-1 text-neutral-400 hover:text-neutral-700 font-bold">
          ‹
        </button>
        <span className="text-sm font-bold w-14 text-center">{anio}</span>
        <button onClick={() => setAnio((a) => a + 1)} className="px-2 py-1 text-neutral-400 hover:text-neutral-700 font-bold">
          ›
        </button>
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : saldos.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">No hay personas con fecha de ingreso cargada (Legajo).</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="p-3">Empleado</th>
                <th className="p-3 text-right">Días legales {anio}</th>
                <th className="p-3 text-right">Tomados</th>
                <th className="p-3 text-right">Disponibles</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {saldos.map((s) => (
                <tr key={s.idPersona} className="border-b border-neutral-100 last:border-0">
                  <td className="p-3">{s.nombre}</td>
                  <td className="p-3 text-right tabular-nums">{s.diasLegales}</td>
                  <td className="p-3 text-right tabular-nums text-neutral-500">{s.diasTomados}</td>
                  <td className={`p-3 text-right tabular-nums font-bold ${s.diasDisponibles < 0 ? "text-red-600" : "text-emerald-600"}`}>{s.diasDisponibles}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => setModalPersona(s)} className="text-xs font-semibold text-accent">
                      Ver licencias →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalPersona && (
        <ModalLicenciasPersona
          persona={modalPersona}
          onClose={() => setModalPersona(null)}
          onCambio={recargar}
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
