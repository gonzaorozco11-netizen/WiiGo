"use client";

import { Fragment, useState, useTransition } from "react";
import type { Usuario, Rol } from "@/lib/supabase";
import { PERMISOS_DISPONIBLES } from "@/lib/permisos-constantes";
import { PANTALLAS_DISPONIBLES } from "@/lib/pantallas";
import type { PersonaConPuestos } from "@/app/(app)/organizacion/actions";
import {
  crearUsuario,
  actualizarUsuario,
  cambiarEstadoUsuario,
  cambiarPasswordUsuario,
  actualizarPermisosUsuario,
  actualizarRolUsuario,
  actualizarPersonaUsuario,
  crearRol,
  actualizarRol,
  cambiarEstadoRol,
} from "@/app/(app)/usuarios/actions";

type UsuarioSinHash = Omit<Usuario, "password_hash">;

function formatearFecha(fechaISO: string) {
  return new Date(fechaISO).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// "admin" en la base sigue siendo el dueño de siempre (puede todo) — acá
// se muestra como "Dueño" para no confundirlo con el rol configurable
// "Administración" que Gonzalo arma en la pestaña Roles.
function etiquetaRolBase(rol: string | null) {
  if (rol === "admin") return "Dueño";
  return "Operativo";
}

export default function UsuariosApp({
  usuarios,
  roles,
  personas,
}: {
  usuarios: UsuarioSinHash[];
  roles: Rol[];
  personas: PersonaConPuestos[];
}) {
  const [tab, setTab] = useState<"usuarios" | "roles">("usuarios");
  const [modalOpen, setModalOpen] = useState(false);
  const [editando, setEditando] = useState<UsuarioSinHash | null>(null);
  const [cambiandoPassword, setCambiandoPassword] = useState<UsuarioSinHash | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const rolPorId = new Map(roles.map((r) => [r.id_rol, r]));

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Usuarios</h1>
          <p className="text-sm text-neutral-500">
            Cada empleado necesita su propio login para que las ventas y los turnos de caja queden registrados a su
            nombre.
          </p>
        </div>
        {tab === "usuarios" && (
          <button
            onClick={() => setModalOpen(true)}
            className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium whitespace-nowrap"
          >
            + Nuevo usuario
          </button>
        )}
      </div>

      <div className="inline-flex gap-1 bg-neutral-100 rounded-lg p-1 mb-4">
        <button
          onClick={() => setTab("usuarios")}
          className={`text-xs font-bold px-3 py-1.5 rounded-md ${tab === "usuarios" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"}`}
        >
          Usuarios
        </button>
        <button
          onClick={() => setTab("roles")}
          className={`text-xs font-bold px-3 py-1.5 rounded-md ${tab === "roles" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"}`}
        >
          Roles
        </button>
      </div>

      {tab === "usuarios" ? (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          {usuarios.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-10">Todavía no hay usuarios cargados.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="p-3">Nombre</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Rol</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Alta</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <Fragment key={u.id_usuario}>
                    <tr className="border-b border-neutral-100 last:border-0">
                      <td className="p-3 font-medium text-neutral-900">{u.nombre}</td>
                      <td className="p-3 text-neutral-500">{u.email}</td>
                      <td className="p-3">
                        <span className="text-xs bg-neutral-100 text-neutral-600 rounded-full px-2 py-0.5">
                          {etiquetaRolBase(u.rol)}
                          {u.rol !== "admin" && u.id_rol && rolPorId.get(u.id_rol) && ` · ${rolPorId.get(u.id_rol)!.nombre}`}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`text-xs rounded-full px-2 py-0.5 ${
                            u.estado === "ACTIVO" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"
                          }`}
                        >
                          {u.estado}
                        </span>
                      </td>
                      <td className="p-3 text-neutral-400">{formatearFecha(u.fecha_alta)}</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => setExpandido(expandido === u.id_usuario ? null : u.id_usuario)}
                          className="text-sm text-accent hover:underline mr-3"
                        >
                          Permisos
                        </button>
                        <button onClick={() => setEditando(u)} className="text-sm text-accent hover:underline mr-3">
                          Editar
                        </button>
                        <FilaAcciones usuario={u} onCambiarPassword={() => setCambiandoPassword(u)} />
                      </td>
                    </tr>
                    {expandido === u.id_usuario && (
                      <tr className="border-b border-neutral-100 last:border-0">
                        <td colSpan={6} className="bg-neutral-50 p-0">
                          <FilaPermisos usuario={u} roles={roles} personas={personas} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <TabRoles roles={roles} />
      )}

      {modalOpen && <NuevoUsuarioModal onClose={() => setModalOpen(false)} />}
      {editando && <EditarUsuarioModal usuario={editando} onClose={() => setEditando(null)} />}
      {cambiandoPassword && (
        <CambiarPasswordModal usuario={cambiandoPassword} onClose={() => setCambiandoPassword(null)} />
      )}
    </div>
  );
}

function FilaAcciones({ usuario, onCambiarPassword }: { usuario: UsuarioSinHash; onCambiarPassword: () => void }) {
  const [isPending, startTransition] = useTransition();

  function toggleEstado() {
    const nuevoEstado = usuario.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO";
    startTransition(async () => {
      try {
        const res = await cambiarEstadoUsuario(usuario.id_usuario, nuevoEstado);
        if (res.error) alert(res.error);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <>
      <button onClick={onCambiarPassword} className="text-sm text-neutral-500 hover:text-neutral-900 mr-3">
        Cambiar contraseña
      </button>
      <button onClick={toggleEstado} disabled={isPending} className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50">
        {usuario.estado === "ACTIVO" ? "Desactivar" : "Activar"}
      </button>
    </>
  );
}

function FilaPermisos({ usuario, roles, personas }: { usuario: UsuarioSinHash; roles: Rol[]; personas: PersonaConPuestos[] }) {
  const [permisos, setPermisos] = useState<string[]>(usuario.permisos ?? []);
  const [isPending, startTransition] = useTransition();
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (usuario.rol === "admin") {
    return (
      <p className="text-sm text-neutral-500 px-4 py-4">
        {usuario.nombre} es Dueño — tiene todos los permisos siempre, no hace falta tildar nada.
      </p>
    );
  }

  function toggle(clave: string) {
    setGuardado(false);
    setPermisos((prev) => (prev.includes(clave) ? prev.filter((p) => p !== clave) : [...prev, clave]));
  }

  function handleGuardar() {
    setError(null);
    startTransition(async () => {
      const res = await actualizarPermisosUsuario(usuario.id_usuario, permisos);
      if (res.error) setError(res.error);
      else setGuardado(true);
    });
  }

  return (
    <div className="px-4 py-4">
      <SelectorPersonaVinculada usuario={usuario} personas={personas} />
      <SelectorRolAcceso usuario={usuario} roles={roles} />

      <p className="text-xs text-neutral-500 mb-3">
        Permisos puntuales para {usuario.nombre} — se aplican al toque, no hace falta que reloguee.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        {PERMISOS_DISPONIBLES.map((p) => (
          <label key={p.clave} className="flex items-start gap-2 bg-white border border-neutral-200 rounded-lg px-3 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={permisos.includes(p.clave)}
              onChange={() => toggle(p.clave)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-neutral-800">{p.label}</span>
              <span className="block text-xs text-neutral-400">{p.descripcion}</span>
            </span>
          </label>
        ))}
      </div>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {guardado && <p className="text-sm text-emerald-600 mb-2">Permisos guardados.</p>}
      <button
        onClick={handleGuardar}
        disabled={isPending}
        className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {isPending ? "Guardando..." : "Guardar permisos"}
      </button>
    </div>
  );
}

// Qué pantallas del menú puede ver este operativo — si no tiene ningún rol
// asignado, sigue viendo todo (igual que siempre), para no romper a nadie
// que ya estaba cargado antes de que existiera esto.
function SelectorRolAcceso({ usuario, roles }: { usuario: UsuarioSinHash; roles: Rol[] }) {
  const [idRol, setIdRol] = useState(usuario.id_rol ?? "");
  const [isPending, startTransition] = useTransition();
  const [guardado, setGuardado] = useState(false);

  function handleChange(valor: string) {
    setIdRol(valor);
    setGuardado(false);
    startTransition(async () => {
      await actualizarRolUsuario(usuario.id_usuario, valor || null);
      setGuardado(true);
    });
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-lg px-3 py-3 mb-3">
      <label className="block text-xs font-medium text-neutral-600 mb-1">Rol de acceso (qué pantallas puede ver)</label>
      <select
        value={idRol}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isPending}
        className="w-full sm:w-64 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
      >
        <option value="">{usuario.id_persona ? "Sin excepción — sigue el área de su persona" : "Sin restricción — ve todo el menú"}</option>
        {roles.map((r) => (
          <option key={r.id_rol} value={r.id_rol}>
            {r.nombre}
          </option>
        ))}
      </select>
      {guardado && <span className="text-xs text-emerald-600 ml-2">Guardado.</span>}
      {roles.length === 0 && (
        <p className="text-xs text-neutral-400 mt-1.5">Todavía no creaste ningún rol — hacelo en la pestaña "Roles".</p>
      )}
      <p className="text-[11px] text-neutral-400 mt-1.5">Un Rol acá puesto a mano es una excepción — pisa lo que le tocaría por su área.</p>
    </div>
  );
}

// Sin persona vinculada, el acceso depende solo del Rol de arriba (o queda
// sin restricción, igual que siempre). Con una persona vinculada, si no hay
// Rol manual, el acceso se calcula solo de las áreas de esa persona.
function SelectorPersonaVinculada({ usuario, personas }: { usuario: UsuarioSinHash; personas: PersonaConPuestos[] }) {
  const [idPersona, setIdPersona] = useState(usuario.id_persona ?? "");
  const [isPending, startTransition] = useTransition();
  const [guardado, setGuardado] = useState(false);
  const persona = personas.find((p) => p.id_persona === idPersona);

  function handleChange(valor: string) {
    setIdPersona(valor);
    setGuardado(false);
    startTransition(async () => {
      await actualizarPersonaUsuario(usuario.id_usuario, valor || null);
      setGuardado(true);
    });
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-lg px-3 py-3 mb-3">
      <label className="block text-xs font-medium text-neutral-600 mb-1">Persona de Organización vinculada</label>
      <select
        value={idPersona}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isPending}
        className="w-full sm:w-64 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
      >
        <option value="">Sin vincular</option>
        {personas.map((p) => (
          <option key={p.id_persona} value={p.id_persona}>
            {p.nombre} {p.apellido ?? ""}
          </option>
        ))}
      </select>
      {guardado && <span className="text-xs text-emerald-600 ml-2">Guardado.</span>}
      {persona && persona.asignaciones.length > 0 && (
        <p className="text-[11px] text-neutral-400 mt-1.5">
          Áreas de {persona.nombre}: {[...new Set(persona.asignaciones.map((a) => a.nombreArea))].join(", ")}
        </p>
      )}
    </div>
  );
}

function TabRoles({ roles }: { roles: Rol[] }) {
  const [creando, setCreando] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setCreando((v) => !v)}
          className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium"
        >
          {creando ? "Cancelar" : "+ Nuevo rol"}
        </button>
      </div>

      {creando && <FormRol onGuardado={() => setCreando(false)} />}

      {roles.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-10 bg-white border border-neutral-200 rounded-xl">
          Todavía no creaste ningún rol.
        </p>
      ) : (
        <div className="space-y-2">
          {roles.map((r) => (
            <div key={r.id_rol} className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandido(expandido === r.id_rol ? null : r.id_rol)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div>
                  <span className="font-semibold text-neutral-900 text-sm">{r.nombre}</span>
                  <span className="ml-3 text-xs text-neutral-400">{r.pantallas.length} pantallas habilitadas</span>
                </div>
                <span className="text-neutral-400 text-xs">{expandido === r.id_rol ? "▾" : "▸"}</span>
              </button>
              {expandido === r.id_rol && (
                <div className="px-4 pb-4 border-t border-neutral-100 pt-3">
                  <FormRol rol={r} onGuardado={() => setExpandido(null)} />
                  <button
                    onClick={() => cambiarEstadoRol(r.id_rol, "INACTIVO")}
                    className="text-xs text-red-500 hover:text-red-700 mt-2"
                  >
                    Desactivar rol
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const GRUPOS_PANTALLAS = [...new Set(PANTALLAS_DISPONIBLES.map((p) => p.grupo))];

function FormRol({ rol, onGuardado }: { rol?: Rol; onGuardado: () => void }) {
  const [nombre, setNombre] = useState(rol?.nombre ?? "");
  const [pantallas, setPantallas] = useState<string[]>(rol?.pantallas ?? []);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(clave: string) {
    setPantallas((prev) => (prev.includes(clave) ? prev.filter((p) => p !== clave) : [...prev, clave]));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("nombre", nombre);
    pantallas.forEach((p) => formData.append("pantallas", p));
    startTransition(async () => {
      const res = rol ? await actualizarRol(rol.id_rol, formData) : await crearRol(formData);
      if (res.error) setError(res.error);
      else onGuardado();
    });
  }

  return (
    <form onSubmit={handleSubmit} className={rol ? "" : "bg-white border border-neutral-200 rounded-xl p-4 mb-3"}>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      <div className="mb-3">
        <label className="block text-xs font-medium text-neutral-600 mb-1">Nombre del rol</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Administración, Encargado de local"
          required
          className="w-full sm:w-72 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
        />
      </div>
      <p className="text-xs font-medium text-neutral-600 mb-2">Qué pantallas puede ver</p>
      <div className="space-y-3 mb-3">
        {GRUPOS_PANTALLAS.map((grupo) => (
          <div key={grupo}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400 mb-1.5">{grupo}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {PANTALLAS_DISPONIBLES.filter((p) => p.grupo === grupo).map((p) => (
                <label key={p.clave} className="flex items-center gap-1.5 text-sm bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 cursor-pointer">
                  <input type="checkbox" checked={pantallas.includes(p.clave)} onChange={() => toggle(p.clave)} />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {isPending ? "Guardando..." : rol ? "Guardar cambios" : "Crear rol"}
      </button>
    </form>
  );
}

function EditarUsuarioModal({ usuario, onClose }: { usuario: UsuarioSinHash; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await actualizarUsuario(usuario.id_usuario, formData);
        if (res.error) setError(res.error);
        else onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Editar usuario</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <form action={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="edit-nombre">
              Nombre
            </label>
            <input
              id="edit-nombre"
              name="nombre"
              defaultValue={usuario.nombre}
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="edit-email">
              Email (para iniciar sesión)
            </label>
            <input
              id="edit-email"
              name="email"
              type="email"
              defaultValue={usuario.email}
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="edit-rol">
              Rol
            </label>
            <select
              id="edit-rol"
              name="rol"
              defaultValue={usuario.rol ?? "operativo"}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="admin">Dueño (acceso total)</option>
              <option value="operativo">Operativo — Rol/Persona se manejan en "Permisos"</option>
            </select>
            <p className="text-xs text-amber-600 mt-1">
              Ojo si te estás editando a vos mismo: si te sacás "Dueño", perdés el acceso total al toque.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NuevoUsuarioModal({ onClose }: { onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await crearUsuario(formData);
        if (res.error) setError(res.error);
        else onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Nuevo usuario</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <form action={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="nombre">
              Nombre
            </label>
            <input
              id="nombre"
              name="nombre"
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="email">
              Email (para iniciar sesión)
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="rol">
              Rol
            </label>
            <select
              id="rol"
              name="rol"
              defaultValue="operativo"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="admin">Dueño (acceso total)</option>
              <option value="operativo">Operativo — le asignás un Rol después</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={6}
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-neutral-400 mt-1">Mínimo 6 caracteres.</p>
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Creando..." : "Crear usuario"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CambiarPasswordModal({ usuario, onClose }: { usuario: UsuarioSinHash; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await cambiarPasswordUsuario(usuario.id_usuario, password);
        if (res.error) setError(res.error);
        else onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo salió mal");
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Cambiar contraseña</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <p className="text-sm text-neutral-500 mb-3">{usuario.nombre}</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Nueva contraseña"
          minLength={6}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {error && (
          <p className="text-sm text-red-600 mb-3" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium text-neutral-700"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || password.length < 6}
            className="flex-1 rounded-lg bg-accent hover:bg-accent-dark text-white py-2 text-sm font-medium disabled:opacity-50"
          >
            {isPending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
