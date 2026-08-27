"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { friendlyDbError } from "@/lib/errors";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";
import { saldosPorProveedor } from "@/lib/cuentaProveedor";

// Alta/edición de proveedores y todo lo que mueve plata (facturas, pagos,
// órdenes de compra) es solo admin — mismo criterio que Profesionales:
// recepcionar mercadería sí lo puede hacer cualquier operativo del local,
// eso se resuelve aparte en app/(app)/proveedores/recepcion-actions.ts.
async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sesion = await readSessionToken(token, process.env.AUTH_SECRET ?? "");
  if (sesion?.rol !== "admin") return "No tenés permiso para hacer esto — hace falta ser administrador.";
  return null;
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

export type ProveedorConSaldo = {
  id_proveedor: string;
  nombre: string;
  cuit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  condicion_pago_dias: number | null;
  estado: string;
  observaciones: string | null;
  fecha_alta: string;
  saldo: number;
};

export async function listarProveedores(): Promise<ProveedorConSaldo[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("proveedores").select("*").order("nombre", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));
  const proveedores = data ?? [];
  const saldos = await saldosPorProveedor(supabase, proveedores.map((p) => p.id_proveedor));
  return proveedores.map((p) => ({ ...p, saldo: saldos.get(p.id_proveedor) ?? 0 }));
}

export async function crearProveedor(formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre es obligatorio" };

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("proveedores").insert({
      nombre,
      cuit: text(formData, "cuit"),
      contacto: text(formData, "contacto"),
      telefono: text(formData, "telefono"),
      email: text(formData, "email"),
      condicion_pago_dias: number(formData, "condicion_pago_dias"),
      estado: "ACTIVO",
      observaciones: text(formData, "observaciones"),
    });
    if (error) return { error: friendlyDbError(error) };

    revalidatePath("/proveedores");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear el proveedor" };
  }
}

export async function actualizarProveedor(idProveedor: string, formData: FormData): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const nombre = text(formData, "nombre");
  if (!nombre) return { error: "El nombre es obligatorio" };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("proveedores")
    .update({
      nombre,
      cuit: text(formData, "cuit"),
      contacto: text(formData, "contacto"),
      telefono: text(formData, "telefono"),
      email: text(formData, "email"),
      condicion_pago_dias: number(formData, "condicion_pago_dias"),
      observaciones: text(formData, "observaciones"),
    })
    .eq("id_proveedor", idProveedor);
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/proveedores");
  return { error: null };
}

export async function cambiarEstadoProveedor(idProveedor: string, estado: "ACTIVO" | "INACTIVO"): Promise<{ error: string | null }> {
  const permisoError = await requireAdmin();
  if (permisoError) return { error: permisoError };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("proveedores").update({ estado }).eq("id_proveedor", idProveedor);
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/proveedores");
  return { error: null };
}
