"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient, type Consultorio } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { esRolInterno } from "@/lib/rolesInternos";
import { saldosPorMarca } from "@/lib/canjesProfesionales";
import {
  aplicarCambioProfesional,
  CAMPOS_DATOS,
  QUE_HIZO,
  type CampoDatos,
  type TipoCambio,
  type ItemFormacion,
  type ItemTrayectoria,
  type ItemVideo,
  type ItemFortaleza,
} from "@/lib/cambiosProfesional";
import { reglasProfesionales, PARAM_OBJETIVO_SEMANAL, PARAM_PACIENTES_DESTACADA } from "@/lib/semanaProfesional";
import { fechaHoraArgentina } from "@/lib/horarios";
import type { SupabaseClient } from "@supabase/supabase-js";

async function usuarioActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  return session?.nombre ?? null;
}

// Alta/baja de profesionales, PIN, % de comisión por marca y pagos/canjes
// manuales mueven plata o credenciales de acceso — solo admin, igual que
// Usuarios. Un operativo de local no puede tocar nada de esto.
async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (sesion?.rol !== "admin") return "No tenés permiso para hacer esto — hace falta ser administrador.";
  return null;
}

// Las lecturas traen DNI, teléfono y plata de los profesionales. Las server
// actions se pueden llamar desde cualquier sesión, así que ni una marca ni
// una profesional (que vería los datos de las demás) tienen que poder pedirlas.
async function requireInterno() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (!sesion || !esRolInterno(sesion.rol)) throw new Error("No tenés permiso para ver profesionales.");
}

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

function bool(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

// Sin esto, la primera vez que se le vendía algo a una profesional antes de
// cargarla en Profesionales, POS le creaba sola un cliente genérico
// "Cliente WiiGo" con su DNI (ver venderPos en pos/actions.ts). Después, al
// cargarla como profesional de verdad, ese DNI quedaba "ocupado" por un
// cliente con nombre feo y no se podía prolijizar. Esto sincroniza el
// nombre del cliente con el de la profesional (o lo crea si no existía)
// cada vez que se da de alta o se edita una profesional con DNI.
async function sincronizarClientePorDni(supabase: SupabaseClient, dni: string, nombre: string, apellido: string | null) {
  const { data: existente } = await supabase.from("clientes").select("id_cliente").eq("dni", dni).maybeSingle();
  if (existente) {
    await supabase.from("clientes").update({ nombre, apellido }).eq("id_cliente", existente.id_cliente);
  } else {
    await supabase.from("clientes").insert({ nombre, apellido, dni, estado: "ACTIVO" });
  }
}

// ===================== PROFESIONALES =====================

// Nunca se trae pin_hash acá — no hace falta en el cliente y no hay que
// arriesgarse a exponerlo por accidente (mismo criterio que password_hash
// de usuarios).
export async function listarProfesionales() {
  await requireInterno();
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("profesionales")
    .select(
      "id_profesional, nombre, apellido, categoria, titulo, especialidad, bio, biografia_completa, foto, telefono, email, dni, fecha_nacimiento, matricula, tipo_atencion, link_reserva, link_reserva_online, ciudad, precio_presencial, precio_online, estado, publicado, fecha_alta, observaciones"
    )
    .order("nombre", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

// Crea el profesional y, si se completó, su primer código en el mismo paso
// — así de entrada queda listo para usarse. Devuelve el id para abrir su
// ficha y seguir completándola.
export async function crearProfesional(formData: FormData): Promise<{ error: string | null; id?: string }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre es obligatorio" };

  const codigoTexto = text(formData, "codigo")?.toUpperCase() ?? null;
  const dni = text(formData, "dni");

  try {
    const supabase = getSupabaseServerClient();

    if (codigoTexto) {
      const { data: existente } = await supabase
        .from("codigos_profesionales")
        .select("id_codigo")
        .eq("codigo", codigoTexto)
        .maybeSingle();
      if (existente) return { error: `El código "${codigoTexto}" ya está en uso por otro profesional.` };
    }

    if (dni) {
      const { data: existenteDni } = await supabase.from("profesionales").select("id_profesional").eq("dni", dni).maybeSingle();
      if (existenteDni) return { error: `Ya hay un profesional cargado con el DNI ${dni}.` };
    }

    // La columna llega con sql/profesionales-consultorios.sql: solo se manda
    // si eligieron un consultorio, así el alta común anda aunque no se haya corrido.
    const idConsultorio = text(formData, "id_consultorio");

    const { data: profesional, error } = await supabase
      .from("profesionales")
      .insert({
        ...(idConsultorio ? { id_consultorio: idConsultorio } : {}),
        nombre,
        apellido: text(formData, "apellido"),
        categoria: text(formData, "categoria"),
        titulo: text(formData, "titulo"),
        especialidad: text(formData, "especialidad"),
        bio: text(formData, "bio"),
        biografia_completa: text(formData, "biografia_completa"),
        telefono: text(formData, "telefono"),
        email: text(formData, "email"),
        dni,
        fecha_nacimiento: text(formData, "fecha_nacimiento"),
        matricula: text(formData, "matricula"),
        tipo_atencion: text(formData, "tipo_atencion"),
        link_reserva: text(formData, "link_reserva"),
        link_reserva_online: text(formData, "link_reserva_online"),
        ciudad: text(formData, "ciudad"),
        precio_presencial: number(formData, "precio_presencial"),
        precio_online: number(formData, "precio_online"),
        estado: "ACTIVO",
        publicado: bool(formData, "publicado"),
        observaciones: text(formData, "observaciones"),
      })
      .select("id_profesional")
      .single();
    if (error) return { error: friendlyDbError(error) };

    if (dni) {
      await sincronizarClientePorDni(supabase, dni, nombre, text(formData, "apellido"));
    }

    if (codigoTexto) {
      const { error: errorCodigo } = await supabase.from("codigos_profesionales").insert({
        id_profesional: profesional.id_profesional,
        codigo: codigoTexto,
        estado: "ACTIVO",
        fecha_desde: text(formData, "fecha_desde"),
        fecha_hasta: text(formData, "fecha_hasta"),
        limite_usos: number(formData, "limite_usos"),
        usos: 0,
      });
      if (errorCodigo) return { error: friendlyDbError(errorCodigo) };
    }

    revalidatePath("/profesionales");
    return { error: null, id: profesional.id_profesional };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el profesional" };
  }
}

export async function actualizarProfesional(idProfesional: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre es obligatorio" };
  const dni = text(formData, "dni");

  const supabase = getSupabaseServerClient();

  if (dni) {
    const { data: existenteDni } = await supabase
      .from("profesionales")
      .select("id_profesional")
      .eq("dni", dni)
      .neq("id_profesional", idProfesional)
      .maybeSingle();
    if (existenteDni) return { error: `Ya hay otro profesional cargado con el DNI ${dni}.` };
  }

  const { error } = await supabase
    .from("profesionales")
    .update({
      nombre,
      apellido: text(formData, "apellido"),
      categoria: text(formData, "categoria"),
      titulo: text(formData, "titulo"),
      especialidad: text(formData, "especialidad"),
      bio: text(formData, "bio"),
      biografia_completa: text(formData, "biografia_completa"),
      telefono: text(formData, "telefono"),
      email: text(formData, "email"),
      dni,
      fecha_nacimiento: text(formData, "fecha_nacimiento"),
      matricula: text(formData, "matricula"),
      tipo_atencion: text(formData, "tipo_atencion"),
      link_reserva: text(formData, "link_reserva"),
      link_reserva_online: text(formData, "link_reserva_online"),
      ciudad: text(formData, "ciudad"),
      precio_presencial: number(formData, "precio_presencial"),
      precio_online: number(formData, "precio_online"),
      publicado: bool(formData, "publicado"),
      observaciones: text(formData, "observaciones"),
      // Solo viene cuando la pantalla muestra la opción de agenda, que es
      // cuando ya existe la tabla de consultorios.
      ...(formData.has("modo_agenda")
        ? { id_consultorio: formData.get("modo_agenda") === "compartida" ? text(formData, "id_consultorio") : null }
        : {}),
    })
    .eq("id_profesional", idProfesional);
  if (error) return { error: friendlyDbError(error) };

  if (dni) {
    await sincronizarClientePorDni(supabase, dni, nombre, text(formData, "apellido"));
  }

  revalidatePath("/profesionales");
  return { error: null };
}

export async function subirFotoProfesional(
  idProfesional: string,
  formData: FormData
): Promise<{ error: string | null; url?: string }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const archivo = formData.get("archivo") as File | null;
  if (!archivo || archivo.size === 0) return { error: "Elegí una foto primero" };

  try {
    const supabase = getSupabaseServerClient();
    const extension = archivo.name.split(".").pop() ?? "jpg";
    const path = `${idProfesional}-${Date.now()}.${extension}`;

    const { error: errorUpload } = await supabase.storage
      .from("fotos-profesionales")
      .upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
    if (errorUpload) return { error: errorUpload.message };

    const { data } = supabase.storage.from("fotos-profesionales").getPublicUrl(path);

    const { error: errorUpdate } = await supabase
      .from("profesionales")
      .update({ foto: data.publicUrl })
      .eq("id_profesional", idProfesional);
    if (errorUpdate) return { error: friendlyDbError(errorUpdate) };

    revalidatePath("/profesionales");
    return { error: null, url: data.publicUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo subir la foto" };
  }
}

// El PIN habilita que el profesional pague en caja con su propio saldo — se
// guarda encriptado, igual que las contraseñas de usuarios, nunca en texto
// plano. Solo un admin lo puede definir/cambiar.
export async function guardarPinProfesional(idProfesional: string, pin: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  if (!/^\d{4,6}$/.test(pin)) return { error: "El PIN tiene que ser de 4 a 6 números." };
  const supabase = getSupabaseServerClient();
  const pin_hash = await hashPassword(pin);
  const { error } = await supabase.from("profesionales").update({ pin_hash }).eq("id_profesional", idProfesional);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function cambiarEstadoProfesional(idProfesional: string, estado: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("profesionales").update({ estado }).eq("id_profesional", idProfesional);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function cambiarPublicacionProfesional(
  idProfesional: string,
  publicado: boolean
): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("profesionales").update({ publicado }).eq("id_profesional", idProfesional);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

// ===================== CONSULTORIOS (agenda compartida) =====================

// Si todavía no se corrió sql/profesionales-consultorios.sql devuelve
// disponible: false, y la pantalla esconde la opción en vez de romperse.
export async function listarConsultorios(): Promise<{
  disponible: boolean;
  consultorios: Consultorio[];
  miembros: { id_profesional: string; id_consultorio: string }[];
}> {
  await requireInterno();
  const supabase = getSupabaseServerClient();
  const [consultorios, miembros] = await Promise.all([
    supabase.from("consultorios").select("id_consultorio, nombre, link_reserva, link_reserva_online, estado").eq("estado", "ACTIVO").order("nombre"),
    supabase.from("profesionales").select("id_profesional, id_consultorio").not("id_consultorio", "is", null),
  ]);
  if (consultorios.error || miembros.error) return { disponible: false, consultorios: [], miembros: [] };
  return {
    disponible: true,
    consultorios: (consultorios.data ?? []) as Consultorio[],
    miembros: (miembros.data ?? []) as { id_profesional: string; id_consultorio: string }[],
  };
}

// Crea un consultorio o le cambia el nombre y los links. Los links valen para
// todas las que atienden ahí.
export async function guardarConsultorio(datos: {
  idConsultorio?: string | null;
  nombre: string;
  linkReserva: string | null;
  linkReservaOnline: string | null;
}): Promise<{ error: string | null; id?: string }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const nombre = datos.nombre.trim();
  if (!nombre) return { error: "Ponele un nombre al consultorio." };
  const fila = {
    nombre,
    link_reserva: datos.linkReserva?.trim() || null,
    link_reserva_online: datos.linkReservaOnline?.trim() || null,
  };
  const supabase = getSupabaseServerClient();
  if (datos.idConsultorio) {
    const { error } = await supabase.from("consultorios").update(fila).eq("id_consultorio", datos.idConsultorio);
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/profesionales");
    return { error: null, id: datos.idConsultorio };
  }
  const { data, error } = await supabase.from("consultorios").insert(fila).select("id_consultorio").single();
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null, id: data.id_consultorio };
}

// ===================== FORTALEZAS ("¿en qué se destaca?") =====================

export async function listarFortalezas() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("fortalezas_profesional")
    .select("*")
    .eq("estado", "ACTIVA")
    .order("orden", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

// Crea la fortaleza al vuelo desde la ficha del profesional si todavía no
// existe una con ese nombre — mismo criterio que "nueva subcategoría" en
// Productos, para no obligar a pasar por una pantalla aparte.
async function resolveFortaleza(supabase: ReturnType<typeof getSupabaseServerClient>, nombre: string) {
  const normalizado = nombre.trim().toLowerCase();
  const { data: existentes } = await supabase.from("fortalezas_profesional").select("id_fortaleza, nombre").eq("estado", "ACTIVA");
  const existente = (existentes ?? []).find((f: { nombre: string }) => f.nombre.trim().toLowerCase() === normalizado);
  if (existente) return existente.id_fortaleza as string;

  const { data, error } = await supabase
    .from("fortalezas_profesional")
    .insert({ nombre: nombre.trim() })
    .select("id_fortaleza")
    .single();
  if (error) throw new Error(friendlyDbError(error));
  return data.id_fortaleza as string;
}

// Para el listado: qué profesionales ya tienen al menos una fortaleza u
// objetivo cargado, sin tener que hacer una consulta por cada fila.
export async function listarProfesionalesConFortalezas() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("profesional_fortalezas").select("id_profesional");
  if (error) throw new Error(friendlyDbError(error));
  return [...new Set((data ?? []).map((r: { id_profesional: string }) => r.id_profesional))];
}

export async function listarProfesionalesConObjetivos() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("profesional_objetivos").select("id_profesional");
  if (error) throw new Error(friendlyDbError(error));
  return [...new Set((data ?? []).map((r: { id_profesional: string }) => r.id_profesional))];
}

export async function listarFortalezasDeProfesional(idProfesional: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("profesional_fortalezas")
    .select("id_fortaleza, principal")
    .eq("id_profesional", idProfesional);
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

// Reemplaza todo el conjunto de fortalezas del profesional de una — más
// simple que ir agregando/sacando de a una desde una lista de chips.
export async function guardarFortalezasProfesional(
  idProfesional: string,
  seleccion: { nombre: string; principal: boolean }[]
): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  try {
    const supabase = getSupabaseServerClient();
    const filas = await Promise.all(
      seleccion.map(async (s) => ({
        id_profesional: idProfesional,
        id_fortaleza: await resolveFortaleza(supabase, s.nombre),
        principal: s.principal,
      }))
    );

    const { error: errorBorrado } = await supabase.from("profesional_fortalezas").delete().eq("id_profesional", idProfesional);
    if (errorBorrado) return { error: friendlyDbError(errorBorrado) };

    if (filas.length > 0) {
      const { error: errorInsert } = await supabase.from("profesional_fortalezas").insert(filas);
      if (errorInsert) return { error: friendlyDbError(errorInsert) };
    }

    revalidatePath("/profesionales");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudieron guardar las fortalezas" };
  }
}

// ===================== "¿CÓMO PUEDE AYUDARTE?" (objetivos) =====================

export async function listarObjetivosDeProfesional(idProfesional: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("profesional_objetivos")
    .select("id_objetivo")
    .eq("id_profesional", idProfesional);
  if (error) throw new Error(friendlyDbError(error));
  return (data ?? []).map((r: { id_objetivo: string }) => r.id_objetivo);
}

export async function guardarObjetivosProfesional(
  idProfesional: string,
  idsObjetivo: string[]
): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();

  const { error: errorBorrado } = await supabase.from("profesional_objetivos").delete().eq("id_profesional", idProfesional);
  if (errorBorrado) return { error: friendlyDbError(errorBorrado) };

  if (idsObjetivo.length > 0) {
    const { error: errorInsert } = await supabase
      .from("profesional_objetivos")
      .insert(idsObjetivo.map((id_objetivo) => ({ id_profesional: idProfesional, id_objetivo })));
    if (errorInsert) return { error: friendlyDbError(errorInsert) };
  }

  revalidatePath("/profesionales");
  return { error: null };
}

// ===================== FORMACIÓN =====================

export async function listarFormacion(idProfesional: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("formacion_profesional")
    .select("*")
    .eq("id_profesional", idProfesional)
    .order("anio", { ascending: false });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

function formacionFromForm(formData: FormData) {
  return {
    titulo: text(formData, "titulo"),
    institucion: text(formData, "institucion"),
    anio: number(formData, "anio"),
    tipo: text(formData, "tipo"),
    descripcion: text(formData, "descripcion"),
    publico: bool(formData, "publico"),
  };
}

export async function crearFormacion(idProfesional: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const datos = formacionFromForm(formData);
  if (!datos.titulo) return { error: "El título es obligatorio" };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("formacion_profesional").insert({ ...datos, id_profesional: idProfesional });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function actualizarFormacion(idFormacion: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const datos = formacionFromForm(formData);
  if (!datos.titulo) return { error: "El título es obligatorio" };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("formacion_profesional").update(datos).eq("id_formacion", idFormacion);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function eliminarFormacion(idFormacion: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("formacion_profesional").delete().eq("id_formacion", idFormacion);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

// Sube/baja un ítem un lugar dentro de la lista del mismo profesional,
// intercambiando su "orden" con el vecino — lo usan galería, videos,
// trayectoria y filminas. Flechas en vez de arrastrar: más fácil de tocar
// bien en una pantalla táctil chica.
async function reordenar(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  tabla: string,
  columnaId: string,
  idProfesional: string,
  idItem: string,
  direccion: "up" | "down"
) {
  const { data } = await supabase
    .from(tabla)
    .select(`${columnaId}, orden`)
    .eq("id_profesional", idProfesional)
    .order("orden", { ascending: true });
  const filas = (data ?? []) as Record<string, string | number>[];
  const idx = filas.findIndex((f) => f[columnaId] === idItem);
  if (idx === -1) return;
  const posVecino = direccion === "up" ? idx - 1 : idx + 1;
  if (posVecino < 0 || posVecino >= filas.length) return;
  const actual = filas[idx];
  const vecino = filas[posVecino];
  await supabase.from(tabla).update({ orden: vecino.orden }).eq(columnaId, actual[columnaId]);
  await supabase.from(tabla).update({ orden: actual.orden }).eq(columnaId, vecino[columnaId]);
}

async function siguienteOrden(supabase: ReturnType<typeof getSupabaseServerClient>, tabla: string, idProfesional: string) {
  const { data } = await supabase
    .from(tabla)
    .select("orden")
    .eq("id_profesional", idProfesional)
    .order("orden", { ascending: false })
    .limit(1);
  const maximo = (data?.[0] as { orden: number } | undefined)?.orden ?? -1;
  return maximo + 1;
}

// ===================== GALERÍA DE FOTOS =====================

export async function listarGaleria(idProfesional: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("galeria_profesional")
    .select("*")
    .eq("id_profesional", idProfesional)
    .order("orden", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function subirFotoGaleria(idProfesional: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const archivo = formData.get("archivo") as File | null;
  if (!archivo || archivo.size === 0) return { error: "Elegí una foto primero" };

  try {
    const supabase = getSupabaseServerClient();
    const extension = archivo.name.split(".").pop() ?? "jpg";
    const path = `galeria-${idProfesional}-${Date.now()}.${extension}`;

    const { error: errorUpload } = await supabase.storage
      .from("fotos-profesionales")
      .upload(path, archivo, { upsert: true, contentType: archivo.type || undefined });
    if (errorUpload) return { error: errorUpload.message };

    const { data } = supabase.storage.from("fotos-profesionales").getPublicUrl(path);
    const orden = await siguienteOrden(supabase, "galeria_profesional", idProfesional);

    const { error } = await supabase.from("galeria_profesional").insert({
      id_profesional: idProfesional,
      url: data.publicUrl,
      titulo: text(formData, "titulo"),
      descripcion: text(formData, "descripcion"),
      publico: bool(formData, "publico"),
      orden,
    });
    if (error) return { error: friendlyDbError(error) };
    revalidatePath("/profesionales");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo subir la foto" };
  }
}

export async function actualizarFotoGaleria(idFoto: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("galeria_profesional")
    .update({ titulo: text(formData, "titulo"), descripcion: text(formData, "descripcion"), publico: bool(formData, "publico") })
    .eq("id_foto", idFoto);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function eliminarFotoGaleria(idFoto: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("galeria_profesional").delete().eq("id_foto", idFoto);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function reordenarFotoGaleria(idProfesional: string, idFoto: string, direccion: "up" | "down"): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  await reordenar(supabase, "galeria_profesional", "id_foto", idProfesional, idFoto, direccion);
  revalidatePath("/profesionales");
  return { error: null };
}

// ===================== VIDEOS =====================

export async function listarVideos(idProfesional: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("videos_profesional")
    .select("*")
    .eq("id_profesional", idProfesional)
    .order("orden", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function crearVideo(idProfesional: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const titulo = text(formData, "titulo");
  const url = text(formData, "url");
  if (!titulo || !url) return { error: "Título y link son obligatorios" };
  const supabase = getSupabaseServerClient();
  const orden = await siguienteOrden(supabase, "videos_profesional", idProfesional);
  const { error } = await supabase.from("videos_profesional").insert({ id_profesional: idProfesional, titulo, url, orden });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function actualizarVideo(idVideo: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const titulo = text(formData, "titulo");
  const url = text(formData, "url");
  if (!titulo || !url) return { error: "Título y link son obligatorios" };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("videos_profesional").update({ titulo, url }).eq("id_video", idVideo);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function eliminarVideo(idVideo: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("videos_profesional").delete().eq("id_video", idVideo);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

// ===================== TRAYECTORIA =====================

export async function listarTrayectoria(idProfesional: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("trayectoria_profesional")
    .select("*")
    .eq("id_profesional", idProfesional)
    .order("orden", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

function trayectoriaFromForm(formData: FormData) {
  return {
    titulo: text(formData, "titulo"),
    lugar: text(formData, "lugar"),
    anio_desde: number(formData, "anio_desde"),
    anio_hasta: number(formData, "anio_hasta"),
    descripcion: text(formData, "descripcion"),
    publico: bool(formData, "publico"),
  };
}

export async function crearTrayectoria(idProfesional: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const datos = trayectoriaFromForm(formData);
  if (!datos.titulo) return { error: "El título es obligatorio" };
  const supabase = getSupabaseServerClient();
  const orden = await siguienteOrden(supabase, "trayectoria_profesional", idProfesional);
  const { error } = await supabase.from("trayectoria_profesional").insert({ ...datos, id_profesional: idProfesional, orden });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function actualizarTrayectoria(idTrayectoria: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const datos = trayectoriaFromForm(formData);
  if (!datos.titulo) return { error: "El título es obligatorio" };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("trayectoria_profesional").update(datos).eq("id_trayectoria", idTrayectoria);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function eliminarTrayectoria(idTrayectoria: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("trayectoria_profesional").delete().eq("id_trayectoria", idTrayectoria);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

// ===================== CONÓCEME (filminas) =====================

export async function listarFilminas(idProfesional: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("filminas_profesional")
    .select("*")
    .eq("id_profesional", idProfesional)
    .order("orden", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function crearFilmina(idProfesional: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const tipo = text(formData, "tipo");
  if (!tipo) return { error: "Elegí un tipo de filmina" };
  const supabase = getSupabaseServerClient();
  const orden = await siguienteOrden(supabase, "filminas_profesional", idProfesional);
  const { error } = await supabase.from("filminas_profesional").insert({
    id_profesional: idProfesional,
    tipo,
    titulo: text(formData, "titulo"),
    texto: text(formData, "texto"),
    id_foto: text(formData, "id_foto"),
    id_video: text(formData, "id_video"),
    orden,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function actualizarFilmina(idFilmina: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("filminas_profesional")
    .update({
      titulo: text(formData, "titulo"),
      texto: text(formData, "texto"),
      id_foto: text(formData, "id_foto"),
      id_video: text(formData, "id_video"),
    })
    .eq("id_filmina", idFilmina);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function eliminarFilmina(idFilmina: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("filminas_profesional").delete().eq("id_filmina", idFilmina);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function toggleVisibleFilmina(idFilmina: string, visible: boolean): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("filminas_profesional").update({ visible }).eq("id_filmina", idFilmina);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function reordenarFilmina(idProfesional: string, idFilmina: string, direccion: "up" | "down"): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  await reordenar(supabase, "filminas_profesional", "id_filmina", idProfesional, idFilmina, direccion);
  revalidatePath("/profesionales");
  return { error: null };
}

// ===================== CÓDIGOS =====================

export async function listarCodigos() {
  await requireInterno();
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("codigos_profesionales").select("*").order("codigo");
  if (error) throw new Error(friendlyDbError(error));
  return data ?? [];
}

export async function crearCodigoProfesional(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const idProfesional = text(formData, "id_profesional");
  const codigoTexto = text(formData, "codigo")?.toUpperCase();
  if (!idProfesional) return { error: "Elegí a qué profesional pertenece el código" };
  if (!codigoTexto) return { error: "El código es obligatorio" };

  const supabase = getSupabaseServerClient();
  const { data: existente } = await supabase
    .from("codigos_profesionales")
    .select("id_codigo")
    .eq("codigo", codigoTexto)
    .maybeSingle();
  if (existente) return { error: `El código "${codigoTexto}" ya está en uso.` };

  const { error } = await supabase.from("codigos_profesionales").insert({
    id_profesional: idProfesional,
    codigo: codigoTexto,
    estado: "ACTIVO",
    fecha_desde: text(formData, "fecha_desde"),
    fecha_hasta: text(formData, "fecha_hasta"),
    limite_usos: number(formData, "limite_usos"),
    usos: 0,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

export async function cambiarEstadoCodigo(idCodigo: string, estado: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("codigos_profesionales").update({ estado }).eq("id_codigo", idCodigo);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

// ===================== RESUMEN Y REFERIDOS =====================

export type FiltroPeriodo = { desde: string; hasta: string };

// Un profesional por fila, con sus métricas del período — todo calculado acá
// en vez de guardarlo denormalizado, alcanza de sobra a esta escala.
export async function resumenProfesionales(filtro: FiltroPeriodo) {
  await requireInterno();
  const supabase = getSupabaseServerClient();
  const [{ data: profesionales, error }, { data: codigos }, { data: referidos }, { data: movimientos }] = await Promise.all([
    supabase.from("profesionales").select("*").order("nombre"),
    supabase.from("codigos_profesionales").select("id_codigo, id_profesional, codigo, estado"),
    supabase
      .from("referidos_profesionales")
      .select("id_profesional, total_venta, fecha")
      .gte("fecha", `${filtro.desde}T00:00:00`)
      .lte("fecha", `${filtro.hasta}T23:59:59`),
    // "Pagado/canjeado" del período — el saldo pendiente en cambio es
    // siempre el actual (no tiene sentido filtrarlo por fecha).
    supabase
      .from("movimientos_profesional_marca")
      .select("id_profesional, monto, fecha")
      .gte("fecha", `${filtro.desde}T00:00:00`)
      .lte("fecha", `${filtro.hasta}T23:59:59`),
  ]);
  if (error) throw new Error(friendlyDbError(error));

  const codigoPorProfesional = new Map<string, string>();
  for (const c of codigos ?? []) {
    if (c.estado === "ACTIVO" && !codigoPorProfesional.has(c.id_profesional)) codigoPorProfesional.set(c.id_profesional, c.codigo);
  }

  const metricasPorProfesional = new Map<string, { ventas: number; totalVenta: number }>();
  for (const r of referidos ?? []) {
    const m = metricasPorProfesional.get(r.id_profesional) ?? { ventas: 0, totalVenta: 0 };
    m.ventas += 1;
    m.totalVenta += r.total_venta ?? 0;
    metricasPorProfesional.set(r.id_profesional, m);
  }

  const pagadoPorProfesional = new Map<string, number>();
  for (const mov of movimientos ?? []) {
    pagadoPorProfesional.set(mov.id_profesional, (pagadoPorProfesional.get(mov.id_profesional) ?? 0) + (mov.monto ?? 0));
  }

  return Promise.all(
    (profesionales ?? []).map(async (p) => {
      const m = metricasPorProfesional.get(p.id_profesional) ?? { ventas: 0, totalVenta: 0 };
      const saldos = await saldosPorMarca(supabase, p.id_profesional);
      return {
        idProfesional: p.id_profesional as string,
        nombre: `${p.nombre}${p.apellido ? ` ${p.apellido}` : ""}`,
        especialidad: p.especialidad as string | null,
        estado: p.estado as string,
        codigoPrincipal: codigoPorProfesional.get(p.id_profesional) ?? null,
        ventasReferidas: m.ventas,
        totalVenta: m.totalVenta,
        comisionPendiente: saldos.reduce((acc, s) => acc + s.saldo, 0),
        comisionPagada: pagadoPorProfesional.get(p.id_profesional) ?? 0,
      };
    })
  );
}

// El saldo real de un profesional se lleva por marca (los puntos de una
// marca no sirven para otra) — ver lib/canjesProfesionales.ts.
export async function saldosDeProfesional(idProfesional: string) {
  await requireInterno();
  const supabase = getSupabaseServerClient();
  return saldosPorMarca(supabase, idProfesional);
}

// Historial de movimientos (canjes automáticos en caja + pagos/canjes que
// carga un admin a mano) — el más reciente primero.
export async function canjesDeProfesional(idProfesional: string) {
  await requireInterno();
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("movimientos_profesional_marca")
    .select("id_movimiento, id_marca, tipo, monto, id_venta, descripcion, usuario, fecha")
    .eq("id_profesional", idProfesional)
    .order("fecha", { ascending: false })
    .limit(100);
  if (error) throw new Error(friendlyDbError(error));

  const { data: marcas } = await supabase.from("marcas").select("id_marca, nombre");
  const nombrePorMarca = new Map((marcas ?? []).map((m) => [m.id_marca, m.nombre]));

  const idsVenta = [...new Set((data ?? []).map((m) => m.id_venta).filter((v): v is string => !!v))];
  const { data: ventas } = await supabase
    .from("ventas")
    .select("id_venta, numero")
    .in("id_venta", idsVenta.length > 0 ? idsVenta : ["00000000-0000-0000-0000-000000000000"]);
  const numeroPorVenta = new Map((ventas ?? []).map((v) => [v.id_venta, v.numero]));

  return (data ?? []).map((m) => ({
    idMovimiento: m.id_movimiento as string,
    nombreMarca: nombrePorMarca.get(m.id_marca) ?? "Marca",
    tipo: m.tipo as string,
    monto: m.monto as number,
    idVenta: m.id_venta as string | null,
    numeroVenta: m.id_venta ? (numeroPorVenta.get(m.id_venta) ?? null) : null,
    descripcion: m.descripcion as string | null,
    usuario: m.usuario as string | null,
    fecha: m.fecha as string,
  }));
}

// Las ventas donde este profesional fue el referido — es lo que le generó
// saldo (distinto del historial de pagos/canjes, que es lo que ya gastó).
// Sin esto no había forma de ver "la venta de tal día le generó tanto".
export async function ventasGeneradasDeProfesional(idProfesional: string) {
  await requireInterno();
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("referidos_profesionales")
    .select("id_referido, id_venta, total_venta, recompensa_profesional, estado, fecha")
    .eq("id_profesional", idProfesional)
    .order("fecha", { ascending: false })
    .limit(100);
  if (error) throw new Error(friendlyDbError(error));

  const idsVenta = [...new Set((data ?? []).map((r) => r.id_venta).filter((v): v is string => !!v))];
  const { data: ventas } = await supabase
    .from("ventas")
    .select("id_venta, numero")
    .in("id_venta", idsVenta.length > 0 ? idsVenta : ["00000000-0000-0000-0000-000000000000"]);
  const numeroPorVenta = new Map((ventas ?? []).map((v) => [v.id_venta, v.numero]));

  return (data ?? []).map((r) => ({
    idReferido: r.id_referido as string,
    idVenta: r.id_venta as string | null,
    numeroVenta: r.id_venta ? (numeroPorVenta.get(r.id_venta) ?? null) : null,
    totalVenta: r.total_venta as number,
    comisionGenerada: r.recompensa_profesional as number,
    estado: r.estado as string,
    fecha: r.fecha as string,
  }));
}

// Para ver "en qué gastó sus puntos": los productos de esa marca puntual
// dentro de la venta donde se hizo el canje.
export async function detalleCanje(idMovimiento: string) {
  await requireInterno();
  const supabase = getSupabaseServerClient();
  const { data: movimiento, error } = await supabase
    .from("movimientos_profesional_marca")
    .select("id_venta, id_marca")
    .eq("id_movimiento", idMovimiento)
    .maybeSingle();
  if (error) throw new Error(friendlyDbError(error));
  if (!movimiento?.id_venta) return [];

  const { data: detalle } = await supabase
    .from("detalle_ventas")
    .select("id_variante, cantidad, precio_unitario, subtotal")
    .eq("id_venta", movimiento.id_venta)
    .eq("id_marca", movimiento.id_marca);

  const idsVariante = (detalle ?? []).map((d) => d.id_variante);
  const { data: variantes } = await supabase
    .from("variantes_producto")
    .select("id_variante, id_producto, nombre")
    .in("id_variante", idsVariante.length > 0 ? idsVariante : ["00000000-0000-0000-0000-000000000000"]);
  const idsProducto = [...new Set((variantes ?? []).map((v) => v.id_producto))];
  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre")
    .in("id_producto", idsProducto.length > 0 ? idsProducto : ["00000000-0000-0000-0000-000000000000"]);
  const productoPorId = new Map((productos ?? []).map((p) => [p.id_producto, p]));
  const variantePorId = new Map((variantes ?? []).map((v) => [v.id_variante, v]));

  return (detalle ?? []).map((d) => {
    const variante = variantePorId.get(d.id_variante);
    const producto = variante ? productoPorId.get(variante.id_producto) : undefined;
    const nombre = `${producto?.nombre ?? "Producto"}${variante && variante.nombre !== "Único" ? ` — ${variante.nombre}` : ""}`;
    return { nombre, cantidad: d.cantidad, precioUnitario: d.precio_unitario, subtotal: d.subtotal ?? d.precio_unitario * d.cantidad };
  });
}

// Para saldar manualmente (pagarle en efectivo/transferencia, o cargar un
// canje que no pasó por caja) — mismo movimiento que genera el canje
// automático, así el historial queda unificado.
export async function registrarPagoCanje(
  idProfesional: string,
  idMarca: string,
  tipo: "PAGO" | "CANJE",
  monto: number,
  descripcion: string
): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  if (!monto || monto <= 0) return { error: "El monto tiene que ser mayor a 0" };

  const supabase = getSupabaseServerClient();
  const saldos = await saldosPorMarca(supabase, idProfesional);
  const saldo = saldos.find((s) => s.idMarca === idMarca)?.saldo ?? 0;
  if (monto > saldo) return { error: `El saldo de esa marca es de $${saldo} — no podés registrar más que eso.` };

  const usuario = await usuarioActual();
  const { error } = await supabase.from("movimientos_profesional_marca").insert({
    id_profesional: idProfesional,
    id_marca: idMarca,
    tipo,
    monto,
    descripcion: descripcion || null,
    usuario,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}

// ===================== CONFIGURACIÓN POR MARCA =====================

export async function listarConfigMarcas() {
  const supabase = getSupabaseServerClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("config_profesionales_marca")
    .select("*")
    .eq("estado", "ACTIVA")
    .lte("fecha_desde", hoy)
    .or(`fecha_hasta.is.null,fecha_hasta.gte.${hoy}`)
    .order("fecha_desde", { ascending: false });
  if (error) throw new Error(friendlyDbError(error));

  // Si una marca tiene más de una vigente (no debería, pero por las dudas),
  // me quedo con la más nueva.
  const vigentePorMarca = new Map<string, (typeof data)[number]>();
  for (const c of data ?? []) {
    if (!vigentePorMarca.has(c.id_marca)) vigentePorMarca.set(c.id_marca, c);
  }
  return [...vigentePorMarca.values()];
}

// Con historial: cierra la vigencia anterior (si había) e inserta una fila
// nueva — nunca se pisa la config vieja, para que una venta pasada conserve
// el % que realmente usó.
export async function guardarConfigMarca(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const idMarca = text(formData, "id_marca");
  if (!idMarca) return { error: "Elegí una marca" };

  const participa = formData.get("participa") === "on";
  const aporteTotal = number(formData, "porcentaje_aporte_total") ?? 0;
  const porcentajeCliente = number(formData, "porcentaje_cliente") ?? 0;
  const porcentajeProfesional = number(formData, "porcentaje_profesional") ?? 0;

  if (participa && porcentajeCliente + porcentajeProfesional > aporteTotal) {
    return {
      error: `Cliente (${porcentajeCliente}%) + Profesional (${porcentajeProfesional}%) supera el aporte total de la marca (${aporteTotal}%).`,
    };
  }

  try {
    const supabase = getSupabaseServerClient();
    const hoy = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    await supabase
      .from("config_profesionales_marca")
      .update({ fecha_hasta: ayer })
      .eq("id_marca", idMarca)
      .eq("estado", "ACTIVA")
      .is("fecha_hasta", null);

    const { error } = await supabase.from("config_profesionales_marca").insert({
      id_marca: idMarca,
      participa,
      porcentaje_aporte_total: aporteTotal,
      porcentaje_cliente: porcentajeCliente,
      porcentaje_profesional: porcentajeProfesional,
      tipo_beneficio_cliente: text(formData, "tipo_beneficio_cliente") ?? "PUNTOS",
      tipo_recompensa_profesional: text(formData, "tipo_recompensa_profesional") ?? "DINERO",
      fecha_desde: hoy,
      estado: "ACTIVA",
      observaciones: text(formData, "observaciones"),
    });
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/profesionales");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo guardar la configuración" };
  }
}

// ===================== SU USUARIO (su espacio en /mi-espacio) =====================
//
// El usuario y la contraseña los arma Gonzalo desde la ficha de cada
// profesional (decisión suya, 2026-10-26). La profesional entra con eso y
// completa su ficha; lo que sale en la pantalla del local lo aprueba él.

const FALTA_SQL_USUARIO = "Falta correr sql/profesionales-usuario.sql en Supabase.";
const faltaSqlUsuario = (m: string) => /id_profesional|ultimo_ingreso|autorizo_imagen_at|actividad_profesional|cambios_profesional|schema cache|does not exist/i.test(m);

export type UsuarioDeProfesional = {
  disponible: boolean;
  usuario: { idUsuario: string; email: string; estado: string; ultimoIngreso: string | null } | null;
  autorizoImagenAt: string | null;
  actividad: { accion: string; fecha: string; esperaAprobacion: boolean }[];
};

export async function usuarioDeProfesional(idProfesional: string): Promise<UsuarioDeProfesional> {
  await requireInterno();
  const supabase = getSupabaseServerClient();
  const [usuarioRes, profRes, actividadRes] = await Promise.all([
    supabase.from("usuarios").select("id_usuario, email, estado, ultimo_ingreso").eq("id_profesional", idProfesional).maybeSingle(),
    supabase.from("profesionales").select("autorizo_imagen_at").eq("id_profesional", idProfesional).maybeSingle(),
    supabase
      .from("actividad_profesional")
      .select("accion, fecha, espera_aprobacion")
      .eq("id_profesional", idProfesional)
      .order("fecha", { ascending: false })
      .limit(30),
  ]);
  if (usuarioRes.error && faltaSqlUsuario(usuarioRes.error.message)) {
    return { disponible: false, usuario: null, autorizoImagenAt: null, actividad: [] };
  }
  const u = usuarioRes.data;
  return {
    disponible: true,
    usuario: u
      ? { idUsuario: u.id_usuario as string, email: u.email as string, estado: u.estado as string, ultimoIngreso: (u.ultimo_ingreso as string | null) ?? null }
      : null,
    autorizoImagenAt: (profRes.data?.autorizo_imagen_at as string | null) ?? null,
    actividad: (actividadRes.data ?? []).map((a) => ({
      accion: a.accion as string,
      fecha: a.fecha as string,
      esperaAprobacion: Boolean(a.espera_aprobacion),
    })),
  };
}

export async function crearUsuarioProfesional(idProfesional: string, emailCrudo: string, password: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const email = emailCrudo.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Revisá el mail: no parece un mail válido." };
  if (password.length < 6) return { error: "La contraseña tiene que tener al menos 6 caracteres." };

  try {
    const supabase = getSupabaseServerClient();
    const { data: p } = await supabase.from("profesionales").select("nombre, apellido, estado").eq("id_profesional", idProfesional).maybeSingle();
    if (!p) return { error: "No encontré a esta profesional." };

    const { data: yaTiene, error: errorBusqueda } = await supabase.from("usuarios").select("id_usuario").eq("id_profesional", idProfesional).maybeSingle();
    if (errorBusqueda) return { error: faltaSqlUsuario(errorBusqueda.message) ? FALTA_SQL_USUARIO : friendlyDbError(errorBusqueda) };
    if (yaTiene) return { error: "Esta profesional ya tiene usuario." };

    const { data: mailUsado } = await supabase.from("usuarios").select("id_usuario").eq("email", email).maybeSingle();
    if (mailUsado) return { error: "Ese mail ya lo usa otro usuario del sistema. Usá otro." };

    const { error } = await supabase.from("usuarios").insert({
      nombre: [p.nombre, p.apellido].filter(Boolean).join(" "),
      email,
      rol: "profesional",
      id_profesional: idProfesional,
      password_hash: await hashPassword(password),
      estado: "ACTIVO",
    });
    if (error) return { error: faltaSqlUsuario(error.message) ? FALTA_SQL_USUARIO : friendlyDbError(error) };

    revalidatePath("/profesionales");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el usuario." };
  }
}

export async function cambiarClaveUsuarioProfesional(idProfesional: string, password: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  if (password.length < 6) return { error: "La contraseña tiene que tener al menos 6 caracteres." };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("usuarios")
    .update({ password_hash: await hashPassword(password) })
    .eq("id_profesional", idProfesional)
    .eq("rol", "profesional");
  if (error) return { error: friendlyDbError(error) };
  return { error: null };
}

// ===================== PROFESIONALES DEL MES Y REGLAS =====================
//
// Sin premios en plata (decisión de Gonzalo, 2026-10-26): las reglas solo
// definen el objetivo de la semana que ve cada una y cuántos pacientes hacen
// falta para que su ficha salga destacada (primero en la pantalla del local).

export type FilaDelMes = { idProfesional: string; nombre: string; foto: string | null; vistas: number; pacientes: number; vendido: number; destacada: boolean };

export async function profesionalesDelMes(): Promise<{
  filas: FilaDelMes[];
  reglas: { objetivoSemanal: number; pacientesDestacada: number };
  hayVisitas: boolean;
}> {
  await requireInterno();
  const supabase = getSupabaseServerClient();
  const primeroDelMes = `${fechaHoraArgentina().fecha.slice(0, 8)}01T00:00:00-03:00`;
  const [profRes, visRes, refRes, reglas] = await Promise.all([
    supabase.from("profesionales").select("id_profesional, nombre, apellido, foto").eq("estado", "ACTIVO"),
    supabase.from("visitas_asesor").select("id_profesional").eq("evento", "FICHA").gte("fecha", primeroDelMes),
    supabase.from("referidos_profesionales").select("id_profesional, id_cliente, total_venta").neq("estado", "ANULADO").gte("fecha", primeroDelMes),
    reglasProfesionales(supabase),
  ]);

  const vistas = new Map<string, number>();
  for (const v of visRes.data ?? []) vistas.set(v.id_profesional as string, (vistas.get(v.id_profesional as string) ?? 0) + 1);
  const clientes = new Map<string, Set<string>>();
  const sinCliente = new Map<string, number>();
  const vendido = new Map<string, number>();
  for (const r of refRes.data ?? []) {
    const id = r.id_profesional as string;
    if (r.id_cliente) {
      if (!clientes.has(id)) clientes.set(id, new Set());
      clientes.get(id)!.add(r.id_cliente as string);
    } else sinCliente.set(id, (sinCliente.get(id) ?? 0) + 1);
    vendido.set(id, (vendido.get(id) ?? 0) + Number(r.total_venta ?? 0));
  }

  const filas = (profRes.data ?? [])
    .map((p) => {
      const id = p.id_profesional as string;
      const pacientes = (clientes.get(id)?.size ?? 0) + (sinCliente.get(id) ?? 0);
      return {
        idProfesional: id,
        nombre: [p.nombre, p.apellido].filter(Boolean).join(" "),
        foto: (p.foto as string | null) ?? null,
        vistas: vistas.get(id) ?? 0,
        pacientes,
        vendido: vendido.get(id) ?? 0,
        destacada: pacientes >= reglas.pacientesDestacada,
      };
    })
    .sort((a, b) => b.pacientes - a.pacientes || b.vistas - a.vistas || a.nombre.localeCompare(b.nombre, "es"));

  return { filas, reglas, hayVisitas: !visRes.error };
}

export async function guardarReglasProfesionales(objetivoSemanal: number, pacientesDestacada: number): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const valores: [string, number][] = [
    [PARAM_OBJETIVO_SEMANAL, objetivoSemanal],
    [PARAM_PACIENTES_DESTACADA, pacientesDestacada],
  ];
  if (valores.some(([, v]) => !Number.isInteger(v) || v < 1 || v > 999)) return { error: "Poné números enteros, de 1 para arriba." };
  const supabase = getSupabaseServerClient();
  for (const [parametro, valor] of valores) {
    const { data: existe } = await supabase.from("configuracion").select("parametro").eq("parametro", parametro).maybeSingle();
    const { error } = existe
      ? await supabase.from("configuracion").update({ valor: String(valor) }).eq("parametro", parametro)
      : await supabase.from("configuracion").insert({ parametro, valor: String(valor) });
    if (error) return { error: friendlyDbError(error) };
  }
  revalidatePath("/profesionales");
  return { error: null };
}

// ===================== CAMBIOS QUE MANDAN DESDE SU ESPACIO =====================
//
// Lo que una profesional cambia en su ficha espera acá (cambios_profesional)
// hasta que Gonzalo lo aprueba en Aprobaciones. Recién ahí sale en la
// pantalla del local.

export type CambioParaAprobar = {
  idCambio: string;
  tipo: TipoCambio;
  que: string;
  fecha: string;
  profesional: { id: string; nombre: string; foto: string | null };
  // Lo que se muestra en la bandeja, ya en palabras: campo por campo, antes y ahora.
  filas: { campo: string; antes: string; ahora: string }[];
  fotoNueva: string | null;
};

const textoDe = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export async function listarCambiosProfesionales(): Promise<CambioParaAprobar[]> {
  await requireInterno();
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("cambios_profesional")
    .select("id_cambio, id_profesional, tipo, valor_nuevo, valor_anterior, fecha")
    .eq("estado", "PENDIENTE")
    .order("fecha");
  if (error || !data || data.length === 0) return [];

  const idsProf = [...new Set(data.map((c) => c.id_profesional as string))];
  const [profRes, fortRes, objRes] = await Promise.all([
    supabase.from("profesionales").select("id_profesional, nombre, apellido, foto").in("id_profesional", idsProf),
    supabase.from("fortalezas_profesional").select("id_fortaleza, nombre"),
    supabase.from("objetivos").select("id_objetivo, nombre"),
  ]);
  const prof = new Map((profRes.data ?? []).map((p) => [p.id_profesional as string, p]));
  const nombreFortaleza = new Map((fortRes.data ?? []).map((f) => [f.id_fortaleza as string, f.nombre as string]));
  const nombreObjetivo = new Map((objRes.data ?? []).map((o) => [o.id_objetivo as string, o.nombre as string]));

  return data.map((c) => {
    const tipo = c.tipo as TipoCambio;
    const nuevo = c.valor_nuevo as unknown;
    const anterior = c.valor_anterior as unknown;
    const p = prof.get(c.id_profesional as string);
    let filas: CambioParaAprobar["filas"] = [];
    let fotoNueva: string | null = null;

    if (tipo === "DATOS") {
      const n = (nuevo ?? {}) as Record<string, unknown>;
      const a = (anterior ?? {}) as Record<string, unknown>;
      filas = Object.keys(n).map((campo) => ({
        campo: CAMPOS_DATOS[campo as CampoDatos] ?? campo,
        antes: textoDe(a[campo]),
        ahora: textoDe(n[campo]),
      }));
    } else if (tipo === "FOTO" || tipo === "FOTO_PERFIL") {
      fotoNueva = (nuevo as { url?: string })?.url ?? null;
      const titulo = (nuevo as { titulo?: string | null })?.titulo;
      if (titulo) filas = [{ campo: "Qué se ve", antes: "—", ahora: titulo }];
    } else if (tipo === "FORMACION") {
      filas = (nuevo as ItemFormacion[]).map((f) => ({ campo: "Formación", antes: "", ahora: [f.titulo, f.institucion, f.anio].filter(Boolean).join(" · ") }));
    } else if (tipo === "TRAYECTORIA") {
      filas = (nuevo as ItemTrayectoria[]).map((t) => ({
        campo: "Recorrido",
        antes: "",
        ahora: [t.titulo, t.lugar, t.anio_desde && `${t.anio_desde}${t.anio_hasta ? `–${t.anio_hasta}` : "–hoy"}`].filter(Boolean).join(" · "),
      }));
    } else if (tipo === "VIDEOS") {
      filas = (nuevo as ItemVideo[]).map((v) => ({ campo: "Video", antes: "", ahora: [v.titulo, v.url].filter(Boolean).join(" · ") }));
    } else if (tipo === "FORTALEZAS") {
      filas = (nuevo as ItemFortaleza[]).map((f) => ({
        campo: "Se destaca en",
        antes: "",
        ahora: `${nombreFortaleza.get(f.id_fortaleza) ?? "—"}${f.principal ? " (principal)" : ""}`,
      }));
    } else if (tipo === "OBJETIVOS") {
      filas = (nuevo as string[]).map((id) => ({ campo: "Ayuda en", antes: "", ahora: nombreObjetivo.get(id) ?? "—" }));
    }

    return {
      idCambio: c.id_cambio as string,
      tipo,
      que: QUE_HIZO[tipo],
      fecha: c.fecha as string,
      profesional: {
        id: c.id_profesional as string,
        nombre: p ? [p.nombre, p.apellido].filter(Boolean).join(" ") : "Profesional",
        foto: (p?.foto as string | null) ?? null,
      },
      filas,
      fotoNueva,
    };
  });
}

async function idUsuarioActual() {
  const cookieStore = await cookies();
  const sesion = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  return sesion?.sub ?? null;
}

/** Cierra el "esperando tu OK" de su historial para ese tipo de cambio. */
async function cerrarEsperaEnHistorial(supabase: SupabaseClient, idProfesional: string, tipo: TipoCambio) {
  await supabase
    .from("actividad_profesional")
    .update({ espera_aprobacion: false })
    .eq("id_profesional", idProfesional)
    .eq("accion", QUE_HIZO[tipo])
    .eq("espera_aprobacion", true);
}

export async function aprobarCambioProfesional(idCambio: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { data: c } = await supabase
    .from("cambios_profesional")
    .select("id_profesional, tipo, valor_nuevo, estado")
    .eq("id_cambio", idCambio)
    .maybeSingle();
  if (!c) return { error: "No encontré ese cambio." };
  if (c.estado !== "PENDIENTE") return { error: "Ese cambio ya estaba resuelto." };

  const error = await aplicarCambioProfesional(supabase, c.id_profesional as string, c.tipo as TipoCambio, c.valor_nuevo);
  if (error) return { error: `No se pudo aplicar: ${error}` };

  await supabase
    .from("cambios_profesional")
    .update({ estado: "APROBADO", resuelto_por: await idUsuarioActual(), fecha_resuelto: new Date().toISOString() })
    .eq("id_cambio", idCambio);
  await cerrarEsperaEnHistorial(supabase, c.id_profesional as string, c.tipo as TipoCambio);
  revalidatePath("/aprobaciones");
  revalidatePath("/profesionales");
  return { error: null };
}

export async function pedirCorreccionProfesional(idCambio: string, nota: string): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const texto = nota.trim();
  // Sin explicación no le sirve de nada: no sabe qué cambiar.
  if (!texto) return { error: "Escribile qué tiene que cambiar." };
  const supabase = getSupabaseServerClient();
  const { data: c } = await supabase.from("cambios_profesional").select("id_profesional, tipo, estado").eq("id_cambio", idCambio).maybeSingle();
  if (!c) return { error: "No encontré ese cambio." };
  if (c.estado !== "PENDIENTE") return { error: "Ese cambio ya estaba resuelto." };
  const { error } = await supabase
    .from("cambios_profesional")
    .update({ estado: "CORREGIR", nota: texto.slice(0, 500), resuelto_por: await idUsuarioActual(), fecha_resuelto: new Date().toISOString() })
    .eq("id_cambio", idCambio);
  if (error) return { error: friendlyDbError(error) };
  await cerrarEsperaEnHistorial(supabase, c.id_profesional as string, c.tipo as TipoCambio);
  revalidatePath("/aprobaciones");
  return { error: null };
}

export async function cambiarEstadoUsuarioProfesional(idProfesional: string, activo: boolean): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("usuarios")
    .update({ estado: activo ? "ACTIVO" : "INACTIVO" })
    .eq("id_profesional", idProfesional)
    .eq("rol", "profesional");
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/profesionales");
  return { error: null };
}
