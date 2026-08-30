"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { obtenerSesionConPantallas, puedeVerPantalla } from "@/lib/roles";
import { obtenerSesionConPermisos, tienePermiso, PERMISOS } from "@/lib/permisos";
import { PANTALLAS_DISPONIBLES } from "@/lib/pantallas";

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

// Igual que Situación de marca: lo puede tocar el Dueño o cualquiera cuya
// Área (o persona vinculada) incluya la pantalla "organizacion".
async function requireAcceso() {
  const sesion = await obtenerSesionConPantallas();
  if (!puedeVerPantalla(sesion, "organizacion")) return "No tenés permiso para hacer esto.";
  return null;
}

// Los horarios de trabajo se gestionan desde RR.HH. (permiso puntual
// GESTIONAR_NOMINA, igual que Nómina y Presentismo), no desde la pantalla
// "organizacion" — por eso llevan su propio chequeo.
async function requireAccesoRrhh() {
  const sesion = await obtenerSesionConPermisos();
  if (!tienePermiso(sesion, PERMISOS.GESTIONAR_NOMINA)) return "No tenés permiso para hacer esto.";
  return null;
}

// Qué pantallas ve cada Área es, en el fondo, un control de acceso — solo
// el Dueño lo puede tocar, para que nadie se otorgue más acceso a sí mismo
// editando su propia área.
async function esDueño() {
  const sesion = await obtenerSesionConPantallas();
  return sesion?.rol === "admin";
}

function pantallasValidas(pantallas: string[]) {
  const claves = new Set(PANTALLAS_DISPONIBLES.map((p) => p.clave));
  return pantallas.filter((p) => claves.has(p));
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
  const datos: Record<string, unknown> = {
    nombre,
    descripcion: text(formData, "descripcion"),
    orden: number(formData, "orden") ?? 0,
    estado: "ACTIVA",
  };
  if (await esDueño()) datos.pantallas = pantallasValidas(formData.getAll("pantallas") as string[]);

  const { error } = await supabase.from("areas").insert(datos);
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
  const datos: Record<string, unknown> = { nombre, descripcion: text(formData, "descripcion"), orden: number(formData, "orden") ?? 0 };
  if (await esDueño()) datos.pantallas = pantallasValidas(formData.getAll("pantallas") as string[]);

  const { error } = await supabase.from("areas").update(datos).eq("id_area", idArea);
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
  foto_url: string | null;
  estado: string;
  fecha_alta: string;
  dni: string | null;
  cuil: string | null;
  fecha_nacimiento: string | null;
  domicilio: string | null;
  fecha_ingreso: string | null;
  convenio_colectivo: string | null;
  id_horario: string | null;
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
        id_horario: text(formData, "id_horario"),
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
        id_horario: text(formData, "id_horario"),
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

// La foto de perfil va en un bucket público (a diferencia de los
// comprobantes, que son privados) — se muestra todo el tiempo en tablas y
// en el organigrama, no tiene sentido pedirle una URL firmada cada vez.
export async function subirFotoPersona(idPersona: string, formData: FormData): Promise<{ error: string | null; url?: string }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const archivo = formData.get("archivo") as File | null;
  if (!archivo || archivo.size === 0) return { error: "Elegí una foto primero" };

  try {
    const supabase = getSupabaseServerClient();
    const extension = archivo.name.split(".").pop() ?? "jpg";
    const path = `${idPersona}-${Date.now()}.${extension}`;

    const { error: errorUpload } = await supabase.storage
      .from("fotos-personas")
      .upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
    if (errorUpload) return { error: errorUpload.message };

    const { data } = supabase.storage.from("fotos-personas").getPublicUrl(path);

    const { error: errorUpdate } = await supabase.from("personas").update({ foto_url: data.publicUrl }).eq("id_persona", idPersona);
    if (errorUpdate) return { error: friendlyDbError(errorUpdate) };

    revalidatePath("/organizacion");
    return { error: null, url: data.publicUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo subir la foto" };
  }
}

// ===================== HORARIOS DE TRABAJO (RR.HH. — Fase 2) =====================
// "Horario de trabajo" a propósito, no "turno": turno ya significa la
// sesión de caja (apertura/cierre con arqueo) en todo el resto del sistema.

export type HorarioTrabajo = {
  id_horario: string;
  nombre: string;
  hora_entrada: string;
  hora_salida: string | null;
  tolerancia_minutos: number;
  dias_semana: number[];
  estado: string;
};

export async function listarHorarios(): Promise<HorarioTrabajo[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("horarios_trabajo").select("*").eq("estado", "ACTIVO").order("nombre");
  if (error) throw new Error(friendlyDbError(error));
  return (data ?? []) as HorarioTrabajo[];
}

function diasDesdeFormData(formData: FormData): number[] {
  const dias = String(formData.get("dias_semana") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n >= 1 && n <= 7);
  return dias.length > 0 ? dias : [1, 2, 3, 4, 5];
}

export async function crearHorario(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAccesoRrhh();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre es obligatorio" };
  const horaEntrada = text(formData, "hora_entrada");
  if (!horaEntrada) return { error: "La hora de entrada es obligatoria" };

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("horarios_trabajo").insert({
      nombre,
      hora_entrada: horaEntrada,
      hora_salida: text(formData, "hora_salida"),
      tolerancia_minutos: number(formData, "tolerancia_minutos") ?? 5,
      dias_semana: diasDesdeFormData(formData),
      estado: "ACTIVO",
    });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/rrhh");
    revalidatePath("/organizacion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el horario" };
  }
}

export async function actualizarHorario(idHorario: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAccesoRrhh();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre es obligatorio" };
  const horaEntrada = text(formData, "hora_entrada");
  if (!horaEntrada) return { error: "La hora de entrada es obligatoria" };

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("horarios_trabajo")
      .update({
        nombre,
        hora_entrada: horaEntrada,
        hora_salida: text(formData, "hora_salida"),
        tolerancia_minutos: number(formData, "tolerancia_minutos") ?? 5,
        dias_semana: diasDesdeFormData(formData),
      })
      .eq("id_horario", idHorario);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/rrhh");
    revalidatePath("/organizacion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar el horario" };
  }
}

export async function desactivarHorario(idHorario: string): Promise<{ error: string | null }> {
  const permisoError = await requireAccesoRrhh();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("horarios_trabajo").update({ estado: "INACTIVO" }).eq("id_horario", idHorario);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/rrhh");
  revalidatePath("/organizacion");
  return { error: null };
}

// ===================== LEGAJO (RR.HH. — Fase 1) =====================

export type DocumentoLegajo = {
  id_documento: string;
  id_persona: string;
  tipo: string;
  nombre_archivo: string;
  path: string;
  usuario: string | null;
  fecha_subida: string;
};

// Datos sensibles del legajo — aparte de la edición rápida de Organización
// (nombre/área/puesto), para no mezclar el día a día con el papeleo legal.
export async function actualizarLegajo(idPersona: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("personas")
      .update({
        dni: text(formData, "dni"),
        cuil: text(formData, "cuil"),
        fecha_nacimiento: text(formData, "fecha_nacimiento"),
        domicilio: text(formData, "domicilio"),
        fecha_ingreso: text(formData, "fecha_ingreso"),
        convenio_colectivo: text(formData, "convenio_colectivo"),
      })
      .eq("id_persona", idPersona);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/organizacion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar el legajo" };
  }
}

export async function listarDocumentosLegajo(idPersona: string): Promise<DocumentoLegajo[]> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("documentos_legajo")
    .select("*")
    .eq("id_persona", idPersona)
    .order("fecha_subida", { ascending: false });
  if (error) throw new Error(friendlyDbError(error));
  return (data ?? []) as DocumentoLegajo[];
}

// Bucket privado (a diferencia de la foto de perfil): DNI, apto médico, CBU
// y contrato son datos sensibles, no algo para mostrar en pantallas
// públicas — se accede siempre con URL firmada, nunca URL pública.
export async function subirDocumentoLegajo(idPersona: string, tipo: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  const archivo = formData.get("archivo") as File | null;
  if (!archivo || archivo.size === 0) return { error: "Elegí un archivo primero" };

  try {
    const supabase = getSupabaseServerClient();
    const sesion = await obtenerSesionConPantallas();
    const extension = archivo.name.split(".").pop() ?? "pdf";
    const path = `${idPersona}/${tipo}-${Date.now()}.${extension}`;

    const { error: errorUpload } = await supabase.storage
      .from("documentos-legajo")
      .upload(path, archivo, { contentType: archivo.type || undefined });
    if (errorUpload) return { error: errorUpload.message };

    const { error } = await supabase.from("documentos_legajo").insert({
      id_persona: idPersona,
      tipo,
      nombre_archivo: archivo.name,
      path,
      usuario: sesion?.nombre ?? null,
    });
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/organizacion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo subir el documento" };
  }
}

export async function obtenerUrlDocumentoLegajo(path: string): Promise<string> {
  const permisoError = await requireAcceso();
  if (permisoError) throw new Error(permisoError);

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.storage.from("documentos-legajo").createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// Se guarda el historial completo a propósito (ver project RR.HH.) — esto
// es solo para sacar un archivo subido por error, no un reemplazo normal.
export async function eliminarDocumentoLegajo(idDocumento: string, path: string): Promise<{ error: string | null }> {
  const permisoError = await requireAcceso();
  if (permisoError) return { error: permisoError };

  try {
    const supabase = getSupabaseServerClient();
    await supabase.storage.from("documentos-legajo").remove([path]);
    const { error } = await supabase.from("documentos_legajo").delete().eq("id_documento", idDocumento);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/organizacion");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo eliminar el documento" };
  }
}
