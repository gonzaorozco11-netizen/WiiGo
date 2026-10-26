"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, createSessionToken, readSessionToken } from "@/lib/session";
import { verifyPassword } from "@/lib/auth";
import { getSupabaseServerClient, type Usuario } from "@/lib/supabase";
import { esRolInterno, INICIO_ROL_EXTERNO } from "@/lib/rolesInternos";

export async function login(_prevState: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    return { error: "La app no está configurada todavía (falta AUTH_SECRET)." };
  }

  if (!email || !password) {
    return { error: "Ingresá tu email y tu contraseña." };
  }

  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("usuarios")
    .select("id_usuario, nombre, rol, estado, password_hash")
    .eq("email", email)
    .maybeSingle();
  const usuario = data as Pick<
    Usuario,
    "id_usuario" | "nombre" | "rol" | "estado" | "password_hash"
  > | null;

  if (!usuario || usuario.estado !== "ACTIVO") {
    return { error: "Email o contraseña incorrectos." };
  }

  const valid = await verifyPassword(password, usuario.password_hash);
  if (!valid) {
    return { error: "Email o contraseña incorrectos." };
  }

  const token = await createSessionToken(
    { sub: usuario.id_usuario, nombre: usuario.nombre, rol: usuario.rol ?? "" },
    authSecret
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 días
  });

  // Cuándo entró por última vez: lo mira Gonzalo en la ficha de cada
  // profesional. Si la columna todavía no existe (falta el SQL), no frena el
  // ingreso: por eso no se mira el error.
  await supabase.from("usuarios").update({ ultimo_ingreso: new Date().toISOString() }).eq("id_usuario", usuario.id_usuario);

  // Cada rol a su casa. El usuario de una marca o de una profesional no ve el
  // sistema interno, así que no tiene sentido mandarlo a "/" ni respetar un
  // ?next= que apunte adentro: de ahí lo rebotaría el layout igual.
  if (!esRolInterno(usuario.rol)) redirect(INICIO_ROL_EXTERNO[usuario.rol ?? ""] ?? "/login");

  redirect(next && next.startsWith("/") ? next : "/");
}

/**
 * Lo que le falta cerrar a alguien del equipo antes de poder salir de su
 * usuario: la caja que abrió (de hoy o de antes) y la salida de hoy.
 * Pedido de Gonzalo (2026-10-22): que no se vayan sin cerrar la caja ni
 * fichar. El Dueño (admin) y las marcas salen siempre.
 */
async function pendienteAntesDeSalir(idUsuario: string, nombre: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { data: usuario } = await supabase.from("usuarios").select("id_persona").eq("id_usuario", idUsuario).maybeSingle();

  // La caja abierta a su nombre.
  const cajaPorId = await supabase.from("turnos").select("id_turno").eq("estado", "ABIERTO").eq("id_usuario_apertura", idUsuario).limit(1);
  if (!cajaPorId.error && (cajaPorId.data ?? []).length > 0) return true;
  const cajaPorNombre = await supabase.from("turnos").select("id_turno").eq("estado", "ABIERTO").eq("usuario_apertura", nombre).limit(1);
  if ((cajaPorNombre.data ?? []).length > 0) return true;

  // Fichó la entrada hoy y todavía no la salida.
  if (!usuario?.id_persona) return false;
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const { data: ultimo } = await supabase
    .from("fichajes")
    .select("tipo")
    .eq("id_persona", usuario.id_persona as string)
    .gte("fecha_hora", `${hoy}T00:00:00-03:00`)
    .order("fecha_hora", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ultimo?.tipo === "ENTRADA";
}

export async function logout() {
  const cookieStore = await cookies();
  const sesion = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  // Con la caja abierta o sin fichar la salida no se sale: se la lleva a
  // fichar, que le pide el arqueo si tiene la caja abierta. Las marcas y las
  // profesionales no abren caja ni fichan: salen siempre.
  if (sesion && sesion.rol !== "admin" && esRolInterno(sesion.rol) && (await pendienteAntesDeSalir(sesion.sub as string, (sesion.nombre as string) ?? ""))) {
    redirect("/ficha-asistencia?antes-de-salir=1");
  }
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
