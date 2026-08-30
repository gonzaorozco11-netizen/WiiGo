"use client";

import { useEffect, useState } from "react";
import { resumenNomina } from "@/app/(app)/gastos/actions";
import { actualizarSueldoBase } from "@/app/(app)/usuarios/actions";
import { crearHorario, actualizarHorario, desactivarHorario, listarHorarios, type HorarioTrabajo } from "@/app/(app)/organizacion/actions";
import { obtenerParametrosPresentismo, actualizarParametrosPresentismo, calcularPresentismoMes, type PresentismoFila } from "@/app/(app)/rrhh/actions";

type UsuarioMin = { id_usuario: string; nombre: string; sueldo_base: number | null };
type NominaFila = { idUsuario: string; nombre: string; sueldoBase: number; adelantado: number; aPagar: number };
type Tab = "nomina" | "horarios" | "presentismo";

const DIAS_LABEL: Record<number, string> = { 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb", 7: "Dom" };

function formatearMonto(valor: number) {
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

function mesActualISO() {
  return new Date().toISOString().slice(0, 7);
}

export default function RrhhApp({ usuarios, horariosIniciales }: { usuarios: UsuarioMin[]; horariosIniciales: HorarioTrabajo[] }) {
  const [tab, setTab] = useState<Tab>("nomina");
  const [horarios, setHorarios] = useState(horariosIniciales);

  function recargarHorarios() {
    listarHorarios().then(setHorarios);
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">RR.HH.</h1>
      <p className="text-sm text-neutral-500 mb-4 max-w-2xl">
        Sueldos, horarios de trabajo y presentismo. No reemplaza un módulo de RR.HH. completo (vacaciones, licencias,
        nómina con pasivo contable) — eso se arma en fases siguientes.
      </p>

      <div className="inline-flex gap-1 bg-neutral-100 rounded-lg p-1 mb-4">
        {(
          [
            ["nomina", "💰 Nómina"],
            ["horarios", "🕐 Horarios"],
            ["presentismo", "📋 Presentismo"],
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
    </div>
  );
}

// ===================== NÓMINA =====================

function TabNomina({ usuarios }: { usuarios: UsuarioMin[] }) {
  const [mes, setMes] = useState(mesActualISO());
  const [filas, setFilas] = useState<NominaFila[]>([]);
  const [cargando, setCargando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [valorEdit, setValorEdit] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function recargar() {
    setCargando(true);
    resumenNomina(mes).then(setFilas).finally(() => setCargando(false));
  }

  useEffect(recargar, [mes]);

  function handleGuardarSueldo(idUsuario: string) {
    const monto = Number(valorEdit.replace(/[^\d.-]/g, "")) || 0;
    setError(null);
    setGuardando(true);
    actualizarSueldoBase(idUsuario, monto)
      .then((res) => {
        if (res.error) {
          setError(res.error);
          return;
        }
        setEditando(null);
        recargar();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div>
      <p className="text-xs text-neutral-400 mb-3">
        👥 Sueldo simplificado por empleado — sueldo base − adelantos del mes = a pagar.
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="mb-4">
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="border border-neutral-300 rounded-lg px-2.5 py-1.5 text-sm" />
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="flex items-baseline justify-between px-4 py-3 border-b border-neutral-100">
          <h2 className="text-sm font-bold text-neutral-900">Sueldos del mes</h2>
          <span className="text-xs text-neutral-400">Sueldo base − adelantos del mes = a pagar</span>
        </div>
        {cargando ? (
          <p className="text-sm text-neutral-400 text-center py-8">Cargando...</p>
        ) : usuarios.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">No hay usuarios activos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Empleado</th>
                  <th className="p-3 text-right">Sueldo base</th>
                  <th className="p-3 text-right">Adelantos del mes</th>
                  <th className="p-3 text-right">A pagar</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.idUsuario} className="border-b border-neutral-100 last:border-0">
                    <td className="p-3">{f.nombre}</td>
                    <td className="p-3 text-right tabular-nums">
                      {editando === f.idUsuario ? (
                        <input
                          autoFocus
                          value={valorEdit}
                          onChange={(e) => setValorEdit(e.target.value)}
                          className="w-28 border border-neutral-300 rounded-lg px-2 py-1 text-sm text-right"
                        />
                      ) : (
                        `$${formatearMonto(f.sueldoBase)}`
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums text-red-600">{f.adelantado > 0 ? `-$${formatearMonto(f.adelantado)}` : "—"}</td>
                    <td className="p-3 text-right tabular-nums font-bold">${formatearMonto(f.aPagar)}</td>
                    <td className="p-3 text-right">
                      {editando === f.idUsuario ? (
                        <button onClick={() => handleGuardarSueldo(f.idUsuario)} disabled={guardando} className="text-xs font-semibold text-accent">
                          {guardando ? "..." : "Guardar"}
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setEditando(f.idUsuario);
                            setValorEdit(String(f.sueldoBase));
                          }}
                          className="text-xs font-semibold text-neutral-500 hover:text-accent"
                        >
                          Editar sueldo base
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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

  function recargar() {
    setCargando(true);
    calcularPresentismoMes(mes).then(setFilas).finally(() => setCargando(false));
  }

  useEffect(recargar, [mes]);
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
