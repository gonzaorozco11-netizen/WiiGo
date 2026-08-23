"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS, PERMISOS_DISPONIBLES } from "@/lib/permisos";
import { PANTALLAS_DISPONIBLES } from "@/lib/pantallas";

function text(formData: FormData, name: string) {
  const s = String(formData.get(name) ?? "").trim();
  return s.length ? s : null;
}

// Gestión de usuarios (altas, bajas, contraseñas) es solo para admin —
// un operativo de local no puede crear ni tocar cuentas de otros.
async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (sesion?.rol !== "admin") return "No tenés permiso para hacer esto — hace falta ser administrador.";
  return null;
}

// Next.js redacta en producción el mensaje de un Error tirado desde una
// Server Action (queda solo un digest genérico en el navegador) — por eso
// estas funciones no throwean para errores esperables: devuelven { error }.
export async function crearUsuario(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  const email = text(formData, "email")?.toLowerCase() ?? null;
  const rol = text(formData, "rol") ?? "operativo";
  const password = String(formData.get("password") ?? "");

  if (!nombre) return { error: "El nombre es obligatorio" };
  if (!email) return { error: "El email es obligatorio" };
  if (password.length < 6) return { error: "La contraseña tiene que tener al menos 6 caracteres" };

  try {
    const supabase = getSupabaseServerClient();
    const password_hash = await hashPassword(password);

    const { error } = await supabase.from("usuarios").insert({
      nombre,
      email,
      rol,
      password_hash,
      estado: "ACTIVO",
    });
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/organizacion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el usuario" };
  }
}

export async function cambiarEstadoUsuario(id: string, estado: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("usuarios").update({ estado }).eq("id_usuario", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/organizacion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cambiar el estado del usuario" };
  }
}

export async function cambiarPasswordUsuario(id: string, password: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  if (password.length < 6) return { error: "La contraseña tiene que tener al menos 6 caracteres" };
  try {
    const supabase = getSupabaseServerClient();
    const password_hash = await hashPassword(password);
    const { error } = await supabase.from("usuarios").update({ password_hash }).eq("id_usuario", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/organizacion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo cambiar la contraseña" };
  }
}

// Usado desde la pestaña Nómina de Gastos para calcular sueldo base −
// adelantos del mes. No exige ser admin puro — alcanza con el permiso
// "Gestionar Nómina" que un admin le puede tildar a un operativo puntual.
export async function actualizarSueldoBase(id: string, sueldoBase: number): Promise<{ error: string | null }> {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) {
    return { error: "No tenés permiso para gestionar la Nómina." };
  }
  if (sueldoBase < 0) return { error: "El sueldo no puede ser negativo" };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("usuarios").update({ sueldo_base: sueldoBase }).eq("id_usuario", id);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/gastos");
  return { error: null };
}

// Solo admin puede tildar permisos — delegar quién puede repartir permisos
// sería un agujero de seguridad (un operativo se podría auto-otorgar todo).
export async function actualizarPermisosUsuario(id: string, permisos: string[]): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const clavesValidas = new Set(PERMISOS_DISPONIBLES.map((p) => p.clave));
  const permisosLimpios = permisos.filter((p) => clavesValidas.has(p as (typeof PERMISOS_DISPONIBLES)[number]["clave"]));

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("usuarios").update({ permisos: permisosLimpios }).eq("id_usuario", id);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}

// ===================== ROLES (Fase 7) =====================
// Un rol define qué pantallas puede ver un usuario "operativo" (Dueño =
// rol admin sigue viendo todo siempre, no pasa por acá). Se guarda como un
// registro versionable a futuro, pero por ahora es simple: nombre + lista
// de pantallas — ver lib/pantallas.ts para el catálogo completo.

export async function listarRoles() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("roles").select("*").eq("estado", "ACTIVO").order("nombre");
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

function pantallasValidas(pantallas: string[]) {
  const claves = new Set(PANTALLAS_DISPONIBLES.map((p) => p.clave));
  return pantallas.filter((p) => claves.has(p));
}

export async function crearRol(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre del rol es obligatorio" };
  const pantallas = pantallasValidas(formData.getAll("pantallas") as string[]);

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("roles").insert({ nombre, pantallas, estado: "ACTIVO" });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}

export async function actualizarRol(idRol: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre del rol es obligatorio" };
  const pantallas = pantallasValidas(formData.getAll("pantallas") as string[]);

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("roles").update({ nombre, pantallas }).eq("id_rol", idRol);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}

export async function cambiarEstadoRol(idRol: string, estado: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("roles").update({ estado }).eq("id_rol", idRol);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}

// Asigna (o saca, con idRol null) el rol de acceso de un usuario operativo.
export async function actualizarRolUsuario(idUsuario: string, idRol: string | null): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("usuarios").update({ id_rol: idRol }).eq("id_usuario", idUsuario);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}
