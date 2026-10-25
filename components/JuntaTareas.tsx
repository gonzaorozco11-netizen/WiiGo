"use client";

import { useState } from "react";
import { aprobarTarea, cerrarTarea, crearTarea, type CambiosTarea } from "@/app/(app)/junta/actions";
import { ENCARGADOS } from "@/lib/juntaPersonajes";
import type { EquipoTareas, TareaVista } from "@/lib/tareasEquipo";

// La parte de tareas de la Junta: lo que propusieron los encargados esperando
// aprobación (se puede cambiar antes de aprobar), cargar una a mano, y cómo
// van las que ya tiene el equipo. Nada le llega a nadie sin pasar por acá.

const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

const deVista = (t: TareaVista): CambiosTarea => ({
  titulo: t.titulo,
  paraTipo: t.paraTipo,
  idHorario: t.idHorario,
  idPersona: t.idPersona,
  vence: t.vence,
  repiteDia: t.repiteDia,
});
const NUEVA: CambiosTarea = { titulo: "", paraTipo: "TODOS", idHorario: null, idPersona: null, vence: null, repiteDia: null };

function quienPropone(id: string) {
  const e = ENCARGADOS.find((x) => x.id === id);
  return e ? { texto: `Propone ${e.nombre} · ${e.area}`, color: e.color } : { texto: "Cargada por vos", color: "#3d5a3a" };
}

/** Los campos que se pueden cambiar: texto, para quién, para cuándo o cada semana. */
function Formulario({ valor, onChange, equipo }: { valor: CambiosTarea; onChange: (v: CambiosTarea) => void; equipo: EquipoTareas }) {
  const para = valor.paraTipo === "TURNO" ? `T:${valor.idHorario}` : valor.paraTipo === "PERSONA" ? `P:${valor.idPersona}` : "TODOS";
  return (
    <div className="jt-form">
      <textarea rows={2} value={valor.titulo} onChange={(e) => onChange({ ...valor, titulo: e.target.value })} aria-label="Qué hay que hacer" placeholder="Qué hay que hacer" />
      <div className="jt-form-fila">
        <label>
          Para quién
          <select
            value={para}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("T:")) onChange({ ...valor, paraTipo: "TURNO", idHorario: v.slice(2), idPersona: null });
              else if (v.startsWith("P:")) onChange({ ...valor, paraTipo: "PERSONA", idPersona: v.slice(2), idHorario: null });
              else onChange({ ...valor, paraTipo: "TODOS", idHorario: null, idPersona: null });
            }}
          >
            <option value="TODOS">Todo el equipo</option>
            {equipo.turnos.length > 0 && (
              <optgroup label="Turnos">
                {equipo.turnos.map((t) => (
                  <option key={t.id} value={`T:${t.id}`}>
                    {t.nombre}
                  </option>
                ))}
              </optgroup>
            )}
            {equipo.personas.length > 0 && (
              <optgroup label="Personas">
                {equipo.personas.map((p) => (
                  <option key={p.id} value={`P:${p.id}`}>
                    {p.nombre}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label>
          Cuándo
          <select value={valor.repiteDia ? String(valor.repiteDia) : "UNA"} onChange={(e) => onChange({ ...valor, repiteDia: e.target.value === "UNA" ? null : Number(e.target.value) })}>
            <option value="UNA">Una sola vez</option>
            {DIAS.map((d, i) => (
              <option key={d} value={i + 1}>
                Todos los {d}
                {i >= 5 ? "s" : ""}
              </option>
            ))}
          </select>
        </label>
        {!valor.repiteDia && (
          <label>
            Para el
            <input type="date" value={valor.vence ?? ""} onChange={(e) => onChange({ ...valor, vence: e.target.value || null })} />
          </label>
        )}
      </div>
    </div>
  );
}

function Propuesta({ t, equipo, onListo }: { t: TareaVista; equipo: EquipoTareas; onListo: () => void }) {
  const [valor, setValor] = useState(deVista(t));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = quienPropone(t.propuestaPor);

  async function hacer(accion: "aprobar" | "descartar") {
    setEnviando(true);
    setError(null);
    const r = accion === "aprobar" ? await aprobarTarea(t.id, valor) : await cerrarTarea(t.id, "DESCARTADA");
    setEnviando(false);
    if (r.error) setError(r.error);
    else onListo();
  }

  return (
    <div className="jt-tarea" style={{ ["--c" as string]: q.color }}>
      <Formulario valor={valor} onChange={setValor} equipo={equipo} />
      <p className="jt-tarea-por">
        {q.texto}
        {t.motivo ? ` · ${t.motivo}` : ""}
      </p>
      {error && <p className="jt-error">{error}</p>}
      <div className="jt-botones">
        <button type="button" className="si" disabled={enviando} onClick={() => hacer("aprobar")}>
          Aprobar y asignar
        </button>
        <button type="button" className="no" disabled={enviando} onClick={() => hacer("descartar")}>
          Descartar
        </button>
      </div>
    </div>
  );
}

function Nueva({ equipo, onListo }: { equipo: EquipoTareas; onListo: () => void }) {
  const [abierta, setAbierta] = useState(false);
  const [valor, setValor] = useState(NUEVA);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!abierta)
    return (
      <button type="button" className="jt-nueva" onClick={() => setAbierta(true)}>
        + Cargar una tarea a mano
      </button>
    );
  return (
    <div className="jt-tarea" style={{ ["--c" as string]: "#3d5a3a" }}>
      <Formulario valor={valor} onChange={setValor} equipo={equipo} />
      {error && <p className="jt-error">{error}</p>}
      <div className="jt-botones">
        <button
          type="button"
          className="si"
          disabled={enviando}
          onClick={async () => {
            setEnviando(true);
            setError(null);
            const r = await crearTarea(valor);
            setEnviando(false);
            if (r.error) setError(r.error);
            else {
              setValor(NUEVA);
              setAbierta(false);
              onListo();
            }
          }}
        >
          Asignar
        </button>
        <button type="button" className="no" onClick={() => setAbierta(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default function JuntaTareas({ tareas, equipo, faltaSql, onCambio }: { tareas: TareaVista[]; equipo: EquipoTareas; faltaSql: boolean; onCambio: () => void }) {
  const propuestas = tareas.filter((t) => t.estadoTarea === "PROPUESTA");
  const activas = tareas.filter((t) => t.estadoTarea === "ACTIVA");
  const [archivando, setArchivando] = useState<string | null>(null);

  if (faltaSql) return <p className="jt-aviso">Falta correr sql/tareas-equipo.sql en Supabase para que la Junta pueda proponer tareas.</p>;

  return (
    <div className="jt-tareas">
      <h2>
        Para aprobar <span className="jt-cuenta">{propuestas.length}</span>
      </h2>
      {propuestas.length === 0 ? (
        <p className="jt-vacio">No hay propuestas esperando. Pedile a un encargado, por ejemplo: <b>"Carmen, armá las tareas de limpieza de la semana"</b>.</p>
      ) : (
        propuestas.map((t) => <Propuesta key={t.id} t={t} equipo={equipo} onListo={onCambio} />)
      )}
      <Nueva equipo={equipo} onListo={onCambio} />

      <h2 style={{ marginTop: 6 }}>
        Tareas del equipo <span className="jt-cuenta">{activas.length}</span>
      </h2>
      {activas.length === 0 ? (
        <p className="jt-vacio">Todavía no hay tareas asignadas.</p>
      ) : (
        <div className="jt-activas">
          {activas.map((t) => (
            <div key={t.id} className="jt-activa">
              <div>
                <b>{t.titulo}</b>
                <span>
                  {t.para} · {t.cuando}
                </span>
              </div>
              <span className={`jt-estado ${t.situacion.toLowerCase()}`}>
                {t.situacion === "HECHA" ? `Hecha · ${t.hecha?.nombre ?? ""}` : t.situacion === "VENCIDA" ? "Vencida" : "Pendiente"}
              </span>
              <button
                type="button"
                className="jt-archivar"
                disabled={archivando === t.id}
                title="Sacarla de Mis Tareas del equipo"
                onClick={async () => {
                  setArchivando(t.id);
                  await cerrarTarea(t.id, "ARCHIVADA");
                  setArchivando(null);
                  onCambio();
                }}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="jt-nota">Al equipo le aparecen en Mis Tareas, "de parte de Administración WiiGo". Las tareas que se repiten vuelven cada semana.</p>
    </div>
  );
}
