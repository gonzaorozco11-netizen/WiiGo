"use client";

import { Fragment, useState, useTransition } from "react";
import type { Usuario } from "@/lib/supabase";
import { PERMISOS_DISPONIBLES } from "@/lib/permisos";
import {
  crearUsuario,
  cambiarEstadoUsuario,
  cambiarPasswordUsuario,
  actualizarPermisosUsuario,
} from "@/app/(app)/usuarios/actions";

type UsuarioSinHash = Omit<Usuario, "password_hash">;

function formatearFecha(fechaISO: string) {
  return new Date(fechaISO).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function UsuariosApp({ usuarios }: { usuarios: UsuarioSinHash[] }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [cambiandoPassword, setCambiandoPassword] = useState<UsuarioSinHash | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);

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
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-lg bg-accent hover:bg-accent-dark text-white px-4 py-2 text-sm font-medium whitespace-nowrap"
        >
          + Nuevo usuario
        </button>
      </div>

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
                        {u.rol ?? "—"}
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
                      <FilaAcciones usuario={u} onCambiarPassword={() => setCambiandoPassword(u)} />
                    </td>
                  </tr>
                  {expandido === u.id_usuario && (
                    <tr className="border-b border-neutral-100 last:border-0">
                      <td colSpan={6} className="bg-neutral-50 p-0">
                        <FilaPermisos usuario={u} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && <NuevoUsuarioModal onClose={() => setModalOpen(false)} />}
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

function FilaPermisos({ usuario }: { usuario: UsuarioSinHash }) {
  const [permisos, setPermisos] = useState<string[]>(usuario.permisos ?? []);
  const [isPending, startTransition] = useTransition();
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (usuario.rol === "admin") {
    return (
      <p className="text-sm text-neutral-500 px-4 py-4">
        {usuario.nombre} es administrador — tiene todos los permisos siempre, no hace falta tildar nada.
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
              <option value="admin">Administración</option>
              <option value="operativo">Operativo de local</option>
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
