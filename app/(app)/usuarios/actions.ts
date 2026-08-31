"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS, PERMISOS_DISPONIBLES } from "@/lib/permisos";

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

export async function actualizarUsuario(id: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  const email = text(formData, "email")?.toLowerCase() ?? null;
  const rol = text(formData, "rol") ?? "operativo";
  if (!nombre) return { error: "El nombre es obligatorio" };
  if (!email) return { error: "El email es obligatorio" };

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("usuarios").update({ nombre, email, rol }).eq("id_usuario", id);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/organizacion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar el usuario" };
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
  revalidatePath("/gastos-ingresos");
  return { error: null };
}

// Para empleados que cobran por hora en vez de sueldo fijo — al cerrar su
// nómina, el monto base sale de horas trabajadas (Planilla horaria) × este
// valor, en vez del sueldo_base fijo.
export async function actualizarValorHora(id: string, valorHora: number): Promise<{ error: string | null }> {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) {
    return { error: "No tenés permiso para gestionar la Nómina." };
  }
  if (valorHora < 0) return { error: "El valor hora no puede ser negativo" };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("usuarios").update({ valor_hora: valorHora }).eq("id_usuario", id);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/rrhh");
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

// Las Áreas puestas a mano acá son la excepción manual — pisan lo que le
// tocaría por su Persona vinculada. No existe una entidad "Rol" separada:
// el Área ES lo que se asigna (ver lib/roles.ts).
export async function actualizarAreasAccesoUsuario(idUsuario: string, idsArea: string[]): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("usuarios").update({ areas_acceso: idsArea }).eq("id_usuario", idUsuario);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}

// Vincula este login con una Persona de Organización — así su acceso se
// puede calcular solo, sumando las pantallas de las áreas de esa persona
// (a menos que tenga Áreas puestas a mano como excepción).
export async function actualizarPersonaUsuario(idUsuario: string, idPersona: string | null): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("usuarios").update({ id_persona: idPersona }).eq("id_usuario", idUsuario);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}
