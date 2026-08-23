"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";

function text(formData: FormData, name: string) {
  const s = String(formData.get(name) ?? "").trim();
  return s.length ? s : null;
}

function number(formData: FormData, name: string) {
  const raw = formData.get(name);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Igual que Situación de marca: lo puede tocar el Dueño o cualquier Rol
// (Usuarios → Roles) que incluya la pantalla "organizacion".
async function requireAcceso() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "organizacion")) return "No tenés permiso para hacer esto.";
  return null;
}

// ===================== ÁREAS =====================

export async function listarAreas() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("areas").select("*").eq("estado", "ACTIVA").order("orden", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function crearArea(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre del área es obligatorio" };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("areas").insert({
    nombre,
    descripcion: text(formData, "descripcion"),
    orden: number(formData, "orden") ?? 0,
    estado: "ACTIVA",
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}

export async function actualizarArea(idArea: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre del área es obligatorio" };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("areas")
    .update({ nombre, descripcion: text(formData, "descripcion"), orden: number(formData, "orden") ?? 0 })
    .eq("id_area", idArea);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}

export async function cambiarEstadoArea(idArea: string, estado: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("areas").update({ estado }).eq("id_area", idArea);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}

// ===================== PUESTOS =====================

export async function listarPuestos() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("puestos").select("*").eq("estado", "ACTIVO").order("nivel", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function crearPuesto(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  const idArea = text(formData, "id_area");
  if (!nombre) return { error: "El nombre del puesto es obligatorio" };
  if (!idArea) return { error: "Elegí un área" };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("puestos").insert({
    id_area: idArea,
    nombre,
    tipo: text(formData, "tipo") ?? "INTERNO",
    nivel: number(formData, "nivel") ?? 1,
    estado: "ACTIVO",
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}

export async function actualizarPuesto(idPuesto: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  const idArea = text(formData, "id_area");
  if (!nombre) return { error: "El nombre del puesto es obligatorio" };
  if (!idArea) return { error: "Elegí un área" };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("puestos")
    .update({
      id_area: idArea,
      nombre,
      tipo: text(formData, "tipo") ?? "INTERNO",
      nivel: number(formData, "nivel") ?? 1,
    })
    .eq("id_puesto", idPuesto);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}

export async function cambiarEstadoPuesto(idPuesto: string, estado: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("puestos").update({ estado }).eq("id_puesto", idPuesto);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}

// ===================== PERSONAS =====================

export type PersonaConPuestos = {
  id_persona: string;
  nombre: string;
  apellido: string | null;
  email: string | null;
  telefono: string | null;
  tipo: string;
  id_local: string | null;
  reporta_a: string | null;
  estado: string;
  fecha_alta: string;
  asignaciones: { idPuesto: string; nombrePuesto: string; idArea: string; nombreArea: string; esPrincipal: boolean }[];
};

export async function listarPersonas(): Promise<PersonaConPuestos[]> {
  const supabase = getSupabaseServerClient();
  const { data: personas, error } = await supabase
    .from("personas")
    .select("*")
    .eq("estado", "ACTIVO")
    .order("nombre", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));

  const idsPersona = (personas ?? []).map((p) => p.id_persona);
  const { data: asignaciones } = await supabase
    .from("persona_puestos")
    .select("id_persona, id_puesto, es_principal")
    .in("id_persona", idsPersona.length > 0 ? idsPersona : ["00000000-0000-0000-0000-000000000000"]);

  const { data: puestos } = await supabase.from("puestos").select("id_puesto, nombre, id_area");
  const { data: areas } = await supabase.from("areas").select("id_area, nombre");
  const puestoPorId = new Map((puestos ?? []).map((p) => [p.id_puesto, p]));
  const areaPorId = new Map((areas ?? []).map((a) => [a.id_area, a.nombre]));

  const asignacionesPorPersona = new Map<string, PersonaConPuestos["asignaciones"]>();
  for (const a of asignaciones ?? []) {
    const puesto = puestoPorId.get(a.id_puesto);
    if (!puesto) continue;
    const lista = asignacionesPorPersona.get(a.id_persona) ?? [];
    lista.push({
      idPuesto: a.id_puesto,
      nombrePuesto: puesto.nombre,
      idArea: puesto.id_area,
      nombreArea: areaPorId.get(puesto.id_area) ?? "Área",
      esPrincipal: a.es_principal,
    });
    asignacionesPorPersona.set(a.id_persona, lista);
  }

  return (personas ?? []).map((p) => ({
    ...p,
    asignaciones: (asignacionesPorPersona.get(p.id_persona) ?? []).sort((a, b) => (a.esPrincipal ? -1 : b.esPrincipal ? 1 : 0)),
  }));
}

// El array de asignaciones viaja como JSON en el form — más simple que
// intentar mandar filas dinámicas por FormData plano.
type AsignacionInput = { idPuesto: string; esPrincipal: boolean };

async function guardarAsignaciones(idPersona: string, asignaciones: AsignacionInput[]) {
  const supabase = getSupabaseServerClient();
  await supabase.from("persona_puestos").delete().eq("id_persona", idPersona);
  if (asignaciones.length === 0) return;

  // Si ninguna vino marcada como principal, la primera pasa a serlo — nunca
  // queda una persona con puestos pero sin ningún principal.
  const hayPrincipal = asignaciones.some((a) => a.esPrincipal);
  const filas = asignaciones.map((a, i) => ({
    id_persona: idPersona,
    id_puesto: a.idPuesto,
    es_principal: hayPrincipal ? a.esPrincipal : i === 0,
  }));
  const { error } = await supabase.from("persona_puestos").insert(filas);
  if (error) throw new Error(friendlyDbError(error));
}

export async function crearPersona(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre es obligatorio" };

  let asignaciones: AsignacionInput[] = [];
  try {
    asignaciones = JSON.parse(String(formData.get("asignaciones") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer las áreas y puestos" };
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("personas")
      .insert({
        nombre,
        apellido: text(formData, "apellido"),
        email: text(formData, "email"),
        telefono: text(formData, "telefono"),
        tipo: text(formData, "tipo") ?? "EMPLEADO",
        id_local: text(formData, "id_local"),
        reporta_a: text(formData, "reporta_a"),
        estado: "ACTIVO",
      })
      .select("id_persona")
      .single();
    if (error) return { error: friendlyDbError(error) };

    await guardarAsignaciones(data.id_persona, asignaciones);
    revalidatePath("/organizacion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la persona" };
  }
}

export async function actualizarPersona(idPersona: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre es obligatorio" };
  if (text(formData, "reporta_a") === idPersona) return { error: "Una persona no puede reportarse a sí misma" };

  let asignaciones: AsignacionInput[] = [];
  try {
    asignaciones = JSON.parse(String(formData.get("asignaciones") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer las áreas y puestos" };
  }

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("personas")
      .update({
        nombre,
        apellido: text(formData, "apellido"),
        email: text(formData, "email"),
        telefono: text(formData, "telefono"),
        tipo: text(formData, "tipo") ?? "EMPLEADO",
        id_local: text(formData, "id_local"),
        reporta_a: text(formData, "reporta_a"),
      })
      .eq("id_persona", idPersona);
    if (error) return { error: friendlyDbError(error) };

    await guardarAsignaciones(idPersona, asignaciones);
    revalidatePath("/organizacion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar la persona" };
  }
}

export async function cambiarEstadoPersona(idPersona: string, estado: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("personas").update({ estado }).eq("id_persona", idPersona);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/organizacion");
  return { error: null };
}
