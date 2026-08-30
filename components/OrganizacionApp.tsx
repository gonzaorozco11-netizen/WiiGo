"use client";

import { Fragment, useEffect, useState } from "react";
import type { Local, Area, Puesto, Usuario } from "@/lib/supabase";
import { PANTALLAS_DISPONIBLES } from "@/lib/pantallas";
import UsuariosApp from "@/components/UsuariosApp";
import {
  listarAreas,
  crearArea,
  actualizarArea,
  cambiarEstadoArea,
  listarPuestos,
  crearPuesto,
  actualizarPuesto,
  cambiarEstadoPuesto,
  listarPersonas,
  crearPersona,
  actualizarPersona,
  cambiarEstadoPersona,
  subirFotoPersona,
  listarHorarios,
  type PersonaConPuestos,
  type HorarioTrabajo,
} from "@/app/(app)/organizacion/actions";
import ModalLegajo from "@/components/ModalLegajo";

const TIPOS_PERSONA: Record<string, string> = {
  SOCIO: "Socio",
  EMPLEADO: "Empleado",
  EXTERNO: "Externo",
};

type Tab = "personas" | "areas" | "puestos" | "organigrama" | "usuarios";

const COLORES_AVATAR = ["bg-accent", "bg-emerald-500", "bg-amber-500", "bg-purple-500", "bg-rose-500", "bg-teal-500"];

function colorAvatar(texto: string) {
  let hash = 0;
  for (const c of texto) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return COLORES_AVATAR[hash % COLORES_AVATAR.length];
}

function Avatar({
  nombre,
  apellido,
  fotoUrl,
  tamaño = "sm",
}: {
  nombre: string;
  apellido?: string | null;
  fotoUrl?: string | null;
  tamaño?: "sm" | "md";
}) {
  const clases = tamaño === "md" ? "w-14 h-14 text-lg" : "w-9 h-9 text-xs";
  const iniciales = `${nombre[0] ?? ""}${apellido?.[0] ?? ""}`.toUpperCase();

  if (fotoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={fotoUrl} alt={nombre} className={`${clases} rounded-full object-cover shrink-0 border border-neutral-200`} />;
  }
  return (
    <div className={`${clases} ${colorAvatar(nombre + (apellido ?? ""))} rounded-full flex items-center justify-center text-white font-bold shrink-0`}>
      {iniciales || "?"}
    </div>
  );
}

export default function OrganizacionApp({
  locales,
  esAdmin,
  usuarios,
}: {
  locales: Local[];
  esAdmin: boolean;
  usuarios: Omit<Usuario, "password_hash">[];
}) {
  const [tab, setTab] = useState<Tab>("personas");
  const [areas, setAreas] = useState<Area[]>([]);
  const [puestos, setPuestos] = useState<Puesto[]>([]);
  const [personas, setPersonas] = useState<PersonaConPuestos[]>([]);
  const [horarios, setHorarios] = useState<HorarioTrabajo[]>([]);
  const [cargando, setCargando] = useState(true);

  function recargarTodo() {
    setCargando(true);
    Promise.all([listarAreas(), listarPuestos(), listarPersonas(), listarHorarios()])
      .then(([a, p, per, h]) => {
        setAreas(a);
        setPuestos(p);
        setPersonas(per);
        setHorarios(h);
      })
      .finally(() => setCargando(false));
  }

  useEffect(recargarTodo, []);

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">Organización</h1>
      <p className="text-sm text-neutral-500 mb-4 max-w-2xl">
        Personas, áreas, puestos y el organigrama — armado solo, a partir de esos tres datos. Una persona puede tener
        varias áreas y puestos a la vez, con uno marcado como principal.
      </p>

      <div className="inline-flex gap-1 bg-neutral-100 rounded-lg p-1 mb-4">
        {(
          [
            ["personas", "👥 Personas"],
            ["areas", "🧩 Áreas"],
            ["puestos", "💼 Puestos"],
            ["organigrama", "🌳 Organigrama"],
            ...(esAdmin ? ([["usuarios", "🔐 Usuarios"]] as [Tab, string][]) : []),
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

      {cargando ? (
        <p className="text-sm text-neutral-400 text-center py-12">Cargando...</p>
      ) : tab === "personas" ? (
        <TabPersonas personas={personas} areas={areas} puestos={puestos} locales={locales} horarios={horarios} onCambio={recargarTodo} />
      ) : tab === "areas" ? (
        <TabAreas areas={areas} esAdmin={esAdmin} onCambio={recargarTodo} />
      ) : tab === "puestos" ? (
        <TabPuestos puestos={puestos} areas={areas} onCambio={recargarTodo} />
      ) : tab === "usuarios" && esAdmin ? (
        <UsuariosApp usuarios={usuarios} areas={areas} personas={personas} />
      ) : (
        <TabOrganigrama personas={personas} />
      )}
    </div>
  );
}

// ===================== PERSONAS =====================

function TabPersonas({
  personas,
  areas,
  puestos,
  locales,
  horarios,
  onCambio,
}: {
  personas: PersonaConPuestos[];
  areas: Area[];
  puestos: Puesto[];
  locales: Local[];
  horarios: HorarioTrabajo[];
  onCambio: () => void;
}) {
  const [modal, setModal] = useState<"nueva" | PersonaConPuestos | null>(null);
  const [modalLegajo, setModalLegajo] = useState<PersonaConPuestos | null>(null);
  const localPorId = new Map(locales.map((l) => [l.id_local, l.nombre]));
  const horarioPorId = new Map(horarios.map((h) => [h.id_horario, h.nombre]));
  const personaPorId = new Map(personas.map((p) => [p.id_persona, p]));

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setModal("nueva")} className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium">
          + Nueva persona
        </button>
      </div>

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden overflow-x-auto">
        {personas.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-10">Todavía no cargaste ninguna persona.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="p-3">Persona</th>
                <th className="p-3">Áreas y puestos</th>
                <th className="p-3">Sucursal</th>
                <th className="p-3">Horario</th>
                <th className="p-3">Reporta a</th>
                <th className="p-3">Tipo</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => (
                <tr key={p.id_persona} className="border-b border-neutral-100 last:border-0 align-top">
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar nombre={p.nombre} apellido={p.apellido} fotoUrl={p.foto_url} />
                      <div>
                        <span className="font-medium text-neutral-900 block">
                          {p.nombre} {p.apellido ?? ""}
                        </span>
                        {p.email && <span className="block text-xs text-neutral-400">{p.email}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {p.asignaciones.length === 0 ? (
                        <span className="text-xs text-neutral-300">Sin asignar</span>
                      ) : (
                        p.asignaciones.map((a) => (
                          <span
                            key={a.idPuesto}
                            className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${
                              a.esPrincipal ? "bg-accent text-white" : "bg-accent-tint text-accent"
                            }`}
                          >
                            {a.nombrePuesto} · {a.nombreArea}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-neutral-500">{p.id_local ? localPorId.get(p.id_local) ?? "—" : "—"}</td>
                  <td className="p-3 text-neutral-500">{p.id_horario ? horarioPorId.get(p.id_horario) ?? "—" : "—"}</td>
                  <td className="p-3 text-neutral-500">{p.reporta_a ? personaPorId.get(p.reporta_a)?.nombre ?? "—" : "—"}</td>
                  <td className="p-3">
                    <span className="text-xs bg-neutral-100 text-neutral-600 rounded-full px-2 py-0.5">
                      {TIPOS_PERSONA[p.tipo] ?? p.tipo}
                    </span>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button onClick={() => setModalLegajo(p)} className="text-sm text-accent hover:underline mr-3">
                      Ver legajo
                    </button>
                    <button onClick={() => setModal(p)} className="text-sm text-accent hover:underline mr-3">
                      Editar
                    </button>
                    <button
                      onClick={() => cambiarEstadoPersona(p.id_persona, "INACTIVO").then(onCambio)}
                      className="text-sm text-red-500 hover:text-red-700"
                    >
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
        <ModalPersona
          persona={modal === "nueva" ? null : modal}
          personas={personas}
          areas={areas}
          puestos={puestos}
          locales={locales}
          horarios={horarios}
          onClose={() => setModal(null)}
          onGuardado={() => {
            setModal(null);
            onCambio();
          }}
        />
      )}

      {modalLegajo && (
        <ModalLegajo
          persona={modalLegajo}
          onClose={() => setModalLegajo(null)}
          onGuardado={onCambio}
        />
      )}
    </div>
  );
}

function ModalPersona({
  persona,
  personas,
  areas,
  puestos,
  locales,
  horarios,
  onClose,
  onGuardado,
}: {
  persona: PersonaConPuestos | null;
  personas: PersonaConPuestos[];
  areas: Area[];
  puestos: Puesto[];
  locales: Local[];
  horarios: HorarioTrabajo[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const isEditing = !!persona;
  const [asignaciones, setAsignaciones] = useState<{ idArea: string; idPuesto: string; esPrincipal: boolean }[]>(
    persona?.asignaciones.map((a) => ({ idArea: a.idArea, idPuesto: a.idPuesto, esPrincipal: a.esPrincipal })) ?? []
  );
  const [fotoUrl, setFotoUrl] = useState(persona?.foto_url ?? null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo || !persona) return;
    const formData = new FormData();
    formData.set("archivo", archivo);
    setSubiendoFoto(true);
    subirFotoPersona(persona.id_persona, formData)
      .then((res) => {
        if (res.error) setError(res.error);
        else if (res.url) setFotoUrl(res.url);
      })
      .finally(() => setSubiendoFoto(false));
  }

  function agregarAsignacion() {
    setAsignaciones((prev) => [...prev, { idArea: areas[0]?.id_area ?? "", idPuesto: "", esPrincipal: prev.length === 0 }]);
  }

  function actualizarAsignacion(i: number, cambios: Partial<{ idArea: string; idPuesto: string }>) {
    setAsignaciones((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...cambios } : a)));
  }

  function marcarPrincipal(i: number) {
    setAsignaciones((prev) => prev.map((a, idx) => ({ ...a, esPrincipal: idx === i })));
  }

  function quitarAsignacion(i: number) {
    setAsignaciones((prev) => {
      const nueva = prev.filter((_, idx) => idx !== i);
      if (nueva.length > 0 && !nueva.some((a) => a.esPrincipal)) nueva[0].esPrincipal = true;
      return nueva;
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const asignacionesValidas = asignaciones.filter((a) => a.idPuesto);
    formData.set("asignaciones", JSON.stringify(asignacionesValidas.map((a) => ({ idPuesto: a.idPuesto, esPrincipal: a.esPrincipal }))));
    setGuardando(true);
    (isEditing ? actualizarPersona(persona!.id_persona, formData) : crearPersona(formData))
      .then((res) => {
        if (res.error) setError(res.error);
        else onGuardado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">{isEditing ? "Editar persona" : "Nueva persona"}</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3" role="alert">{error}</p>}

        {isEditing && (
          <div className="flex items-center gap-3 mb-4">
            <Avatar nombre={persona!.nombre} apellido={persona!.apellido} fotoUrl={fotoUrl} tamaño="md" />
            <label className="text-xs font-semibold text-accent cursor-pointer">
              {subiendoFoto ? "Subiendo..." : fotoUrl ? "Cambiar foto" : "Agregar foto"}
              <input type="file" accept="image/*" onChange={handleFoto} disabled={subiendoFoto} className="hidden" />
            </label>
          </div>
        )}
        {!isEditing && (
          <p className="text-xs text-neutral-400 mb-3">Podés agregarle una foto después de crearla, desde "Editar".</p>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Nombre *</label>
            <input name="nombre" defaultValue={persona?.nombre ?? ""} required className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Apellido</label>
            <input name="apellido" defaultValue={persona?.apellido ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Email</label>
            <input name="email" type="email" defaultValue={persona?.email ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Teléfono</label>
            <input name="telefono" defaultValue={persona?.telefono ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Tipo</label>
            <select name="tipo" defaultValue={persona?.tipo ?? "EMPLEADO"} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white">
              <option value="SOCIO">Socio</option>
              <option value="EMPLEADO">Empleado</option>
              <option value="EXTERNO">Externo</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Sucursal principal</label>
            <select name="id_local" defaultValue={persona?.id_local ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white">
              <option value="">Sin sucursal</option>
              {locales.map((l) => (
                <option key={l.id_local} value={l.id_local}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Horario de trabajo</label>
            <select name="id_horario" defaultValue={persona?.id_horario ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white">
              <option value="">Sin horario asignado</option>
              {horarios.map((h) => (
                <option key={h.id_horario} value={h.id_horario}>
                  {h.nombre} ({h.hora_entrada.slice(0, 5)})
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-neutral-600 mb-1">Reporta a</label>
            <select name="reporta_a" defaultValue={persona?.reporta_a ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm bg-white">
              <option value="">Nadie (nivel más alto)</option>
              {personas
                .filter((p) => p.id_persona !== persona?.id_persona)
                .map((p) => (
                  <option key={p.id_persona} value={p.id_persona}>
                    {p.nombre} {p.apellido ?? ""}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between mb-2 mt-4">
          <p className="text-sm font-semibold text-neutral-800">Áreas y puestos</p>
          <button type="button" onClick={agregarAsignacion} className="text-xs font-semibold text-accent">
            + Agregar área / puesto
          </button>
        </div>
        <p className="text-xs text-neutral-400 mb-2">Podés agregar varias asignaciones. La principal es la que se muestra primero.</p>

        <div className="space-y-2 mb-2">
          {asignaciones.length === 0 && <p className="text-xs text-neutral-300">Sin áreas ni puestos asignados todavía.</p>}
          {asignaciones.map((a, i) => {
            const puestosDelArea = puestos.filter((p) => p.id_area === a.idArea);
            return (
              <div key={i} className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-lg p-2">
                <select
                  value={a.idArea}
                  onChange={(e) => actualizarAsignacion(i, { idArea: e.target.value, idPuesto: "" })}
                  className="flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs bg-white"
                >
                  {areas.map((ar) => (
                    <option key={ar.id_area} value={ar.id_area}>
                      {ar.nombre}
                    </option>
                  ))}
                </select>
                <select
                  value={a.idPuesto}
                  onChange={(e) => actualizarAsignacion(i, { idPuesto: e.target.value })}
                  className="flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs bg-white"
                >
                  <option value="">Elegí un puesto...</option>
                  {puestosDelArea.map((p) => (
                    <option key={p.id_puesto} value={p.id_puesto}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                  <input type="radio" name="principal" checked={a.esPrincipal} onChange={() => marcarPrincipal(i)} />
                  Principal
                </label>
                <button type="button" onClick={() => quitarAsignacion(i)} className="text-xs text-red-500 whitespace-nowrap">
                  Quitar
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 pt-3 mt-3 border-t border-neutral-100">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700">
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50">
            {guardando ? "Guardando..." : isEditing ? "Guardar cambios" : "Crear persona"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ===================== ÁREAS =====================

function TabAreas({ areas, esAdmin, onCambio }: { areas: Area[]; esAdmin: boolean; onCambio: () => void }) {
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setCreando((v) => !v)} className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium">
          {creando ? "Cancelar" : "+ Nueva área"}
        </button>
      </div>
      {creando && <FormArea esAdmin={esAdmin} onGuardado={() => { setCreando(false); onCambio(); }} />}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        {areas.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-10">Todavía no creaste ningún área.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="p-3">Área</th>
                <th className="p-3">Descripción</th>
                <th className="p-3">Orden</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {areas.map((a) => (
                <Fragment key={a.id_area}>
                  <tr className="border-b border-neutral-100 last:border-0">
                    <td className="p-3 font-medium text-neutral-900">{a.nombre}</td>
                    <td className="p-3 text-neutral-500">{a.descripcion ?? "—"}</td>
                    <td className="p-3 text-neutral-500">{a.orden}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => setEditando(editando === a.id_area ? null : a.id_area)} className="text-sm text-accent hover:underline mr-3">
                        Editar
                      </button>
                      <button onClick={() => cambiarEstadoArea(a.id_area, "INACTIVA").then(onCambio)} className="text-sm text-red-500 hover:text-red-700">
                        Desactivar
                      </button>
                    </td>
                  </tr>
                  {editando === a.id_area && (
                    <tr>
                      <td colSpan={4} className="bg-neutral-50 p-4">
                        <FormArea area={a} esAdmin={esAdmin} onGuardado={() => { setEditando(null); onCambio(); }} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const GRUPOS_PANTALLAS = [...new Set(PANTALLAS_DISPONIBLES.map((p) => p.grupo))];

function FormArea({ area, esAdmin, onGuardado }: { area?: Area; esAdmin: boolean; onGuardado: () => void }) {
  const [pantallas, setPantallas] = useState<string[]>(area?.pantallas ?? []);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(clave: string) {
    setPantallas((prev) => (prev.includes(clave) ? prev.filter((p) => p !== clave) : [...prev, clave]));
  }

  function toggleGrupo(grupo: string) {
    const clavesGrupo = PANTALLAS_DISPONIBLES.filter((p) => p.grupo === grupo).map((p) => p.clave);
    const yaCompleto = clavesGrupo.every((c) => pantallas.includes(c));
    setPantallas((prev) =>
      yaCompleto ? prev.filter((c) => !clavesGrupo.includes(c)) : [...new Set([...prev, ...clavesGrupo])]
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    pantallas.forEach((p) => formData.append("pantallas", p));
    setGuardando(true);
    (area ? actualizarArea(area.id_area, formData) : crearArea(formData))
      .then((res) => {
        if (res.error) setError(res.error);
        else onGuardado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <form onSubmit={handleSubmit} className={area ? "" : "bg-white border border-neutral-200 rounded-xl p-4 mb-3"}>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <input name="nombre" defaultValue={area?.nombre ?? ""} placeholder="Nombre del área" required className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
        <input name="descripcion" defaultValue={area?.descripcion ?? ""} placeholder="Descripción" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
        <input name="orden" type="number" defaultValue={area?.orden ?? 0} placeholder="Orden" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
      </div>

      {esAdmin && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-neutral-700 mb-1">
            Qué pantallas del sistema puede usar quien esté en esta área
          </p>
          <p className="text-[11px] text-neutral-400 mb-2">
            Cualquier persona con este área asignada en Organización va a poder ver estas pantallas al loguearse — a
            menos que su usuario tenga otras Áreas puestas a mano como excepción.
          </p>
          <div className="space-y-3">
            {GRUPOS_PANTALLAS.map((grupo) => {
              const items = PANTALLAS_DISPONIBLES.filter((p) => p.grupo === grupo);
              const completo = items.every((p) => pantallas.includes(p.clave));
              return (
                <div key={grupo} className="bg-neutral-50 border border-neutral-200 rounded-lg p-2.5">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-neutral-700 mb-1.5 cursor-pointer">
                    <input type="checkbox" checked={completo} onChange={() => toggleGrupo(grupo)} />
                    {grupo} <span className="font-normal text-neutral-400">(marcar todo)</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pl-1">
                    {items.map((p) => (
                      <label key={p.clave} className="flex items-center gap-1.5 text-sm bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 cursor-pointer">
                        <input type="checkbox" checked={pantallas.includes(p.clave)} onChange={() => toggle(p.clave)} />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button type="submit" disabled={guardando} className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50">
        {guardando ? "Guardando..." : area ? "Guardar cambios" : "Crear área"}
      </button>
    </form>
  );
}

// ===================== PUESTOS =====================

function TabPuestos({ puestos, areas, onCambio }: { puestos: Puesto[]; areas: Area[]; onCambio: () => void }) {
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const areaPorId = new Map(areas.map((a) => [a.id_area, a.nombre]));

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setCreando((v) => !v)} className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium">
          {creando ? "Cancelar" : "+ Nuevo puesto"}
        </button>
      </div>
      {creando && <FormPuesto areas={areas} onGuardado={() => { setCreando(false); onCambio(); }} />}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        {puestos.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-10">Todavía no creaste ningún puesto.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="p-3">Puesto</th>
                <th className="p-3">Área</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Nivel</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {puestos.map((p) => (
                <Fragment key={p.id_puesto}>
                  <tr className="border-b border-neutral-100 last:border-0">
                    <td className="p-3 font-medium text-neutral-900">{p.nombre}</td>
                    <td className="p-3 text-neutral-500">{areaPorId.get(p.id_area) ?? "—"}</td>
                    <td className="p-3">
                      <span className={`text-xs rounded-full px-2 py-0.5 ${p.tipo === "INTERNO" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {p.tipo}
                      </span>
                    </td>
                    <td className="p-3 text-neutral-500">{p.nivel}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => setEditando(editando === p.id_puesto ? null : p.id_puesto)} className="text-sm text-accent hover:underline mr-3">
                        Editar
                      </button>
                      <button onClick={() => cambiarEstadoPuesto(p.id_puesto, "INACTIVO").then(onCambio)} className="text-sm text-red-500 hover:text-red-700">
                        Desactivar
                      </button>
                    </td>
                  </tr>
                  {editando === p.id_puesto && (
                    <tr>
                      <td colSpan={5} className="bg-neutral-50 p-4">
                        <FormPuesto puesto={p} areas={areas} onGuardado={() => { setEditando(null); onCambio(); }} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FormPuesto({ puesto, areas, onGuardado }: { puesto?: Puesto; areas: Area[]; onGuardado: () => void }) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setGuardando(true);
    (puesto ? actualizarPuesto(puesto.id_puesto, formData) : crearPuesto(formData))
      .then((res) => {
        if (res.error) setError(res.error);
        else onGuardado();
      })
      .finally(() => setGuardando(false));
  }

  return (
    <form onSubmit={handleSubmit} className={puesto ? "" : "bg-white border border-neutral-200 rounded-xl p-4 mb-3"}>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      <div className="grid grid-cols-4 gap-2 mb-2">
        <input name="nombre" defaultValue={puesto?.nombre ?? ""} placeholder="Nombre del puesto" required className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm col-span-2" />
        <select name="id_area" defaultValue={puesto?.id_area ?? areas[0]?.id_area ?? ""} required className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm bg-white">
          {areas.map((a) => (
            <option key={a.id_area} value={a.id_area}>
              {a.nombre}
            </option>
          ))}
        </select>
        <select name="tipo" defaultValue={puesto?.tipo ?? "INTERNO"} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm bg-white">
          <option value="INTERNO">Interno</option>
          <option value="EXTERNO">Externo</option>
        </select>
        <input name="nivel" type="number" min={1} defaultValue={puesto?.nivel ?? 1} placeholder="Nivel" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
      </div>
      <button type="submit" disabled={guardando} className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50">
        {guardando ? "Guardando..." : puesto ? "Guardar cambios" : "Crear puesto"}
      </button>
    </form>
  );
}

// ===================== ORGANIGRAMA =====================

function TabOrganigrama({ personas }: { personas: PersonaConPuestos[] }) {
  const idsValidos = new Set(personas.map((p) => p.id_persona));
  const raices = personas.filter((p) => !p.reporta_a || !idsValidos.has(p.reporta_a));
  const hijosDe = (idPersona: string) => personas.filter((p) => p.reporta_a === idPersona);

  if (personas.length === 0) {
    return <p className="text-sm text-neutral-400 text-center py-12">Cargá personas para que se arme el organigrama.</p>;
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-6 overflow-x-auto">
      <div className="flex flex-col items-center gap-6 min-w-max mx-auto">
        {raices.map((r) => (
          <NodoOrganigrama key={r.id_persona} persona={r} hijosDe={hijosDe} nivel={0} />
        ))}
      </div>
    </div>
  );
}

function NodoOrganigrama({
  persona,
  hijosDe,
  nivel,
}: {
  persona: PersonaConPuestos;
  hijosDe: (id: string) => PersonaConPuestos[];
  nivel: number;
}) {
  const hijos = hijosDe(persona.id_persona);
  const puestosTexto = persona.asignaciones.map((a) => a.nombrePuesto).join(" · ") || "Sin puesto asignado";

  return (
    <div className="flex flex-col items-center">
      <div className={`border-2 rounded-xl px-4 py-2.5 text-center min-w-[160px] flex flex-col items-center gap-1.5 ${nivel === 0 ? "border-accent bg-accent-tint" : "border-neutral-200 bg-white"}`}>
        <Avatar nombre={persona.nombre} apellido={persona.apellido} fotoUrl={persona.foto_url} />
        <p className="text-sm font-bold text-neutral-900">
          {persona.nombre} {persona.apellido ?? ""}
        </p>
        <p className="text-[11px] text-neutral-500">{puestosTexto}</p>
      </div>
      {hijos.length > 0 && (
        <>
          <div className="w-px h-4 bg-neutral-300" />
          <div className="flex gap-6">
            {hijos.map((h) => (
              <NodoOrganigrama key={h.id_persona} persona={h} hijosDe={hijosDe} nivel={nivel + 1} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
